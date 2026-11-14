//! Imported media registry and the local HTTP server that streams files to the webview with range support.
use crate::ffmpeg::{probe_video, VideoInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub const IMAGE_EXT: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "avif", "gif"];
pub const VIDEO_EXT: &[&str] = &["mp4", "mov", "mkv", "webm", "m4v", "avi"];

#[derive(Default)]
pub struct MediaRegistry {
    files: Mutex<HashMap<String, PathBuf>>,
}

impl MediaRegistry {
    pub fn get(&self, id: &str) -> Option<PathBuf> {
        self.files.lock().ok()?.get(id).cloned()
    }
    pub fn insert(&self, path: PathBuf) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        if let Ok(mut files) = self.files.lock() {
            files.insert(id.clone(), path);
        }
        id
    }
    pub fn contains_path(&self, candidate: &Path) -> bool {
        let candidate = normalize(candidate);
        self.files.lock().map(|files| files.values().any(|p| normalize(p) == candidate)).unwrap_or(false)
    }
}

pub fn normalize(path: &Path) -> String {
    let p = path.canonicalize().unwrap_or_else(|_| path.to_path_buf()).to_string_lossy().to_string();
    if cfg!(windows) || cfg!(target_os = "macos") {
        p.to_lowercase()
    } else {
        p
    }
}

pub fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedia {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<VideoInfo>,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub files: Vec<ImportedMedia>,
    pub errors: Vec<String>,
}

pub fn register(registry: &MediaRegistry, file: &Path) -> Result<ImportedMedia, String> {
    let ext = extension(file);
    let is_video = VIDEO_EXT.contains(&ext.as_str());
    if !is_video && !IMAGE_EXT.contains(&ext.as_str()) {
        return Err("Format non pris en charge. Utilisez une image JPG, PNG, WebP ou une vidéo MP4, MOV, MKV, WebM.".into());
    }
    let meta = std::fs::metadata(file).map_err(|_| "Ce fichier est introuvable.".to_string())?;
    if !meta.is_file() {
        return Err("Ce fichier est introuvable.".into());
    }
    let video = if is_video { Some(probe_video(file)?) } else { None };
    let id = registry.insert(file.to_path_buf());
    Ok(ImportedMedia {
        id,
        name: file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        path: file.to_string_lossy().to_string(),
        kind: if is_video { "video" } else { "image" }.into(),
        size: meta.len(),
        video,
    })
}

#[tauri::command]
pub async fn import_paths(app: AppHandle, paths: Vec<String>) -> Result<ImportResult, String> {
    if paths.len() > 200 {
        return Err("Importez au maximum 200 fichiers à la fois.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<MediaRegistry>();
        let mut files = Vec::new();
        let mut errors = Vec::new();
        for raw in paths {
            let path = PathBuf::from(&raw);
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(raw.clone());
            if path.is_dir() {
                errors.push(format!("{name} : importez des fichiers, pas un dossier."));
                continue;
            }
            match register(&registry, &path) {
                Ok(media) => files.push(media),
                Err(e) => errors.push(format!("{name} : {e}")),
            }
        }
        Ok(ImportResult { files, errors })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn media_path(registry: State<'_, MediaRegistry>, id: String) -> Option<String> {
    registry.get(&id).map(|p| p.to_string_lossy().to_string())
}

pub fn content_type(path: &Path) -> &'static str {
    match extension(path).as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

/// Parses a single `bytes=a-b` range. `None` means unsatisfiable; `Some(None)` means no range requested.
pub fn byte_range(header: Option<&str>, size: u64) -> Option<Option<(u64, u64)>> {
    let Some(header) = header else { return Some(None) };
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || size == 0 {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", "") => return None,
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            (size.saturating_sub(n), size - 1)
        }
        (s, "") => (s.parse().ok()?, size - 1),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(size - 1)),
    };
    if start >= size || end < start {
        return None;
    }
    Some(Some((start, end)))
}

/// Private HTTP server on 127.0.0.1 that streams imported media to the webview with range requests.
/// Every platform's media stack plays plain HTTP reliably (custom URL schemes fail for <video> on Linux).
/// URLs carry a random per-session token and an unguessable media id.
pub struct MediaServer {
    pub port: u16,
    pub token: String,
}

#[derive(Serialize)]
pub struct MediaServerInfo {
    base: String,
}

#[tauri::command]
pub fn media_server(server: State<'_, MediaServer>) -> MediaServerInfo {
    MediaServerInfo { base: format!("http://127.0.0.1:{}/{}/", server.port, server.token) }
}

pub fn start_server(app: AppHandle) -> std::io::Result<MediaServer> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let token = uuid::Uuid::new_v4().simple().to_string();
    let secret = token.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let secret = secret.clone();
            std::thread::spawn(move || {
                let _ = serve_connection(stream, &app, &secret);
            });
        }
    });
    Ok(MediaServer { port, token })
}

