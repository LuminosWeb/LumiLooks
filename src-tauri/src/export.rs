//! Video export. FFmpeg decodes RGBA frames, the webview grades each frame with WebGL (same renderer as the
//! preview), then FFmpeg encodes them with the chosen CPU or GPU encoder and target bitrate.
use crate::encoders::{cpu_encoder, encoder_settings, validate, EncoderCache, EngineInfo, QUALITIES};
use crate::ffmpeg::{command, probe_video};
use crate::files::with_extension;
use crate::media::{extension, MediaRegistry, VIDEO_EXT};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver};
use std::sync::{Arc, Mutex};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

pub struct VideoFormat {
    pub extension: &'static str,
    pub muxer: &'static str,
    pub audio: &'static [&'static str],
    pub options: &'static [&'static str],
}

pub fn video_format(value: &str) -> Result<VideoFormat, String> {
    Ok(match value {
        "mp4" => VideoFormat { extension: "mp4", muxer: "mp4", audio: &["-c:a", "aac", "-b:a", "192k"], options: &["-movflags", "+faststart"] },
        "webm" => VideoFormat { extension: "webm", muxer: "webm", audio: &["-c:a", "libopus", "-b:a", "160k"], options: &[] },
        "mov" => VideoFormat { extension: "mov", muxer: "mov", audio: &["-c:a", "aac", "-b:a", "192k"], options: &["-movflags", "+faststart"] },
        "avi" => VideoFormat { extension: "avi", muxer: "avi", audio: &["-c:a", "libmp3lame", "-b:a", "192k"], options: &["-bf", "0"] },
        "wmv" => VideoFormat { extension: "wmv", muxer: "asf", audio: &["-c:a", "wmav2", "-b:a", "192k", "-ar", "48000", "-ac", "2"], options: &[] },
        _ => return Err("Format vidéo non pris en charge.".into()),
    })
}

/// Audio handling: copy an untouched, compatible full-length track; otherwise re-encode with tempo/volume filters.
pub fn audio_plan(format: &str, codec: Option<&str>, speed: f64, volume: f64, start: f64, end: f64, duration: f64) -> (bool, Vec<String>) {
    let level = if volume.is_finite() { volume.clamp(0.0, 100.0) } else { 100.0 };
    let rate = if speed.is_finite() && speed > 0.0 { speed.clamp(0.25, 4.0) } else { 1.0 };
    let compatible: &[&str] = match format {
        "mp4" => &["aac", "mp3"],
        "mov" => &["aac", "mp3", "alac", "pcm_s16le", "pcm_s24le"],
        "webm" => &["opus", "vorbis"],
        "avi" => &["mp3", "pcm_s16le"],
        "wmv" => &["wmav1", "wmav2"],
        _ => &[],
    };
    let copy = rate == 1.0 && level == 100.0 && start == 0.0 && duration.is_finite() && (end - duration).abs() < 0.001 && codec.is_some_and(|c| compatible.contains(&c));
    let mut filters = Vec::new();
    if rate != 1.0 {
        let mut remaining = rate;
        while remaining > 2.0 {
            filters.push("atempo=2".to_string());
            remaining /= 2.0;
        }
        while remaining < 0.5 {
            filters.push("atempo=0.5".to_string());
            remaining /= 0.5;
        }
        filters.push(format!("atempo={remaining}"));
    }
    if level != 100.0 {
        filters.push(format!("volume={}", level / 100.0));
    }
    (copy, filters)
}

/// Crop and rotation geometry — mirrors `src/lib/geometry.ts`.
pub fn crop_geometry(mut width: u32, mut height: u32, rotation: u32, aspect: &str) -> (u32, u32, [f64; 2]) {
    if rotation % 2 == 1 {
        std::mem::swap(&mut width, &mut height);
    }
    let source = width as f64 / height as f64;
    let ratio = match aspect {
        "16:9" => 16.0 / 9.0,
        "9:16" => 9.0 / 16.0,
        "1:1" => 1.0,
        "4:5" => 4.0 / 5.0,
        "4:3" => 4.0 / 3.0,
        _ => source,
    };
    let crop = if source > ratio { [ratio / source, 1.0] } else { [1.0, source / ratio] };
    (((width as f64 * crop[0]).floor() as u32).max(2), ((height as f64 * crop[1]).floor() as u32).max(2), crop)
}

