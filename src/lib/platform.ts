/* Bridge to the Tauri backend, with a browser fallback used for development and UI tests. */
import { invoke } from '@tauri-apps/api/core';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const APP_VERSION = __APP_VERSION__;
export const WEBSITE_URL = 'https://luminosweb.com/?utm_source=lumilooks&utm_medium=desktop_app&utm_campaign=lumilooks';
export const DOWNLOAD_URL = 'https://lumilooks.luminosweb.com';

export const imageExtensions = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif', 'gif'];
export const videoExtensions = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'];

export interface VideoInfo { width: number; height: number; duration: number; fps: number; audioCodec?: string; audioStream?: number }
export interface ImportedMedia { id: string; name: string; url: string; path?: string; type: 'image' | 'video'; size?: number; video?: VideoInfo }
export interface ImportResult { files: ImportedMedia[]; errors: string[] }
export interface EngineInfo { name: string; label: string; hardware: boolean }
export interface EncoderSupport { cpu: EngineInfo; gpu: EngineInfo | null; diagnostics?: string[] }

/* Imported files are streamed by the backend's private 127.0.0.1 server (range requests, CORS). */
let mediaBase: string | null = null;
export async function initMediaServer() {
  if (isTauri && !mediaBase) mediaBase = (await invoke<{ base: string }>('media_server')).base;
  return mediaBase;
}
export const mediaUrl = (id: string) => (mediaBase || '') + encodeURIComponent(id);

export async function importPaths(paths: string[]): Promise<ImportResult> {
  await initMediaServer();
  const result = await invoke<{ files: Omit<ImportedMedia, 'url'>[]; errors: string[] }>('import_paths', { paths });
  return { files: result.files.map((file) => ({ ...file, url: mediaUrl(file.id) })), errors: result.errors };
}

export async function pickMediaPaths(): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ title: 'Importer des images ou des vidéos', multiple: true, directory: false, filters: [{ name: 'Images et vidéos', extensions: [...imageExtensions, ...videoExtensions] }] });
  return result ? (Array.isArray(result) ? result : [result]) : [];
}

/* Automated tests set these to bypass native dialogs; they are consumed once. */
function forcedPath(key: '__lumilooksNextSavePath' | '__lumilooksNextOpenPath') {
  const w = window as unknown as Record<string, unknown>, value = w[key];
  if (typeof value !== 'string') return null;
  delete w[key];
  return value;
}

export async function pickOpenPath(title: string, filters: { name: string; extensions: string[] }[]) {
  const forced = forcedPath('__lumilooksNextOpenPath');
  if (forced) return forced;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ title, multiple: false, directory: false, filters });
  return typeof result === 'string' ? result : null;
}

export async function pickSavePath(title: string, defaultPath: string, filters: { name: string; extensions: string[] }[]) {
  const forced = forcedPath('__lumilooksNextSavePath');
  if (forced) return forced;
  const { save } = await import('@tauri-apps/plugin-dialog');
  return (await save({ title, defaultPath, filters })) || null;
}

export async function askConfirm(message: string, title: string, okLabel: string, cancelLabel: string) {
  if (!isTauri) return window.confirm(message);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(message, { title, kind: 'warning', okLabel, cancelLabel });
}

export const readText = (path: string) => invoke<string>('read_text', { path });
export const writeText = (path: string, text: string) => invoke<void>('write_text', { path, text });

const encodePath = (path: string) => encodeURIComponent(path);
/** Writes an encoded image (PNG/JPEG/WebP), or an RGBA buffer that the backend turns into a PDF. */
export function saveImage(path: string, format: string, bytes: Uint8Array, width = 0, height = 0) {
  return invoke<string>('save_image', bytes, { headers: { 'x-path': encodePath(path), 'x-format': format, 'x-width': String(width), 'x-height': String(height) } });
}

export const saveProject = (path: string, project: unknown) => invoke<void>('save_project', { path, project });
export const openProject = async (path: string) => { await initMediaServer(); return openProjectRaw(path); };
const openProjectRaw = (path: string) => invoke<{ name: string; active: number; files: (Omit<ImportedMedia, 'url'> & Record<string, unknown>)[]; errors: string[] }>('open_project', { path });

export const detectEncoders = (opts: { format: string; width: number; height: number; fps: number }) => invoke<EncoderSupport>('detect_encoders', { opts });
export interface VideoExportOptions {
  id: string; output: string; start: number; end: number; speed: number; volume: number; audio: boolean; rotation: number; aspect: string;
  resolution: string; fps: number; quality: string; format: string; encoder: 'cpu' | 'gpu'; bitrate: number;
}
export const exportStart = (opts: VideoExportOptions) => invoke<{ width: number; height: number; sourceWidth: number; sourceHeight: number; crop: [number, number]; total: number; fps: number; engine: EngineInfo }>('export_start', { opts });
export const exportReadFrame = () => invoke<ArrayBuffer>('export_read_frame');
export const exportWriteFrame = (frame: Uint8Array) => invoke<number>('export_write_frame', frame);
export const exportFinish = () => invoke<string>('export_finish');
export const exportCancel = () => invoke<void>('export_cancel');

export async function openWebsite(url = WEBSITE_URL) {
  if (!isTauri) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}
export async function revealFile(path: string) {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

export async function appWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export async function setWindowFullscreen(on: boolean) {
  if (isTauri) { (await appWindow()).setFullscreen(on); return; }
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch { /* The browser may refuse; the in-app fullscreen layout still applies. */ }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function baseName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
export function stem(name: string) {
  return name.replace(/\.[^.]+$/, '');
}