struct HttpRequest {
    method: String,
    path: String,
    range: Option<String>,
    close: bool,
}

fn read_request(reader: &mut impl std::io::BufRead) -> std::io::Result<Option<HttpRequest>> {
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let http10 = parts.next().map(|v| v.eq_ignore_ascii_case("HTTP/1.0")).unwrap_or(false);
    let mut range = None;
    let mut close = http10;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            return Ok(None);
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            let value = value.trim();
            match name.trim().to_ascii_lowercase().as_str() {
                "range" => range = Some(value.to_string()),
                "connection" => close = value.eq_ignore_ascii_case("close"),
                _ => {}
            }
        }
    }
    Ok(Some(HttpRequest { method, path, range, close }))
}

fn write_head(out: &mut impl Write, status: &str, headers: &[(&str, String)], close: bool) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\nCache-Control: no-store\r\nConnection: {}\r\n", if close { "close" } else { "keep-alive" });
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    out.write_all(head.as_bytes())
}

fn serve_connection(stream: std::net::TcpStream, app: &AppHandle, token: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(120)))?;
    let _ = stream.set_nodelay(true);
    let mut reader = std::io::BufReader::new(stream.try_clone()?);
    let mut out = std::io::BufWriter::with_capacity(256 * 1024, stream);
    while let Some(request) = read_request(&mut reader)? {
        let close = request.close;
        if request.method == "OPTIONS" {
            write_head(&mut out, "204 No Content", &[("Content-Length", "0".into())], close)?;
        } else if request.method != "GET" && request.method != "HEAD" {
            write_head(&mut out, "405 Method Not Allowed", &[("Content-Length", "0".into())], true)?;
            out.flush()?;
            return Ok(());
        } else {
            let id = request.path.split('?').next().unwrap_or("").strip_prefix(&format!("/{token}/")).map(|id| percent_encoding::percent_decode_str(id).decode_utf8_lossy().to_string());
            let file = id.and_then(|id| app.state::<MediaRegistry>().get(&id));
            match file.and_then(|path| File::open(&path).ok().map(|f| (path, f))) {
                None => write_head(&mut out, "404 Not Found", &[("Content-Length", "0".into())], close)?,
                Some((path, mut f)) => {
                    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
                    let kind = ("Content-Type", content_type(&path).to_string());
                    let ranges = ("Accept-Ranges", "bytes".to_string());
                    let head_only = request.method == "HEAD";
                    match byte_range(request.range.as_deref(), size) {
                        None => write_head(&mut out, "416 Range Not Satisfiable", &[("Content-Range", format!("bytes */{size}")), ("Content-Length", "0".into())], close)?,
                        Some(range) => {
                            let (start, end, status) = match range {
                                None => (0, size.saturating_sub(1), "200 OK"),
                                Some((a, b)) => (a, b, "206 Partial Content"),
                            };
                            let length = if size == 0 { 0 } else { end - start + 1 };
                            let mut headers = vec![kind, ranges, ("Content-Length", length.to_string())];
                            if range.is_some() {
                                headers.push(("Content-Range", format!("bytes {start}-{end}/{size}")));
                            }
                            write_head(&mut out, status, &headers, close)?;
                            if !head_only && length > 0 {
                                f.seek(SeekFrom::Start(start))?;
                                std::io::copy(&mut (&mut f).take(length), &mut out)?;
                            }
                        }
                    }
                }
            }
        }
        out.flush()?;
        if close {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges() {
        assert_eq!(byte_range(None, 100), Some(None));
        assert_eq!(byte_range(Some("bytes=0-"), 100), Some(Some((0, 99))));
        assert_eq!(byte_range(Some("bytes=10-19"), 100), Some(Some((10, 19))));
        assert_eq!(byte_range(Some("bytes=-10"), 100), Some(Some((90, 99))));
        assert_eq!(byte_range(Some("bytes=95-500"), 100), Some(Some((95, 99))));
        assert_eq!(byte_range(Some("bytes=100-"), 100), None);
        assert_eq!(byte_range(Some("bytes=5-2"), 100), None);
        assert_eq!(byte_range(Some("items=0-1"), 100), None);
    }
}
