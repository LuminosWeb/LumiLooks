//! Makes sure a working FFmpeg is available on Windows, macOS and Linux.
//!
//! Resolution order: `LUMILOOKS_FFMPEG` → the sidecar bundled next to the executable → a copy LumiLooks
//! downloaded earlier into its data folder. When none of them starts, the frontend asks for `ffmpeg_install`,
//! which downloads the pinned static build (SHA-256 checked) for this platform. If the download is impossible
//! (offline, proxy…), an FFmpeg already installed on the system is used as a last resort.
use crate::ffmpeg;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const FFMPEG_VERSION: &str = "6.1.1";
const RELEASE: &str = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/";
const MAX_DOWNLOAD: usize = 120 * 1024 * 1024;

struct Asset {
    name: &'static str,
    sha256: &'static str,
    size: u64,
}

/// Pinned build for the running platform (digests published by GitHub for release b6.1.1).
fn asset() -> Option<Asset> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    Some(match (os, arch) {
        // Windows on Arm runs the x64 build through emulation.
        ("windows", "x86_64" | "aarch64") => Asset { name: "ffmpeg-win32-x64.gz", sha256: "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77", size: 29_581_307 },
        ("macos", "aarch64") => Asset { name: "ffmpeg-darwin-arm64.gz", sha256: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa", size: 19_246_198 },
        ("macos", "x86_64") => Asset { name: "ffmpeg-darwin-x64.gz", sha256: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106", size: 25_296_431 },
        ("linux", "x86_64") => Asset { name: "ffmpeg-linux-x64.gz", sha256: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa", size: 29_354_986 },
        ("linux", "aarch64") => Asset { name: "ffmpeg-linux-arm64.gz", sha256: "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0", size: 25_568_691 },
        _ => return None,
    })
}

static INSTALL_DIR: OnceLock<PathBuf> = OnceLock::new();
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

/// Called once at startup with the app's local data folder.
pub fn set_data_dir(dir: PathBuf) {
    let _ = INSTALL_DIR.set(dir.join("ffmpeg").join(FFMPEG_VERSION));
}

fn installed_path() -> Option<PathBuf> {
    INSTALL_DIR.get().map(|dir| dir.join(ffmpeg::exe_name()))
}

/// True when the binary starts and answers `-version` within a few seconds.
pub fn works(path: &Path) -> bool {
    if path.components().count() > 1 && !path.is_file() {
        return false;
    }
    #[allow(unused_mut)]
    let mut command = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let Ok(mut child) = command.args(["-hide_banner", "-version"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() else {
        return false;
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if started.elapsed() > Duration::from_secs(20) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
            Err(_) => return false,
        }
    }
}

/// FFmpeg already installed on the computer. GUI apps on macOS do not inherit the shell PATH, so the usual
/// Homebrew / MacPorts folders are searched too.
fn system_candidates() -> Vec<PathBuf> {
    let name = ffmpeg::exe_name();
    let mut list: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).map(|d| d.join(name)).collect()).unwrap_or_default();
    let extra: &[&str] = if cfg!(target_os = "macos") {
        &["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]
    } else if cfg!(target_os = "linux") {
        &["/usr/bin", "/usr/local/bin", "/snap/bin"]
    } else {
        &[]
    };
    list.extend(extra.iter().map(|d| Path::new(d).join(name)));
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        // winget installs a shim here even when PATH was not refreshed yet.
        list.push(PathBuf::from(local).join("Microsoft").join("WinGet").join("Links").join(name));
    }
    list.dedup();
    list
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub ready: bool,
    /// `override`, `bundled`, `installed`, `system` or `missing`.
    pub source: &'static str,
    pub path: Option<String>,
    /// False on platforms without a downloadable build.
    pub installable: bool,
}

fn status(source: &'static str, path: Option<PathBuf>) -> FfmpegStatus {
    if let Some(p) = &path {
        ffmpeg::set_resolved(p.clone());
    }
    FfmpegStatus { ready: path.is_some(), source, path: path.map(|p| p.to_string_lossy().to_string()), installable: asset().is_some() }
}

/// Bundled or previously downloaded FFmpeg, without touching the network.
fn resolve_local() -> Option<(&'static str, PathBuf)> {
    if let Some(path) = ffmpeg::override_path() {
        return Some(("override", path));
    }
    if let Some(path) = ffmpeg::bundled_path().filter(|p| works(p)) {
        return Some(("bundled", path));
    }
    installed_path().filter(|p| works(p)).map(|p| ("installed", p))
}

fn resolve_system() -> Option<PathBuf> {
    system_candidates().into_iter().find(|p| p.is_file() && works(p))
}

#[tauri::command]
pub async fn ffmpeg_status() -> FfmpegStatus {
    tauri::async_runtime::spawn_blocking(|| match resolve_local() {
        Some((source, path)) => status(source, Some(path)),
        None if asset().is_none() => match resolve_system() {
            Some(path) => status("system", Some(path)),
            None => status("missing", None),
        },
        None => {
            ffmpeg::set_installing(true);
            status("missing", None)
        }
    })
    .await
    .unwrap_or_else(|_| status("missing", None))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    downloaded: u64,
    total: u64,
}

#[tauri::command]
pub async fn ffmpeg_install(app: AppHandle) -> Result<FfmpegStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((source, path)) = resolve_local() {
            return Ok(status(source, Some(path)));
        }
        ffmpeg::set_installing(true);
        let result = match download_and_install(&app) {
            Ok(path) => Ok(status("installed", Some(path))),
            Err(error) => match resolve_system() {
                Some(path) => Ok(status("system", Some(path))),
                None => Err(error),
            },
        };
        ffmpeg::set_installing(false);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

fn download_and_install(app: &AppHandle) -> Result<PathBuf, String> {
    let target = installed_path().ok_or("Dossier de données de LumiLooks indisponible.")?;
    install_to(&target, |stage, downloaded, total| {
        let _ = app.emit("ffmpeg-install", Progress { stage, downloaded, total });
    })
}

fn install_to(target: &Path, emit: impl Fn(&'static str, u64, u64)) -> Result<PathBuf, String> {
    let asset = asset().ok_or("Aucune version de FFmpeg n’est disponible pour ce système. Installez FFmpeg puis redémarrez LumiLooks.")?;
    let target = target.to_path_buf();
    let dir = target.parent().ok_or("Dossier d’installation invalide.")?.to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer {} : {e}", dir.display()))?;
    emit("download", 0, asset.size);
    let compressed = download(&format!("{RELEASE}{}", asset.name), asset.size, |done, total| emit("download", done, total))?;

    emit("verify", asset.size, asset.size);
    let digest = Sha256::digest(&compressed).iter().map(|b| format!("{b:02x}")).collect::<String>();
    if digest != asset.sha256 {
        return Err("Le fichier FFmpeg téléchargé est corrompu (empreinte SHA-256 incorrecte). Vérifiez votre connexion puis réessayez.".into());
    }

    emit("install", asset.size, asset.size);
    let partial = dir.join(format!("{}.part", ffmpeg::exe_name()));
    {
        let mut decoder = flate2::read::GzDecoder::new(compressed.as_slice());
        let mut file = std::fs::File::create(&partial).map_err(|e| format!("Écriture impossible dans {} : {e}", dir.display()))?;
        std::io::copy(&mut decoder, &mut file).map_err(|e| format!("Décompression de FFmpeg impossible : {e}"))?;
        file.flush().map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&target);
    std::fs::rename(&partial, &target).map_err(|e| format!("Installation de FFmpeg impossible : {e}"))?;
    prepare_for_launch(&target);
    if !works(&target) {
        let _ = std::fs::remove_file(&target);
        return Err("FFmpeg a été téléchargé mais ne démarre pas sur cet ordinateur.".into());
    }
    emit("done", asset.size, asset.size);
    Ok(target)
}

/// macOS refuses unsigned binaries on Apple Silicon and may quarantine downloads: sign ad hoc, clear quarantine.
fn prepare_for_launch(_path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let quiet = |program: &str, args: &[&std::ffi::OsStr]| {
            let _ = Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
        };
        let path = _path.as_os_str();
        quiet("/usr/bin/xattr", &["-d".as_ref(), "com.apple.quarantine".as_ref(), path]);
        if !works(_path) {
            quiet("/usr/bin/codesign", &["--force".as_ref(), "--sign".as_ref(), "-".as_ref(), path]);
        }
    }
}

fn download(url: &str, expected: u64, mut progress: impl FnMut(u64, u64)) -> Result<Vec<u8>, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout_read(Duration::from_secs(60))
        .user_agent(concat!("LumiLooks/", env!("CARGO_PKG_VERSION")))
        .try_proxy_from_env(true)
        .build();
    let mut last_error = String::new();
    for attempt in 1..=3u64 {
        match download_once(&agent, url, expected, &mut progress) {
            Ok(bytes) => return Ok(bytes),
            Err(error) => last_error = error,
        }
        std::thread::sleep(Duration::from_secs(attempt * 2));
    }
    Err(format!("Téléchargement de FFmpeg impossible : {last_error}. Vérifiez votre connexion Internet puis réessayez."))
}

