/* Imperative side of the app: media sources, WebGL preview, histogram, thumbnails, playback and history. */
import { ColorRenderer, geometry } from '../lib/renderer';
import { defaults, presets, type Lut, type Preset } from '../lib/color';
import { Viewport } from './viewport';
import { activeFile, getState, setState, toast, updateFile, useStore, type MediaFile } from '../state/store';

export interface Runtime {
  source: HTMLImageElement | HTMLVideoElement;
  history: Snapshot[];
  historyIndex: number;
  needsThumbnails?: boolean;
  filmstripPending?: boolean;
}
type Snapshot = Pick<MediaFile, 'settings' | 'enabled' | 'preset' | 'rotation' | 'aspect' | 'start' | 'end' | 'speed' | 'volume' | 'audio' | 'lut' | 'lutName'>;

export const runtime = new Map<string, Runtime>();
let renderer: ColorRenderer | null = null, thumbRenderer: ColorRenderer | null = null, viewport: Viewport | null = null;
let previewCanvas: HTMLCanvasElement | null = null, histogramCanvas: HTMLCanvasElement | null = null;
let stageBox = { width: 0, height: 0 }, renderPending = false, lutDirty = true, histogramTime = 0, thumbnailVersion = 0, videoToken = 0;
let histogramScratch: HTMLCanvasElement | null = null, resizeObserver: ResizeObserver | null = null;

export const allPresets = (): Preset[] => { const s = getState(); return [...presets, ...s.bundled, ...s.customLooks]; };

/* ---------- Preview ---------- */
export function attachPreview(canvas: HTMLCanvasElement, stage: HTMLElement, wrap: HTMLElement) {
  previewCanvas = canvas;
  try {
    renderer = new ColorRenderer(canvas);
    thumbRenderer = new ColorRenderer(document.createElement('canvas'));
  } catch (error) {
    toast((error as Error).message, true);
  }
  viewport = new Viewport(stage, wrap, (zoom) => setState({ zoom }), scheduleRender);
  resizeObserver = new ResizeObserver((entries) => {
    const box = entries[0].contentRect;
    stageBox = { width: box.width, height: box.height };
    scheduleRender();
  });
  resizeObserver.observe(stage);
  lutDirty = true;
  scheduleRender();
  return () => { resizeObserver?.disconnect(); viewport?.dispose(); viewport = null; renderer?.dispose(); thumbRenderer?.dispose(); renderer = thumbRenderer = null; previewCanvas = null; };
}
export const attachHistogram = (canvas: HTMLCanvasElement | null) => { histogramCanvas = canvas; };
export const zoomBy = (factor: number) => viewport?.zoom(factor);
export const zoomFit = () => viewport?.reset();
export const getPreviewCanvas = () => previewCanvas;

export function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; renderPreview(); });
}

function previewLimit(native: { width: number; height: number }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const stageLongest = Math.max(stageBox.width, stageBox.height) * dpr;
  if (viewport?.isFit !== false) return Math.min(4096, Math.max(1280, stageLongest));
  return Math.min(4096, Math.max(1280, Math.max(native.width, native.height) * viewport.scale * dpr));
}

export function renderPreview() {
  const f = activeFile(), rt = f && runtime.get(f.id);
  if (!f || !rt?.source || !renderer) return;
  if (!Number.isFinite(f.width) || !Number.isFinite(f.height) || f.width < 1 || f.height < 1) return;
  if (f.type === 'video' && (rt.source as HTMLVideoElement).readyState < 2) return;
  if (lutDirty) { renderer.update(f.settings, f.enabled, f.lut); lutDirty = false; }
  const native = geometry(f.width, f.height, f.rotation, f.aspect);
  if (stageBox.width && stageBox.height) viewport?.layout(native.width, native.height, stageBox.width, stageBox.height, f.id);
  const g = geometry(f.width, f.height, f.rotation, f.aspect, previewLimit(native)), s = getState();
  const time = f.type === 'video' ? (rt.source as HTMLVideoElement).currentTime : 0;
  try {
    renderer.render(rt.source, f.width, f.height, { ...g, rotation: f.rotation, compare: s.compare, bypass: s.bypass, split: s.split, seed: 1 + Math.floor(time * 1000) });
  } catch (error) {
    toast((error as Error).message, true);
    return;
  }
  const playing = f.type === 'video' && !(rt.source as HTMLVideoElement).paused;
  if (performance.now() - histogramTime > (playing ? 400 : 120)) { drawHistogram(); histogramTime = performance.now(); }
}

