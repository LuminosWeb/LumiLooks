//! LumiLooks desktop backend (Tauri v2).
mod encoders;
mod export;
mod ffmpeg;
mod ffmpeg_install;
mod files;
mod media;
mod pdf;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
struct PlatformInfo {
    os: &'static str,
    arch: &'static str,
    version: &'static str,
    ffmpeg: String,
}

#[tauri::command]
fn platform_info() -> PlatformInfo {
    PlatformInfo { os: std::env::consts::OS, arch: std::env::consts::ARCH, version: env!("CARGO_PKG_VERSION"), ffmpeg: ffmpeg::ffmpeg_path().to_string_lossy().to_string() }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(media::MediaRegistry::default())
        .manage(export::ExportState::default())
        .manage(encoders::EncoderCache::default())
        .setup(|app| {
            if let Ok(dir) = app.path().app_local_data_dir() {
                ffmpeg_install::set_data_dir(dir);
            }
            let server = media::start_server(app.handle().clone())?;
            app.manage(server);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_info,
            ffmpeg_install::ffmpeg_status,
            ffmpeg_install::ffmpeg_install,
            media::import_paths,
            media::media_path,
            media::media_server,
            files::read_text,
            files::write_text,
            files::save_image,
            files::save_project,
            files::open_project,
            export::detect_encoders,
            export::export_start,
            export::export_read_frame,
            export::export_write_frame,
            export::export_finish,
            export::export_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("LumiLooks n’a pas pu démarrer");
}