fn download_once(agent: &ureq::Agent, url: &str, expected: u64, progress: &mut impl FnMut(u64, u64)) -> Result<Vec<u8>, String> {
    let response = agent.get(url).call().map_err(|e| e.to_string())?;
    let total = response.header("Content-Length").and_then(|v| v.parse::<u64>().ok()).unwrap_or(expected);
    let mut reader = response.into_reader();
    let mut bytes = Vec::with_capacity(total.min(MAX_DOWNLOAD as u64) as usize);
    let mut chunk = vec![0u8; 256 * 1024];
    let mut reported = Instant::now();
    loop {
        let read = reader.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > MAX_DOWNLOAD {
            return Err("fichier anormalement volumineux".into());
        }
        if reported.elapsed() > Duration::from_millis(120) {
            progress(bytes.len() as u64, total);
            reported = Instant::now();
        }
    }
    progress(bytes.len() as u64, total);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_targets_have_a_pinned_build() {
        let desktop = cfg!(any(windows, target_os = "macos", target_os = "linux"));
        let arch = matches!(std::env::consts::ARCH, "x86_64" | "aarch64");
        if desktop && arch {
            let asset = asset().expect("pinned FFmpeg build");
            assert_eq!(asset.sha256.len(), 64);
            assert!(asset.name.starts_with("ffmpeg-") && asset.name.ends_with(".gz"));
        }
    }
    #[test]
    fn missing_binary_does_not_work() {
        assert!(!works(Path::new("/definitely/not/here/ffmpeg")));
    }
    /// Real download (≈ 30 Mo): `cargo test -- --ignored downloads_and_runs`.
    #[test]
    #[ignore]
    fn downloads_and_runs() {
        let dir = std::env::temp_dir().join(format!("lumilooks-ffmpeg-test-{}", std::process::id()));
        let path = install_to(&dir.join(ffmpeg::exe_name()), |stage, done, total| eprintln!("{stage} {done}/{total}")).unwrap();
        assert!(works(&path));
        let _ = std::fs::remove_dir_all(dir);
    }
}