export function drawHistogram() {
  if (!histogramCanvas || !previewCanvas) return;
  if (!histogramScratch) { histogramScratch = document.createElement('canvas'); histogramScratch.width = 180; histogramScratch.height = 100; }
  const ctx = histogramScratch.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, 180, 100);
  ctx.drawImage(previewCanvas, 0, 0, 180, 100);
  const data = ctx.getImageData(0, 0, 180, 100).data, bins = [new Uint32Array(64), new Uint32Array(64), new Uint32Array(64)];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) for (let c = 0; c < 3; c++) bins[c][data[i + c] >> 2]++;
  const graph = histogramCanvas, g = graph.getContext('2d')!, css = getComputedStyle(document.documentElement);
  g.clearRect(0, 0, graph.width, graph.height);
  g.strokeStyle = css.getPropertyValue('--site-line').trim(); g.lineWidth = 1;
  for (let x = 0; x <= 4; x++) { g.beginPath(); g.moveTo((x * graph.width) / 4, 0); g.lineTo((x * graph.width) / 4, graph.height); g.stroke(); }
  let max = 1;
  for (const bin of bins) for (const v of bin) if (v > max) max = v;
  g.globalCompositeOperation = 'screen';
  for (let c = 0; c < 3; c++) {
    g.beginPath(); g.moveTo(0, graph.height);
    for (let i = 0; i < 64; i++) g.lineTo((i / 63) * graph.width, graph.height - Math.sqrt(bins[c][i] / max) * (graph.height - 6));
    g.lineTo(graph.width, graph.height); g.closePath();
    g.fillStyle = ['#b15c6b80', '#6aa47f80', '#8279d980'][c]; g.fill();
    g.strokeStyle = ['#d48492', '#7fb79a', '#b2a6f1'][c]; g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
}

/* ---------- Store → preview ---------- */
useStore.subscribe((s, prev) => {
  const f = s.files.find((x) => x.id === s.activeId), p = prev.files.find((x) => x.id === prev.activeId);
  if (s.activeId !== prev.activeId || f?.settings !== p?.settings || f?.enabled !== p?.enabled || f?.lut !== p?.lut) lutDirty = true;
  if (f !== p || s.compare !== prev.compare || s.bypass !== prev.bypass || s.split !== prev.split || s.activeId !== prev.activeId || s.fullscreen !== prev.fullscreen) scheduleRender();
  if (f?.type === 'video' && f === p) return;
  if (f?.type === 'video' && (f.speed !== p?.speed || f.volume !== p?.volume || f.audio !== p?.audio)) syncAudio(f);
});

/* ---------- Media sources ---------- */
export async function loadSource(file: MediaFile): Promise<Runtime> {
  const existing = runtime.get(file.id);
  if (existing?.source) return existing;
  const source = file.type === 'video' ? document.createElement('video') : new Image();
  source.crossOrigin = 'anonymous';
  if (source instanceof HTMLVideoElement) { source.preload = 'auto'; source.playsInline = true; source.loop = false; }
  const rt: Runtime = { source, history: [], historyIndex: 0 };
  runtime.set(file.id, rt);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Le média ne répond pas. Réimportez-le ou convertissez-le en JPG / MP4 H.264.')), 30000);
    source.addEventListener(file.type === 'video' ? 'loadeddata' : 'load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    source.addEventListener('error', () => { clearTimeout(timeout); reject(Error(file.type === 'video' ? 'Cette vidéo ne peut pas être lue. Utilisez un MP4 H.264, un MOV compatible ou un WebM.' : 'Cette image ne peut pas être lue.')); }, { once: true });
    source.src = file.url;
  }).catch((error) => { runtime.delete(file.id); throw error; });
  const width = source instanceof HTMLVideoElement ? file.video?.width || source.videoWidth : source.naturalWidth;
  const height = source instanceof HTMLVideoElement ? file.video?.height || source.videoHeight : source.naturalHeight;
  if (!width || !height) throw Error('Dimensions du média invalides.');
  let patch: Partial<MediaFile> = { width, height };
  if (source instanceof HTMLVideoElement) {
    const duration = Number.isFinite(source.duration) && source.duration > 0 ? source.duration : file.video?.duration || 0;
    if (!duration) throw Error('Durée vidéo non prise en charge.');
    const end = Math.min(file.end || duration, duration), start = Math.min(file.start, Math.max(0, end - 0.01));
    patch = { ...patch, duration, end, start };
    source.currentTime = start;
    source.addEventListener('seeked', () => {
      if (getState().activeId !== file.id) return;
      setState({ time: source.currentTime });
      scheduleRender();
      if (rt.needsThumbnails) generateThumbnails().catch(() => {});
    });
    source.addEventListener('timeupdate', () => {
      if (getState().activeId !== file.id) return;
      const f = activeFile();
      setState({ time: source.currentTime });
      if (f && !source.paused && source.currentTime >= f.end) { source.pause(); source.currentTime = f.start; }
    });
    const playState = () => { if (getState().activeId === file.id) { setState({ playing: !source.paused }); if (!source.paused) videoLoop(); } };
    source.addEventListener('pause', playState); source.addEventListener('play', playState); source.addEventListener('ended', playState);
  }
  updateFile(file.id, patch);
  const updated = getState().files.find((f) => f.id === file.id)!;
  rt.history = [snapshot(updated)]; rt.historyIndex = 0;
  if (source instanceof HTMLVideoElement) syncAudio(updated);
  return rt;
}

