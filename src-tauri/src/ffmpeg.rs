//! FFmpeg sidecar: path resolution, process creation and video probing.
use regex::Regex;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// The bundled FFmpeg (`externalBin`) sits next to the executable. `LUMILOOKS_FFMPEG` overrides it for tests.
pub fn ffmpeg_path() -> PathBuf {
    if let Ok(path) = std::env::var("LUMILOOKS_FFMPEG") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    PathBuf::from(name)
}

pub fn command() -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(ffmpeg_path());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

pub struct ProbeOutput {
    pub ok: bool,
    pub log: String,
}

/// Runs FFmpeg with a timeout and returns its stderr.
pub fn run_capture(args: &[String], timeout: Duration) -> Result<ProbeOutput, String> {
    let mut child = command()
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("FFmpeg est introuvable ou ne démarre pas ({e}). Réinstallez LumiLooks."))?;
    let mut stderr = child.stderr.take().ok_or("Sortie FFmpeg indisponible.")?;
    let reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr.read_to_end(&mut buffer);
        let text = String::from_utf8_lossy(&buffer).to_string();
        if text.len() > 200_000 {
            text[text.len() - 200_000..].to_string()
        } else {
            text
        }
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => return Err(e.to_string()),
        }
    };
    let log = reader.join().unwrap_or_default();
    match status {
        Some(status) => Ok(ProbeOutput { ok: status.success(), log }),
        None => Ok(ProbeOutput { ok: false, log: "Délai de détection dépassé.".into() }),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub fps: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_codec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_stream: Option<u32>,
}

/// Normalizes non-square pixels before measuring, so phone rotation and anamorphic sources
/// use the same display dimensions in the viewer and in the raw-frame export.
pub const DISPLAY_FILTER: &str = "scale=w=trunc(iw*sar+0.5):h=ih,setsar=1";

fn regexes() -> &'static [Regex; 4] {
    static RE: OnceLock<[Regex; 4]> = OnceLock::new();
    RE.get_or_init(|| {
        [
            Regex::new(r"\[Parsed_showinfo_[^\]]+\][^\r\n]*?\bn:\s*0\b[^\r\n]*?\bs:(\d+)x(\d+)").unwrap(),
            Regex::new(r"Duration:\s*(\d+):(\d+):([\d.]+)").unwrap(),
            Regex::new(r"Stream[^\r\n]*Video:[^\r\n]*?([\d.]+) fps").unwrap(),
            Regex::new(r"Stream #0:(\d+)[^\r\n]*?Audio:\s*(\w+)[^\r\n]*").unwrap(),
        ]
    })
}

pub fn parse_video_info(log: &str) -> Result<VideoInfo, String> {
    let [size, duration, fps, audio] = regexes();
    let caps = size
        .captures(log)
        .ok_or("Impossible de détecter les dimensions de cette vidéo. Réimportez un fichier vidéo valide.")?;
    let width: u32 = caps[1].parse().map_err(|_| "Largeur vidéo invalide.")?;
    let height: u32 = caps[2].parse().map_err(|_| "Hauteur vidéo invalide.")?;
    if width < 2 || height < 2 || width > 8192 || height > 8192 {
        return Err("Dimensions vidéo non prises en charge (maximum 8192 pixels).".into());
    }
    let duration = duration
        .captures(log)
        .map(|c| c[1].parse::<f64>().unwrap_or(0.0) * 3600.0 + c[2].parse::<f64>().unwrap_or(0.0) * 60.0 + c[3].parse::<f64>().unwrap_or(0.0))
        .unwrap_or(0.0);
    let fps = fps.captures(log).and_then(|c| c[1].parse::<f64>().ok()).filter(|v| *v > 0.0).unwrap_or(30.0);
    let streams: Vec<_> = audio.captures_iter(log).collect();
    let chosen = streams.iter().find(|c| c[0].contains("(default)")).or_else(|| streams.first());
    Ok(VideoInfo {
        width,
        height,
        duration,
        fps,
        audio_codec: chosen.map(|c| c[2].to_string()),
        audio_stream: chosen.and_then(|c| c[1].parse().ok()),
    })
}

pub fn probe_video(file: &Path) -> Result<VideoInfo, String> {
    let args: Vec<String> = [
        "-hide_banner", "-loglevel", "info", "-i", &file.to_string_lossy(), "-map", "0:V:0", "-an", "-sn", "-dn", "-vf",
        &format!("{DISPLAY_FILTER},showinfo"), "-frames:v", "1", "-f", "null", "-",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let out = run_capture(&args, Duration::from_secs(30))?;
    if !out.ok {
        if out.log.contains("Délai") {
            return Err("La détection vidéo a pris trop de temps. Essayez de réimporter le fichier.".into());
        }
        return Err("Cette vidéo ne peut pas être décodée. Vérifiez le fichier d’origine.".into());
    }
    parse_video_info(&out.log)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_probe_log() {
        let log = "Input #0, mov,mp4\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 1000 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080, 29.97 fps, 29.97 tbr\n  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp (default)\n[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0 s:1080x1920 i:P\n";
        let info = parse_video_info(log).unwrap();
        assert_eq!((info.width, info.height), (1080, 1920));
        assert!((info.duration - 62.5).abs() < 1e-9);
        assert!((info.fps - 29.97).abs() < 1e-9);
        assert_eq!(info.audio_codec.as_deref(), Some("aac"));
        assert_eq!(info.audio_stream, Some(1));
    }
    #[test]
    fn rejects_missing_size() {
        assert!(parse_video_info("Duration: 00:00:01.00").is_err());
    }
}
