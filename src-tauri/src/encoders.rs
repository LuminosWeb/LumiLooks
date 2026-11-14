//! Video encoders: CPU (x264, VP9, WMV2) and GPU (NVENC, AMF, Quick Sync, VideoToolbox) with a target bitrate.
use crate::ffmpeg::run_capture;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct EngineInfo {
    pub name: String,
    pub label: String,
    pub hardware: bool,
}

#[derive(Debug, Clone)]
pub struct Engine {
    pub info: EngineInfo,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EncoderSupport {
    pub cpu: EngineInfo,
    pub gpu: Option<EngineInfo>,
    pub diagnostics: Vec<String>,
}

pub const FORMATS: &[&str] = &["mp4", "webm", "mov", "avi", "wmv"];
pub const QUALITIES: &[&str] = &["compact", "high", "maximum"];

fn pick<'a>(quality: &str, compact: &'a str, high: &'a str, maximum: &'a str) -> &'a str {
    match quality {
        "compact" => compact,
        "maximum" => maximum,
        _ => high,
    }
}

/// FFmpeg arguments for one encoder. `kbps` is the average video bitrate; peaks may reach 1.5×.
pub fn encoder_settings(name: &str, quality: &str, kbps: u32) -> Result<Engine, String> {
    let b = format!("{kbps}k");
    let max = format!("{}k", kbps.saturating_mul(3) / 2);
    let buf = format!("{}k", kbps.saturating_mul(2));
    let (label, hardware, args): (&str, bool, Vec<&str>) = match name {
        "libx264" => ("Processeur · x264", false, vec!["-c:v", "libx264", "-preset", pick(quality, "veryfast", "medium", "slow"), "-b:v", &b, "-maxrate", &max, "-bufsize", &buf, "-pix_fmt", "yuv420p"]),
        "libvpx-vp9" => ("Processeur · VP9", false, vec!["-c:v", "libvpx-vp9", "-b:v", &b, "-maxrate", &max, "-bufsize", &buf, "-deadline", "good", "-cpu-used", pick(quality, "5", "3", "1"), "-row-mt", "1", "-pix_fmt", "yuv420p"]),
        "wmv2" => ("Processeur · WMV", false, vec!["-c:v", "wmv2", "-b:v", &b, "-pix_fmt", "yuv420p"]),
        "h264_nvenc" => ("NVIDIA NVENC", true, vec!["-c:v", "h264_nvenc", "-preset", pick(quality, "p3", "p5", "p7"), "-tune", "hq", "-rc", "vbr", "-b:v", &b, "-maxrate", &max, "-bufsize", &buf, "-pix_fmt", "yuv420p"]),
        "h264_amf" => ("AMD AMF", true, vec!["-c:v", "h264_amf", "-usage", "transcoding", "-quality", pick(quality, "speed", "balanced", "quality"), "-rc", "vbr_peak", "-b:v", &b, "-maxrate", &max, "-bufsize", &buf, "-pix_fmt", "yuv420p"]),
        "h264_qsv" => ("Intel Quick Sync", true, vec!["-c:v", "h264_qsv", "-preset", pick(quality, "veryfast", "medium", "veryslow"), "-b:v", &b, "-maxrate", &max, "-bufsize", &buf, "-pix_fmt", "nv12"]),
        "h264_videotoolbox" => ("Apple VideoToolbox", true, vec!["-c:v", "h264_videotoolbox", "-b:v", &b, "-allow_sw", "0", "-realtime", "0", "-pix_fmt", "yuv420p"]),
        "av1_nvenc" => ("NVIDIA NVENC AV1", true, vec!["-c:v", "av1_nvenc", "-preset", pick(quality, "p3", "p5", "p7"), "-tune", "hq", "-rc", "vbr", "-b:v", &b, "-maxrate", &max, "-bufsize", &buf, "-pix_fmt", "yuv420p"]),
        "av1_amf" => ("AMD AMF AV1", true, vec!["-c:v", "av1_amf", "-usage", "transcoding", "-quality", pick(quality, "speed", "balanced", "quality"), "-rc", "vbr_peak", "-b:v", &b, "-maxrate", &max, "-pix_fmt", "yuv420p"]),
        "av1_qsv" => ("Intel Quick Sync AV1", true, vec!["-c:v", "av1_qsv", "-preset", pick(quality, "veryfast", "medium", "veryslow"), "-b:v", &b, "-maxrate", &max, "-bufsize", &buf, "-pix_fmt", "nv12"]),
        _ => return Err("Encodeur vidéo inconnu.".into()),
    };
    Ok(Engine { info: EngineInfo { name: name.into(), label: label.into(), hardware }, args: args.into_iter().map(String::from).collect() })
}