pub fn export_geometry(width: u32, height: u32, rotation: u32, aspect: &str, resolution: &str) -> Result<(u32, u32, [f64; 2]), String> {
    let (w, h, crop) = crop_geometry(width, height, rotation, aspect);
    if resolution == "original" {
        return Ok(((w / 2 * 2).max(2), (h / 2 * 2).max(2), crop));
    }
    let p: f64 = match resolution {
        "720" => 720.0,
        "1080" => 1080.0,
        "2160" => 2160.0,
        _ => return Err("Choisissez une résolution 720p, 1080p, 4K ou d’origine.".into()),
    };
    let scale = p / (w.min(h) as f64);
    let even = |v: f64| (((v / 2.0).round() * 2.0) as u32).max(2);
    Ok((even(w as f64 * scale), even(h as f64 * scale), crop))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub id: String,
    pub output: String,
    pub start: f64,
    pub end: f64,
    pub speed: f64,
    pub volume: f64,
    pub audio: bool,
    pub rotation: u32,
    pub aspect: String,
    pub resolution: String,
    pub fps: u32,
    pub quality: String,
    pub format: String,
    pub encoder: String,
    pub bitrate: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInfo {
    pub width: u32,
    pub height: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub crop: [f64; 2],
    pub total: u64,
    pub fps: u32,
    pub engine: EngineInfo,
}

struct Job {
    decoder: Mutex<Child>,
    encoder: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    frames_rx: Mutex<Receiver<Vec<u8>>>,
    frame_bytes: usize,
    frames: AtomicU64,
    errors: Arc<Mutex<String>>,
    reader_failed: Arc<AtomicBool>,
    temp: PathBuf,
    output: PathBuf,
}

#[derive(Default)]
pub struct ExportState {
    job: Mutex<Option<Arc<Job>>>,
}

fn collect_stderr(child: &mut Child, errors: Arc<Mutex<String>>) {
    if let Some(mut stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                if let Ok(mut e) = errors.lock() {
                    e.push_str(&String::from_utf8_lossy(&chunk[..n]));
                    if e.len() > 4000 {
                        let cut = e.len() - 4000;
                        let cut = (cut..e.len()).find(|i| e.is_char_boundary(*i)).unwrap_or(cut);
                        e.drain(..cut);
                    }
                }
            }
        });
    }
}

fn clean(job: &Job) {
    if let Ok(mut stdin) = job.stdin.lock() {
        stdin.take();
    }
    if let Ok(mut d) = job.decoder.lock() {
        let _ = d.kill();
        let _ = d.wait();
    }
    if let Ok(mut e) = job.encoder.lock() {
        let _ = e.kill();
        let _ = e.wait();
    }
    let _ = std::fs::remove_file(&job.temp);
}

fn current(state: &ExportState) -> Result<Arc<Job>, String> {
    state.job.lock().map_err(|e| e.to_string())?.clone().ok_or_else(|| "Aucun export en cours.".to_string())
}

#[tauri::command]
pub async fn detect_encoders(app: AppHandle, opts: DetectOptions) -> Result<crate::encoders::EncoderSupport, String> {
    validate(&opts.format, opts.width, opts.height, opts.fps)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cache = app.state::<EncoderCache>();
        let (gpu, diagnostics) = cache.detect_gpu(&opts.format, opts.width, opts.height, opts.fps);
        let cpu = encoder_settings(cpu_encoder(&opts.format), "high", 4000)?.info;
        let gpu = match gpu {
            Some(name) => Some(encoder_settings(&name, "high", 4000)?.info),
            None => None,
        };
        Ok(crate::encoders::EncoderSupport { cpu, gpu, diagnostics })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Deserialize)]
