//! Text files (LUT / corrections), image export (PNG, JPEG, WebP, PDF) and projects.
use crate::media::{extension, register, MediaRegistry};
use crate::pdf::create_image_pdf;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

pub fn with_extension(path: &Path, ext: &str) -> PathBuf {
    let known = ["mp4", "webm", "mov", "avi", "wmv", "png", "jpg", "jpeg", "webp", "pdf", "cube", "lumilook", "lumilooks"];
    if known.contains(&extension(path).as_str()) {
        path.with_extension(ext)
    } else {
        let mut s = path.as_os_str().to_owned();
        s.push(format!(".{ext}"));
        PathBuf::from(s)
    }
}

#[tauri::command]
pub async fn read_text(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !["cube", "lumilook", "json"].contains(&extension(&path).as_str()) {
        return Err("Choisissez un fichier .cube ou .lumilook.".into());
    }
    let meta = std::fs::metadata(&path).map_err(|_| "Fichier introuvable.".to_string())?;
    if meta.len() > 60_000_000 {
        return Err("Fichier trop volumineux (60 Mo maximum).".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub async fn write_text(registry: State<'_, MediaRegistry>, path: String, text: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !["cube", "lumilook"].contains(&extension(&path).as_str()) {
        return Err("Extension de fichier non autorisée.".into());
    }
    if text.len() > 80_000_000 {
        return Err("Fichier trop volumineux.".into());
    }
    if registry.contains_path(&path) {
        return Err("Choisissez un autre nom pour conserver vos médias originaux.".into());
    }
    std::fs::write(&path, text).map_err(|e| format!("Écriture impossible : {e}"))
}

fn header(request: &Request<'_>, name: &str) -> Option<String> {
    request.headers().get(name).and_then(|v| v.to_str().ok()).map(|v| percent_encoding::percent_decode_str(v).decode_utf8_lossy().to_string())
}

fn check_signature(format: &str, bytes: &[u8]) -> bool {
    match format {
        "png" => bytes.starts_with(&[0x89, b'P', b'N', b'G']),
        "jpg" | "jpeg" => bytes.starts_with(&[0xFF, 0xD8]),
        "webp" => bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

/// Saves an exported photo. The body is the encoded image, or raw RGBA pixels for a PDF.
#[tauri::command]
pub async fn save_image(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let path = header(&request, "x-path").ok_or("Destination manquante.")?;
    let format = header(&request, "x-format").unwrap_or_default().to_lowercase();
    let InvokeBody::Raw(bytes) = request.body() else { return Err("Données image invalides.".into()) };
    let ext = match format.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "pdf" => format.clone(),
        _ => return Err("Format image non pris en charge.".into()),
    };
    let output = with_extension(Path::new(&path), &ext);
    if app.state::<MediaRegistry>().contains_path(&output) {
        return Err("Choisissez un autre nom pour conserver votre original.".into());
    }
    if output.to_string_lossy() != path && output.exists() {
        return Err("Un fichier porte déjà ce nom avec cette extension. Choisissez un autre nom.".into());
    }
    let data = if format == "pdf" {
        let width: u32 = header(&request, "x-width").and_then(|v| v.parse().ok()).unwrap_or(0);
        let height: u32 = header(&request, "x-height").and_then(|v| v.parse().ok()).unwrap_or(0);
        if width == 0 || height == 0 || bytes.len() != width as usize * height as usize * 4 {
            return Err("Dimensions de l’image PDF incohérentes.".into());
        }
        create_image_pdf(width, height, bytes)?
    } else {
        if bytes.len() > 768_000_000 || !check_signature(&format, bytes) {
            return Err("Données image invalides pour le format choisi.".into());
        }
        bytes.clone()
    };
    std::fs::write(&output, data).map_err(|e| format!("Écriture impossible : {e}"))?;
    Ok(output.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_project(registry: State<'_, MediaRegistry>, path: String, project: Value) -> Result<(), String> {
    let path = with_extension(Path::new(&path), "lumilooks");
    let files = project.get("files").and_then(|f| f.as_array()).ok_or("Projet invalide.")?;
    let mut saved = Vec::new();
    for item in files {
        let Some(obj) = item.as_object() else { continue };
        let Some(media) = obj.get("id").and_then(|v| v.as_str()).and_then(|id| registry.get(id)) else { continue };
        let mut entry: Map<String, Value> = obj.clone();
        entry.insert("path".into(), Value::String(media.to_string_lossy().to_string()));
        saved.push(Value::Object(entry));
    }
    let name: String = project.get("name").and_then(|v| v.as_str()).unwrap_or("Mon projet").chars().take(160).collect();
    let data = json!({ "format": "LumiLooks", "version": 2, "app": format!("LumiLooks {}", env!("CARGO_PKG_VERSION")), "name": name, "active": project.get("active").cloned().unwrap_or(json!(0)), "files": saved });
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("Écriture impossible : {e}"))
}

#[derive(Serialize)]
pub struct OpenedProject {
    name: String,
    active: u64,
    files: Vec<Value>,
    errors: Vec<String>,
}

#[tauri::command]
pub async fn open_project(app: AppHandle, path: String) -> Result<OpenedProject, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<MediaRegistry>();
        let meta = std::fs::metadata(&path).map_err(|_| "Projet introuvable.".to_string())?;
        if meta.len() > 80_000_000 {
            return Err("Projet trop volumineux.".into());
        }
        let data: Value = serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?).map_err(|_| "Ce projet LumiLooks est invalide.".to_string())?;
        let version = data.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
        let files = data.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
        if data.get("format").and_then(|v| v.as_str()) != Some("LumiLooks") || !(1..=2).contains(&version) || files.len() > 200 {
            return Err("Ce projet LumiLooks est invalide.".into());
        }
        let mut opened = Vec::new();
        let mut errors = Vec::new();
        for item in files {
            let Some(obj) = item.as_object() else { continue };
            let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("média").to_string();
            let Some(file) = obj.get("path").and_then(|v| v.as_str()) else { continue };
            match register(&registry, Path::new(file)) {
                Ok(media) => {
                    let mut entry = obj.clone();
                    let fresh = serde_json::to_value(&media).map_err(|e| e.to_string())?;
                    if let Value::Object(fresh) = fresh {
                        for (k, v) in fresh {
                            entry.insert(k, v);
                        }
                    }
                    opened.push(Value::Object(entry));
                }
                Err(_) => errors.push(format!("Fichier manquant : {name}")),
            }
        }
        Ok(OpenedProject {
            name: data.get("name").and_then(|v| v.as_str()).unwrap_or("Mon projet").chars().take(160).collect(),
            active: data.get("active").and_then(|v| v.as_u64()).unwrap_or(0),
            files: opened,
            errors,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extensions() {
        assert_eq!(with_extension(Path::new("/a/b.mp4"), "webm"), PathBuf::from("/a/b.webm"));
        assert_eq!(with_extension(Path::new("/a/b"), "png"), PathBuf::from("/a/b.png"));
        assert_eq!(with_extension(Path::new("/a/b.final"), "png"), PathBuf::from("/a/b.final.png"));
        assert!(check_signature("png", &[0x89, b'P', b'N', b'G', 0, 0]));
        assert!(!check_signature("jpg", &[0x89, b'P']));
    }
}