export function releaseSource(id: string) {
  const rt = runtime.get(id);
  if (rt?.source instanceof HTMLVideoElement) { rt.source.pause(); rt.source.removeAttribute('src'); rt.source.load(); }
  runtime.delete(id);
}
export function releaseAll() { for (const id of [...runtime.keys()]) releaseSource(id); }
export const videoOf = (file: MediaFile | null) => (file?.type === 'video' ? (runtime.get(file.id)?.source as HTMLVideoElement | undefined) : undefined);

export function syncAudio(file: MediaFile) {
  const video = videoOf(file);
  if (!video) return;
  video.volume = Math.max(0, Math.min(1, file.volume / 100));
  video.muted = !file.audio;
  video.playbackRate = file.speed;
}

/* ---------- Playback ---------- */
function videoLoop() {
  const token = ++videoToken, f = activeFile(), v = videoOf(f);
  if (!v) return;
  const next = () => {
    if (token !== videoToken || v.paused || getState().exporting) return;
    renderPreview();
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(next); else requestAnimationFrame(next);
  };
  if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(next); else requestAnimationFrame(next);
}
export function stopPlayback() { videoToken++; const v = videoOf(activeFile()); v?.pause(); }
export async function playPause() {
  const f = activeFile(), v = videoOf(f);
  if (!f || !v) return;
  if (v.paused) { if (v.currentTime >= f.end || v.currentTime < f.start) v.currentTime = f.start; await v.play(); }
  else v.pause();
}
export function stepFrame(direction: number) {
  const f = activeFile(), v = videoOf(f);
  if (!f || !v) return;
  v.pause();
  const fps = Math.max(1, Number(f.video?.fps) || 30);
  v.currentTime = Math.max(0, Math.min(f.duration, v.currentTime + direction / fps));
}
export function seek(seconds: number) {
  const f = activeFile(), v = videoOf(f);
  if (!f || !v) return;
  v.pause();
  v.currentTime = Math.max(0, Math.min(f.duration, seconds));
  setState({ time: v.currentTime });
}

/* ---------- Thumbnails ---------- */
const THUMB_W = 320, THUMB_H = 210;
export async function generateThumbnails() {
  const f = activeFile(), rt = f && runtime.get(f.id);
  if (!f || !rt?.source || !thumbRenderer) return;
  const video = rt.source instanceof HTMLVideoElement ? rt.source : null;
  if (video && (video.seeking || video.readyState < 2)) { rt.needsThumbnails = true; return; }
  rt.needsThumbnails = false;
  const version = ++thumbnailVersion;
  const small = document.createElement('canvas');
  small.width = THUMB_W; small.height = THUMB_H;
  const ctx = small.getContext('2d')!, ratio = Math.max(THUMB_W / f.width, THUMB_H / f.height);
  ctx.drawImage(rt.source, (THUMB_W - f.width * ratio) / 2, (THUMB_H - f.height * ratio) / 2, f.width * ratio, f.height * ratio);
  let base: string;
  try { base = small.toDataURL('image/jpeg', 0.8); } catch { toast('Les vignettes de ce média ne peuvent pas être générées.', true); return; }
  setState((s) => ({ fileThumbs: { ...s.fileThumbs, [f.id]: base }, lookThumbs: {} }));
  let batch: Record<string, string> = {}, count = 0;
  const flush = () => { const b = batch; batch = {}; setState((s) => ({ lookThumbs: { ...s.lookThumbs, ...b } })); };
  for (const p of allPresets()) {
    if (version !== thumbnailVersion) return;
    thumbRenderer.update({ ...defaults, ...p.settings }, p.enabled, p.lut || null);
    thumbRenderer.render(small, THUMB_W, THUMB_H, { width: THUMB_W, height: THUMB_H });
    batch[p.id] = (thumbRenderer.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.84);
    if (++count % 6 === 0) { flush(); await new Promise((r) => setTimeout(r, 0)); }
  }
  if (version === thumbnailVersion) flush();
}

