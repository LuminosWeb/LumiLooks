use std::path::Path;
use std::process::Command;

/// Tauri refuses to build when the FFmpeg sidecar (`externalBin`) is missing: fetch it on first build.
fn ensure_ffmpeg_sidecar() {
    let target = std::env::var("TARGET").unwrap_or_default();
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let exe = if target.contains("windows") { ".exe" } else { "" };
    let sidecar = Path::new(&manifest).join("binaries").join(format!("ffmpeg-{target}{exe}"));
    println!("cargo:rerun-if-changed={}", sidecar.display());
    if sidecar.is_file() {
        return;
    }
    let script = Path::new(&manifest).join("..").join("scripts").join("fetch-ffmpeg.mjs");
    let node = if cfg!(windows) { "node.exe" } else { "node" };
    match Command::new(node).arg(&script).args(["--target", &target]).status() {
        Ok(status) if status.success() => {}
        Ok(status) => println!("cargo:warning=Téléchargement du sidecar FFmpeg échoué ({status}). Lancez `npm run ffmpeg`."),
        Err(error) => println!("cargo:warning=Node.js est requis pour télécharger FFmpeg ({error}). Lancez `npm run ffmpeg`."),
    }
}

fn main() {
    ensure_ffmpeg_sidecar();
    tauri_build::build()
}