pub struct DetectOptions {
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[tauri::command]
pub async fn export_start(app: AppHandle, opts: ExportOptions) -> Result<ExportInfo, String> {
    {
        let state = app.state::<ExportState>();
        if state.job.lock().map_err(|e| e.to_string())?.is_some() {
            return Err("Un export est déjà en cours.".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || start_blocking(&app, opts)).await.map_err(|e| e.to_string())?
}

fn start_blocking(app: &AppHandle, opts: ExportOptions) -> Result<ExportInfo, String> {
    let registry = app.state::<MediaRegistry>();
    let input = registry.get(&opts.id).ok_or("Réimportez la vidéo avant de l’exporter.")?;
    if !VIDEO_EXT.contains(&extension(&input).as_str()) {
        return Err("Sélectionnez une vidéo.".into());
    }
    let format = video_format(&opts.format)?;
    let source = probe_video(&input)?;
    let start = if opts.start.is_finite() { opts.start.max(0.0) } else { 0.0 };
    let end = opts.end;
    let speed = if opts.speed.is_finite() { opts.speed.clamp(0.25, 4.0) } else { 1.0 };
    if !end.is_finite() || end <= start || end - start > 86_400.0 {
        return Err("Vérifiez les points d’entrée et de sortie.".into());
    }
    let fps = if [24, 25, 30, 60].contains(&opts.fps) { opts.fps } else { 30 };
    let rotation = if opts.rotation <= 3 { opts.rotation } else { 0 };
    let aspect = if ["original", "16:9", "9:16", "1:1", "4:5", "4:3"].contains(&opts.aspect.as_str()) { opts.aspect.as_str() } else { "original" };
    let quality = if QUALITIES.contains(&opts.quality.as_str()) { opts.quality.as_str() } else { "high" };
    let bitrate = opts.bitrate.clamp(300, 200_000);
    let (width, height, crop) = export_geometry(source.width, source.height, rotation, aspect, &opts.resolution)?;
    validate(&opts.format, width, height, fps)?;

    let requested = PathBuf::from(&opts.output);
    let output = with_extension(&requested, format.extension);
    if registry.contains_path(&output) {
        return Err("Choisissez un autre nom pour conserver vos médias originaux.".into());
    }
    if output != requested && output.exists() {
        return Err("Un fichier porte déjà ce nom avec cette extension. Choisissez un autre nom.".into());
    }
    let dir = output.parent().filter(|p| !p.as_os_str().is_empty()).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    let temp = dir.join(format!(".lumilooks-{}.{}", uuid::Uuid::new_v4(), format.extension));

    let engine = if opts.encoder == "gpu" {
        let (gpu, _) = app.state::<EncoderCache>().detect_gpu(&opts.format, width, height, fps);
        match gpu {
            Some(name) => encoder_settings(&name, quality, bitrate)?,
            None => {
                let mut e = encoder_settings(cpu_encoder(&opts.format), quality, bitrate)?;
                e.info.label = format!("{} (GPU indisponible)", e.info.label);
                e
            }
        }
    } else {
        encoder_settings(cpu_encoder(&opts.format), quality, bitrate)?
    };

    let duration_out = (end - start) / speed;
    let total = (duration_out * fps as f64).ceil().max(1.0) as u64;
    let (sw, sh) = (source.width, source.height);
    let input_str = input.to_string_lossy().to_string();
    let decode_args: Vec<String> = vec![
        "-v".into(), "error".into(), "-ss".into(), start.to_string(), "-i".into(), input_str.clone(), "-map".into(), "0:V:0".into(),
        "-t".into(), duration_out.to_string(), "-an".into(), "-vf".into(),
        format!("{},scale={sw}:{sh},setsar=1,setpts=PTS/{speed},fps={fps}", crate::ffmpeg::DISPLAY_FILTER),
        "-f".into(), "rawvideo".into(), "-pix_fmt".into(), "rgba".into(), "pipe:1".into(),
    ];
    let mut encode_args: Vec<String> = vec![
        "-v".into(), "error".into(), "-y".into(), "-f".into(), "rawvideo".into(), "-pix_fmt".into(), "rgba".into(),
        "-s".into(), format!("{width}x{height}"), "-r".into(), fps.to_string(), "-i".into(), "pipe:0".into(),
    ];
    let keep_audio = opts.audio && source.audio_stream.is_some();
    if keep_audio {
        encode_args.extend(["-ss".into(), start.to_string(), "-t".into(), (end - start).to_string(), "-i".into(), input_str.clone()]);
    }
    encode_args.extend(["-map".into(), "0:v:0".into()]);
    if keep_audio {
        encode_args.extend(["-map".into(), format!("1:{}?", source.audio_stream.unwrap_or(0))]);
        let (copy, filters) = audio_plan(&opts.format, source.audio_codec.as_deref(), speed, opts.volume, start, end, source.duration);
        if copy {
            encode_args.extend(["-c:a".into(), "copy".into()]);
        } else {
            if !filters.is_empty() {
                encode_args.extend(["-af".into(), filters.join(",")]);
            }
            encode_args.extend(format.audio.iter().map(|s| s.to_string()));
        }
    }
    encode_args.extend(engine.args.iter().cloned());
    encode_args.extend(format.options.iter().map(|s| s.to_string()));
    encode_args.extend(["-t".into(), duration_out.to_string(), "-metadata:s:v:0".into(), "rotate=0".into(), "-f".into(), format.muxer.into(), temp.to_string_lossy().to_string()]);

    let mut decoder = command().args(&decode_args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("Décodage impossible : {e}"))?;
    let mut encoder = match command().args(&encode_args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = decoder.kill();
            return Err(format!("Encodage impossible : {e}"));
        }
    };
    let errors = Arc::new(Mutex::new(String::new()));
    collect_stderr(&mut decoder, errors.clone());
    collect_stderr(&mut encoder, errors.clone());
    let frame_bytes = sw as usize * sh as usize * 4;
    let (tx, rx) = sync_channel::<Vec<u8>>(3);
    let reader_failed = Arc::new(AtomicBool::new(false));
    let mut stdout = decoder.stdout.take().ok_or("Sortie du décodeur indisponible.")?;
    let failed = reader_failed.clone();
    std::thread::spawn(move || loop {
        let mut frame = vec![0u8; frame_bytes];
        let mut filled = 0;
        while filled < frame_bytes {
            match stdout.read(&mut frame[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(_) => {
                    failed.store(true, Ordering::SeqCst);
                    return;
                }
            }
        }
        if filled == 0 {
            return;
        }
        if filled < frame_bytes {
            failed.store(true, Ordering::SeqCst);
            return;
        }
        if tx.send(frame).is_err() {
            return;
        }
    });
    let stdin = encoder.stdin.take();
    let job = Arc::new(Job {
        decoder: Mutex::new(decoder),
        encoder: Mutex::new(encoder),
        stdin: Mutex::new(stdin),
        frames_rx: Mutex::new(rx),
        frame_bytes: width as usize * height as usize * 4,
        frames: AtomicU64::new(0),
        errors,
        reader_failed,
        temp,
        output,
    });
    *app.state::<ExportState>().job.lock().map_err(|e| e.to_string())? = Some(job);
    Ok(ExportInfo { width, height, source_width: sw, source_height: sh, crop, total, fps, engine: engine.info })
}

/// Next decoded RGBA frame, or an empty buffer when the clip is finished.
#[tauri::command]
pub async fn export_read_frame(state: State<'_, ExportState>) -> Result<Response, String> {
    let job = current(&state)?;
    let frame = tauri::async_runtime::spawn_blocking(move || job.frames_rx.lock().ok().and_then(|rx| rx.recv().ok())).await.map_err(|e| e.to_string())?;
    Ok(Response::new(frame.unwrap_or_default()))
}

/// Receives one graded RGBA frame (raw request body) and feeds the encoder.
#[tauri::command]
pub async fn export_write_frame(state: State<'_, ExportState>, request: Request<'_>) -> Result<u64, String> {
    let job = current(&state)?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("Image de rendu invalide.".into()) };
    if bytes.len() != job.frame_bytes {
        return Err("Dimensions de rendu incohérentes.".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = job.stdin.lock().map_err(|e| e.to_string())?;
        let stdin = guard.as_mut().ok_or("L’encodage est terminé.")?;
        stdin.write_all(&bytes).map_err(|_| format!("L’encodage s’est arrêté. {}", job.errors.lock().map(|e| e.clone()).unwrap_or_default()))?;
        Ok(job.frames.fetch_add(1, Ordering::SeqCst) + 1)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_finish(state: State<'_, ExportState>) -> Result<String, String> {
    let job = current(&state)?;
    let result = {
        let job = job.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
            job.stdin.lock().map_err(|e| e.to_string())?.take();
            let decoded = job.decoder.lock().map_err(|e| e.to_string())?.wait().map_err(|e| e.to_string())?;
            let encoded = job.encoder.lock().map_err(|e| e.to_string())?.wait().map_err(|e| e.to_string())?;
            let log = job.errors.lock().map(|e| e.clone()).unwrap_or_default();
            if !decoded.success() || !encoded.success() || job.frames.load(Ordering::SeqCst) == 0 || job.reader_failed.load(Ordering::SeqCst) {
                return Err(format!("L’export a échoué. {log}").trim().to_string());
            }
            if job.output.exists() {
                std::fs::remove_file(&job.output).map_err(|e| format!("Impossible de remplacer le fichier existant : {e}"))?;
            }
            std::fs::rename(&job.temp, &job.output).or_else(|_| std::fs::copy(&job.temp, &job.output).map(|_| ()).and_then(|_| std::fs::remove_file(&job.temp))).map_err(|e| format!("Impossible d’écrire la vidéo : {e}"))?;
            Ok(job.output.to_string_lossy().to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    };
    if result.is_err() {
        clean(&job);
    }
    *state.job.lock().map_err(|e| e.to_string())? = None;
    result
}

#[tauri::command]
pub async fn export_cancel(state: State<'_, ExportState>) -> Result<(), String> {
    let job = state.job.lock().map_err(|e| e.to_string())?.take();
    if let Some(job) = job {
        tauri::async_runtime::spawn_blocking(move || clean(&job)).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn geometry_matches_frontend() {
        assert_eq!(export_geometry(1920, 1080, 0, "original", "1080").unwrap().0, 1920);
        let (w, h, _) = export_geometry(1080, 1920, 0, "original", "1080").unwrap();
        assert_eq!((w, h), (1080, 1920));
        let (w, h, crop) = export_geometry(1920, 1080, 0, "1:1", "720").unwrap();
        assert_eq!((w, h), (720, 720));
        assert!((crop[0] - 0.5625).abs() < 1e-9);
        let (w, h, _) = export_geometry(1921, 1081, 1, "original", "original").unwrap();
        assert_eq!((w, h), (1080, 1920));
    }
    #[test]
    fn audio() {
        let (copy, filters) = audio_plan("mp4", Some("aac"), 1.0, 100.0, 0.0, 10.0, 10.0);
        assert!(copy && filters.is_empty());
        let (copy, filters) = audio_plan("mp4", Some("aac"), 4.0, 50.0, 0.0, 10.0, 10.0);
        assert!(!copy);
        assert_eq!(filters, vec!["atempo=2", "atempo=2", "volume=0.5"]);
        let (_, filters) = audio_plan("webm", Some("aac"), 0.25, 100.0, 0.0, 10.0, 10.0);
        assert_eq!(filters, vec!["atempo=0.5", "atempo=0.5"]);
    }
}