/** Thumbnail of one look for the active media (used after saving a custom look). */
export function renderLookThumbnail(preset: Preset) {
  const s = getState(), base = s.activeId && s.fileThumbs[s.activeId];
  if (!base || !thumbRenderer) return;
  const img = new Image();
  img.onload = () => {
    thumbRenderer!.update({ ...defaults, ...preset.settings }, preset.enabled, (preset.lut as Lut) || null);
    thumbRenderer!.render(img, THUMB_W, THUMB_H, { width: THUMB_W, height: THUMB_H });
    const url = (thumbRenderer!.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.84);
    setState((st) => ({ lookThumbs: { ...st.lookThumbs, [preset.id]: url } }));
  };
  img.src = base;
}

export async function createFilmstrip(file: MediaFile) {
  const rt = runtime.get(file.id);
  if (!rt || rt.filmstripPending || getState().filmstrips[file.id]) return;
  rt.filmstripPending = true;
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous'; video.muted = true; video.preload = 'auto';
  const wait = (event: string) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(Error('Chargement des vignettes interrompu.')); }, 12000);
    const ok = () => { cleanup(); resolve(); }, bad = () => { cleanup(); reject(Error('Vidéo illisible.')); };
    const cleanup = () => { clearTimeout(timeout); video.removeEventListener(event, ok); video.removeEventListener('error', bad); };
    video.addEventListener(event, ok, { once: true }); video.addEventListener('error', bad, { once: true });
  });
  try {
    const ready = wait('loadeddata'); video.src = file.url; await ready;
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d')!, frames: string[] = [];
    for (let i = 0; i < 10; i++) {
      // Always seek, even for the first frame: right after « loadeddata » some engines (WebKitGTK) still paint black.
      const time = Math.min(Math.max(0, file.duration - 0.05), Math.max(Math.min(0.04, file.duration / 20), (file.duration * i) / 9));
      const seeked = wait('seeked'); video.currentTime = time; await seeked;
      const scale = Math.max(160 / video.videoWidth, 90 / video.videoHeight);
      ctx.drawImage(video, (160 - video.videoWidth * scale) / 2, (90 - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale);
      frames.push(canvas.toDataURL('image/jpeg', 0.72));
    }
    setState((s) => ({ filmstrips: { ...s.filmstrips, [file.id]: frames } }));
  } catch { /* The filmstrip is decorative. */ } finally {
    video.removeAttribute('src'); video.load(); rt.filmstripPending = false;
  }
}

/* ---------- History ---------- */
export function snapshot(f: MediaFile): Snapshot {
  return { settings: f.settings, enabled: f.enabled, preset: f.preset, rotation: f.rotation, aspect: f.aspect, start: f.start, end: f.end, speed: f.speed, volume: f.volume, audio: f.audio, lut: f.lut, lutName: f.lutName };
}
function sameSnapshot(a: Snapshot, b: Snapshot) {
  const { lut: la, ...ra } = a, { lut: lb, ...rb } = b;
  return la === lb && JSON.stringify(ra) === JSON.stringify(rb);
}
export function refreshUndo() {
  const f = activeFile(), rt = f && runtime.get(f.id);
  setState({ undo: { canUndo: !!rt && rt.historyIndex > 0, canRedo: !!rt && rt.historyIndex < rt.history.length - 1 } });
}
export function commitHistory() {
  const f = activeFile(), rt = f && runtime.get(f.id);
  if (!f || !rt) return;
  const snap = snapshot(f);
  if (rt.history[rt.historyIndex] && sameSnapshot(rt.history[rt.historyIndex], snap)) return;
  rt.history.splice(rt.historyIndex + 1);
  rt.history.push(snap);
  if (rt.history.length > 80) rt.history.shift();
  rt.historyIndex = rt.history.length - 1;
  setState({ dirty: true });
  refreshUndo();
}
export function undoRedo(direction: number) {
  const f = activeFile(), rt = f && runtime.get(f.id);
  if (!f || !rt) return;
  const next = rt.historyIndex + direction;
  if (next < 0 || next >= rt.history.length) return;
  rt.historyIndex = next;
  updateFile(f.id, { ...rt.history[next] });
  setState({ dirty: true });
  refreshUndo();
  const v = videoOf(activeFile());
  if (v && (v.currentTime < rt.history[next].start || v.currentTime > rt.history[next].end)) v.currentTime = rt.history[next].start;
}