pub fn cpu_encoder(format: &str) -> &'static str {
    match format {
        "webm" => "libvpx-vp9",
        "wmv" => "wmv2",
        _ => "libx264",
    }
}

pub fn gpu_candidates(format: &str) -> Vec<&'static str> {
    match format {
        "wmv" => vec![],
        "webm" => {
            if cfg!(target_os = "macos") {
                vec![]
            } else {
                vec!["av1_nvenc", "av1_amf", "av1_qsv"]
            }
        }
        _ => {
            if cfg!(target_os = "macos") {
                vec!["h264_videotoolbox"]
            } else if cfg!(windows) {
                vec!["h264_nvenc", "h264_amf", "h264_qsv"]
            } else {
                vec!["h264_nvenc", "h264_qsv"]
            }
        }
    }
}

pub fn validate(format: &str, width: u32, height: u32, fps: u32) -> Result<(), String> {
    if !FORMATS.contains(&format) {
        return Err("Format vidéo non pris en charge.".into());
    }
    if !(2..=8192).contains(&width) || !(2..=8192).contains(&height) || width % 2 != 0 || height % 2 != 0 {
        return Err("Dimensions d’export invalides.".into());
    }
    if ![24, 25, 30, 60].contains(&fps) {
        return Err("Cadence d’export invalide.".into());
    }
    Ok(())
}

/// Caches which GPU encoder works on this machine for a given format and size.
#[derive(Default)]
pub struct EncoderCache {
    entries: Mutex<HashMap<String, (Option<String>, Vec<String>)>>,
}

impl EncoderCache {
    pub fn detect_gpu(&self, format: &str, width: u32, height: u32, fps: u32) -> (Option<String>, Vec<String>) {
        let key = format!("{format}:{width}:{height}:{fps}");
        if let Some(found) = self.entries.lock().ok().and_then(|e| e.get(&key).cloned()) {
            return found;
        }
        let mut diagnostics = Vec::new();
        let mut found = None;
        for name in gpu_candidates(format) {
            let Ok(engine) = encoder_settings(name, "high", 4000) else { continue };
            let mut args: Vec<String> = ["-v", "error", "-f", "lavfi", "-i", &format!("color=c=black:s={width}x{height}:r={fps}"), "-frames:v", "1", "-an"]
                .iter()
                .map(|s| s.to_string())
                .collect();
            args.extend(engine.args.clone());
            args.extend(["-f", "null", "-"].iter().map(|s| s.to_string()));
            match run_capture(&args, Duration::from_secs(10)) {
                Ok(out) if out.ok => {
                    found = Some(name.to_string());
                    break;
                }
                Ok(out) => diagnostics.push(format!("{name}: {}", out.log.lines().last().unwrap_or("indisponible"))),
                Err(e) => diagnostics.push(format!("{name}: {e}")),
            }
        }
        let result = (found, diagnostics);
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(key, result.clone());
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bitrate_args() {
        let e = encoder_settings("libx264", "maximum", 8000).unwrap();
        let joined = e.args.join(" ");
        assert!(joined.contains("-preset slow"));
        assert!(joined.contains("-b:v 8000k -maxrate 12000k -bufsize 16000k"));
        assert!(!e.info.hardware);
        let g = encoder_settings("h264_nvenc", "compact", 5000).unwrap();
        assert!(g.info.hardware && g.args.join(" ").contains("-preset p3"));
        assert!(encoder_settings("nope", "high", 1).is_err());
    }
    #[test]
    fn validation() {
        assert!(validate("mp4", 1920, 1080, 30).is_ok());
        assert!(validate("mp4", 1921, 1080, 30).is_err());
        assert!(validate("flv", 1920, 1080, 30).is_err());
        assert!(validate("mp4", 1920, 1080, 29).is_err());
        assert_eq!(cpu_encoder("webm"), "libvpx-vp9");
        assert!(gpu_candidates("wmv").is_empty());
    }
}
