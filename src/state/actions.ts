import { create } from 'zustand';
import { defaults, groups, normalizedEnabled, normalizedSettings, presets, allEnabled, type GroupKey, type Lut, type Preset } from '../lib/color';
import { loadBundledPresets } from '../lib/presets';
import { readGradeFile, serializeGradeCube, serializeGradeJson } from '../lib/gradeFile';
import * as platform from '../lib/platform';
import { activeFile, getState, newMediaFile, setState, toast, updateActive, updateFile, writeStored, type MediaFile, type Tab } from './store';
import * as engine from '../engine/engine';
import { adjustmentKeys } from '../components/panels/keys';
import { ensureFfmpeg, ffmpegReady } from '../components/FfmpegSetup';

/* ---------- Generic helpers ---------- */
export async function attempt<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
  try { return await fn(); } catch (error) { toast((error as Error)?.message || String(error) || 'Une erreur est survenue.', true); return undefined; }
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/* ---------- Name prompt ---------- */
interface PromptState { prompt: { title: string; value: string } | null }
export const usePrompt = create<PromptState>(() => ({ prompt: null }));
let promptResolve: ((value: string | null) => void) | null = null;
export function askName(title: string, value: string): Promise<string | null> {
  promptResolve?.(null);
  usePrompt.setState({ prompt: { title, value } });
  return new Promise((resolve) => { promptResolve = resolve; });
}
export function resolvePrompt(value: string | null) {
  usePrompt.setState({ prompt: null });
  const resolve = promptResolve; promptResolve = null;
  resolve?.(value && value.trim() ? value.trim().slice(0, 120) : null);
}

/* ---------- Startup ---------- */
export async function init() {
  applyTheme(getState().theme);
  if (platform.isTauri) platform.initMediaServer().catch((error) => toast(String(error), true));
  void ensureFfmpeg();
  try { setState({ bundled: await loadBundledPresets() }); } catch (error) { toast((error as Error).message, true); }
  setState({ ready: true });
}

/* ---------- Appearance & layout ---------- */
export function applyTheme(theme: 'dark' | 'light') {
  setState({ theme });
  document.documentElement.dataset.theme = theme;
  writeStored('lumilooks.theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--site-bg').trim();
  engine.scheduleRender();
}
export function setChainVisible(visible: boolean) { setState({ chainVisible: visible }); writeStored('lumilooks.chainVisible', visible); }
export function toggleLeft() { const v = !getState().leftCollapsed; setState({ leftCollapsed: v }); writeStored('lumilooks.leftCollapsed', v); }
export function toggleRight() { const v = !getState().rightCollapsed; setState({ rightCollapsed: v }); writeStored('lumilooks.rightCollapsed', v); }
export async function setFullscreen(on: boolean) {
  if (on && !activeFile()) return;
  setState({ fullscreen: on });
  await platform.setWindowFullscreen(on).catch(() => {});
  if (on) engine.zoomFit();
}
export function setWorkspace(workspace: 'grade' | 'edit') {
  const f = activeFile();
  if (workspace === 'edit' && f?.type !== 'video') { toast('Importez une vidéo pour la découper et ajuster sa vitesse.'); return; }
  setState({ workspace });
}
export function activateTab(tab: Tab) { setState({ tab }); }

/* ---------- Media ---------- */
let fileInput: HTMLInputElement | null = null;
function browserPick(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    fileInput?.remove();
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple; input.hidden = true; input.dataset.testid = 'file-input';
    input.onchange = () => { resolve([...(input.files || [])]); input.remove(); };
    document.body.append(input); fileInput = input; input.click();
  });
}
export function browserFiles(files: File[]): platform.ImportedMedia[] {
  return files.filter((file) => /^(image|video)\//.test(file.type)).map((file) => ({ id: crypto.randomUUID(), name: file.name, type: file.type.startsWith('video') ? 'video' : 'image', url: URL.createObjectURL(file), size: file.size }));
}
export async function importMedia() {
  if (platform.isTauri) {
    const paths = await platform.pickMediaPaths();
    if (paths.length) await importPaths(paths);
  } else {
    const files = await browserPick('image/*,video/*', true);
    await addImported(browserFiles(files));
  }
}
export async function importPaths(paths: string[]) {
  if (paths.some((path) => platform.videoExtensions.includes(path.split('.').pop()?.toLowerCase() || ''))) await ffmpegReady();
  const result = await platform.importPaths(paths);
  await addImported(result.files);
  if (result.errors.length) toast(result.errors.join(' · '), true);
}
export async function addImported(infos: platform.ImportedMedia[]) {
  if (!infos.length) return;
  const created = infos.map((info) => newMediaFile({ ...info, end: info.video?.duration || 0, duration: info.video?.duration || 0 }));
  setState((s) => ({ files: [...s.files, ...created], dirty: true }));
  await selectMedia(created[0].id);
  toast(`${infos.length} média${infos.length > 1 ? 's' : ''} importé${infos.length > 1 ? 's' : ''}`);
}
export async function selectMedia(id: string) {
  engine.stopPlayback();
  const file = getState().files.find((f) => f.id === id);
  if (!file) return;
  const previous = getState().activeId;
  setState({ activeId: id, bypass: false, playing: false, time: file.start || 0, workspace: file.type === 'video' && getState().workspace === 'edit' ? 'edit' : 'grade' });
  try {
    await engine.loadSource(file);
  } catch (error) {
    toast((error as Error).message, true);
    setState((s) => ({ files: s.files.filter((f) => f.id !== id), activeId: previous && previous !== id && s.files.some((f) => f.id === previous) ? previous : s.files.find((f) => f.id !== id)?.id ?? null }));
    return;
  }
  if (getState().activeId !== id) return;
  engine.refreshUndo();
  engine.scheduleRender();
  const f = activeFile()!;
  if (f.type === 'video') engine.createFilmstrip(f);
  await engine.generateThumbnails();
}
export function removeMedia(id: string) {
  const s = getState(), index = s.files.findIndex((f) => f.id === id);
  if (index < 0) return;
  const file = s.files[index];
  engine.releaseSource(id);
  if (file.url.startsWith('blob:')) URL.revokeObjectURL(file.url);
  const files = s.files.filter((f) => f.id !== id);
  const nextActive = s.activeId === id ? files[Math.min(index, files.length - 1)]?.id ?? null : s.activeId;
  setState({ files, dirty: true, activeId: nextActive, ...(files.length ? {} : { fullscreen: false, workspace: 'grade' as const, compare: false }) });
  if (!files.length) platform.setWindowFullscreen(false).catch(() => {});
  if (nextActive && nextActive !== s.activeId) selectMedia(nextActive);
}

/* ---------- Settings ---------- */
export function setSetting(key: string, value: number) {
  const group = (Object.keys(groups) as GroupKey[]).find((g) => groups[g].includes(key));
  updateActive((f) => ({ settings: { ...f.settings, [key]: value }, enabled: group ? { ...f.enabled, [group]: true } : f.enabled }));
}
export function setSettings(values: Record<string, number>) {
  updateActive((f) => {
    const enabled = { ...f.enabled };
    for (const key of Object.keys(values)) { const group = (Object.keys(groups) as GroupKey[]).find((g) => groups[g].includes(key)); if (group) enabled[group] = true; }
    return { settings: { ...f.settings, ...values }, enabled };
  });
}
export const commit = engine.commitHistory;
export function toggleGroup(key: GroupKey) { updateActive((f) => ({ enabled: { ...f.enabled, [key]: !f.enabled[key] } })); commit(); }
export function applyPreset(id: string) {
  const p = engine.allPresets().find((x) => x.id === id);
  if (!p || !activeFile()) return;
  updateActive((f) => ({ settings: normalizedSettings({ ...defaults, ...p.settings, flipHorizontal: f.settings.flipHorizontal, flipVertical: f.settings.flipVertical }), enabled: normalizedEnabled({ ...allEnabled(), ...p.enabled }), preset: id, lut: p.lut || null, lutName: p.lutName || null }));
  commit();
}
export function resetAll() {
  if (!activeFile()) return;
  updateActive({ settings: { ...defaults }, enabled: allEnabled(), preset: 'original', lut: null, lutName: null });
  commit(); toast('Réglages réinitialisés.');
}
export function resetPanel(tab: Tab) {
  updateActive((f) => {
    const settings = { ...f.settings };
    for (const key of adjustmentKeys(tab)) settings[key] = defaults[key];
    return { settings, ...(tab === 'crop' ? { rotation: 0, aspect: 'original' as const } : {}), ...(tab === 'film' ? { lut: null, lutName: null } : {}) };
  });
  commit();
}
export function rotate(direction: number) { updateActive((f) => ({ rotation: (f.rotation + direction + 4) % 4 })); commit(); }
export function setIntensity(value: number) { updateActive((f) => ({ settings: { ...f.settings, intensity: value } })); }

export function autoAdjust(mode: 'exposure' | 'balance') {
  const f = activeFile(), rt = f && engine.runtime.get(f.id);
  if (!f || !rt?.source) return;
  try {
    const sample = document.createElement('canvas'); sample.width = 160; sample.height = 100;
    const ctx = sample.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(rt.source, 0, 0, 160, 100);
    const data = ctx.getImageData(0, 0, 160, 100).data, sum = [0, 0, 0];
    let count = 0, log = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) {
      const rgb = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      for (let c = 0; c < 3; c++) sum[c] += rgb[c];
      log += Math.log(Math.max(0.01, rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722)); count++;
    }
    if (!count) return;
    const means = sum.map((v) => v / count);
    if (mode === 'exposure') setSetting('exposure', Number(Math.max(-4, Math.min(4, Math.log2(0.4 / Math.exp(log / count)))).toFixed(2)));
    else setSettings({ temperature: Math.max(-100, Math.min(100, Math.round(175 * (means[2] - means[0])))), tint: Math.max(-100, Math.min(100, Math.round((400 * (means[1] - (means[0] + means[2]) / 2)) / 1.2))) });
    commit();
    toast(mode === 'exposure' ? 'Exposition ajustée.' : 'Balance des blancs ajustée.');
  } catch { toast('Cet aperçu ne permet pas un ajustement automatique.', true); }
}

/* ---------- Video edit ---------- */
export function trim(key: 'start' | 'end', value: number, record = true) {
  const f = activeFile();
  if (f?.type !== 'video' || !Number.isFinite(value)) return;
  const next = key === 'start' ? Math.max(0, Math.min(f.end - 0.01, value)) : Math.min(f.duration, Math.max(f.start + 0.01, value));
  updateFile(f.id, { [key]: next });
  if (record) commit();
  const v = engine.videoOf(f);
  if (!v) return;
  const g = activeFile()!;
  if (v.paused) v.currentTime = key === 'start' ? g.start : Math.max(g.start, g.end - 1 / 30);
  else if (v.currentTime < g.start || v.currentTime > g.end) v.currentTime = g.start;
}

/* ---------- Looks ---------- */
export async function saveLook() {
  const f = activeFile();
  if (!f) return;
  const name = await askName('Enregistrer votre look', 'Mon look Luminos');
  if (!name) return;
  const p: Preset = { id: 'custom-' + crypto.randomUUID(), name, description: 'Votre look personnalisé.', category: 'Mes looks', color: '#a569f1', custom: true, settings: clone(f.settings), enabled: clone(f.enabled), lut: f.lut ? { ...f.lut, data: Array.from(f.lut.data) } : null, lutName: f.lutName };
  const customLooks = [...getState().customLooks, p];
  if (!writeStored('lumilooks.looks', customLooks)) { toast('Votre espace de stockage des looks est plein.', true); return; }
  setState({ customLooks });
  updateActive({ preset: p.id });
  commit();
  engine.renderLookThumbnail(p);
  toast('Look enregistré dans votre collection.');
}
export function removeLook(id: string) {
  const customLooks = getState().customLooks.filter((p) => p.id !== id);
  setState({ customLooks }); writeStored('lumilooks.looks', customLooks);
}
export function toggleFavorite(id: string) {
  const set = new Set(getState().favorites);
  if (set.has(id)) set.delete(id); else set.add(id);
  const favorites = [...set];
  setState({ favorites }); writeStored('lumilooks.favorites', favorites);
}

/* ---------- Color corrections (.cube / .lumilook) ---------- */
export async function importCorrection() {
  if (!activeFile()) return;
  let name: string, text: string;
  if (platform.isTauri) {
    const path = await platform.pickOpenPath('Importer une correction colorimétrique', [{ name: 'Corrections LumiLooks et LUT 3D', extensions: ['cube', 'lumilook'] }, { name: 'LUT 3D Cube', extensions: ['cube'] }, { name: 'Correction LumiLooks', extensions: ['lumilook'] }]);
    if (!path) return;
    name = platform.baseName(path); text = await platform.readText(path);
  } else {
    const [file] = await browserPick('.cube,.lumilook', false);
    if (!file) return;
    name = file.name; text = await file.text();
  }
  await applyCorrectionText(name, text);
}
export async function applyCorrectionText(name: string, text: string) {
  const grade = await readGradeFile(name, text, engine.allPresets());
  if (grade.restored) {
    updateActive((f) => ({ settings: { ...grade.settings, flipHorizontal: f.settings.flipHorizontal, flipVertical: f.settings.flipVertical }, enabled: grade.enabled, preset: grade.preset, lut: grade.lut, lutName: grade.lutName }));
    commit();
    toast(`Correction importée : tous les réglages de « ${name} » ont été restaurés.`);
  } else {
    updateActive((f) => ({ lut: grade.lut, lutName: name, enabled: { ...f.enabled, lut: true } }));
    commit();
    toast('LUT importée : ' + name);
  }
}
export async function exportCorrection(kind: 'cube' | 'lumilook') {
  const f = activeFile();
  if (!f) return;
  const source = { settings: f.settings, enabled: f.enabled, preset: f.preset, lut: f.lut, lutName: f.lutName };
  const text = kind === 'cube' ? await serializeGradeCube(source, engine.allPresets(), platform.APP_VERSION) : await serializeGradeJson(source, engine.allPresets(), platform.APP_VERSION);
  const preset = engine.allPresets().find((p) => p.id === f.preset);
  const fileName = `${(preset && preset.id !== 'original' ? preset.name : 'Luminos-look').replace(/[<>:"/\\|?*]+/g, '-')}.${kind}`;
  if (platform.isTauri) {
    const path = await platform.pickSavePath(kind === 'cube' ? 'Exporter la correction en LUT .cube' : 'Exporter la correction LumiLooks', fileName, [kind === 'cube' ? { name: 'LUT 3D Cube (réglages LumiLooks inclus)', extensions: ['cube'] } : { name: 'Correction LumiLooks', extensions: ['lumilook'] }]);
    if (!path) return;
    await platform.writeText(path, text);
  } else platform.downloadBlob(new Blob([text], { type: 'text/plain' }), fileName);
  toast(kind === 'cube' ? 'Correction exportée en .cube : réimportez-la dans LumiLooks pour retrouver tous les réglages.' : 'Correction LumiLooks exportée.');
}
export function removeLut() { updateActive({ lut: null, lutName: null }); commit(); }

/* ---------- Projects ---------- */
const projectFields = (f: MediaFile) => ({ id: f.id, name: f.name, type: f.type, settings: f.settings, enabled: f.enabled, preset: f.preset, rotation: f.rotation, aspect: f.aspect, start: f.start, end: f.end, speed: f.speed, volume: f.volume, audio: f.audio, lut: f.lut ? { ...f.lut, data: Array.from(f.lut.data) } : null, lutName: f.lutName });
export async function saveProject() {
  const s = getState();
  if (!platform.isTauri) { toast('L’enregistrement des projets est disponible dans l’application de bureau.'); return; }
  if (!s.files.length) { toast('Importez vos médias avant d’enregistrer un projet.'); return; }
  const path = await platform.pickSavePath('Enregistrer le projet', `${s.projectName.replace(/[<>:"/\\|?*]+/g, '-')}.lumilooks`, [{ name: 'Projet LumiLooks', extensions: ['lumilooks'] }]);
  if (!path) return;
  await platform.saveProject(path, { format: 'LumiLooks', version: 2, name: s.projectName, active: Math.max(0, s.files.findIndex((f) => f.id === s.activeId)), files: s.files.map(projectFields) });
  setState({ dirty: false });
  toast('Projet enregistré.');
}
export async function openProject() {
  if (!platform.isTauri) { toast('Ouvrez vos projets depuis l’application de bureau.'); return; }
  if (getState().dirty && getState().files.length && !(await platform.askConfirm('Les modifications du projet actuel seront perdues.', 'Ouvrir un projet', 'Ouvrir', 'Annuler'))) return;
  const path = await platform.pickOpenPath('Ouvrir un projet', [{ name: 'Projet LumiLooks', extensions: ['lumilooks'] }]);
  if (!path) return;
  const project = await platform.openProject(path);
  if (!project.files.length) { toast('Les médias de ce projet sont introuvables. Replacez-les à leur emplacement d’origine.', true); return; }
  engine.releaseAll();
  const files = project.files.map((item) => newMediaFile({ ...(item as unknown as Partial<MediaFile>), id: item.id, name: item.name, type: item.type, url: platform.mediaUrl(item.id), path: item.path, video: item.video, lut: (item.lut as Lut | null) || null }));
  setState({ files, projectName: project.name, dirty: false, activeId: null, lookThumbs: {}, fileThumbs: {}, filmstrips: {} });
  await selectMedia(files[Math.min(project.active || 0, files.length - 1)].id);
  setState({ dirty: false });
  toast(project.errors.length ? project.errors.join(' · ') : 'Projet ouvert.', project.errors.length > 0);
}
export async function renameProject() {
  const name = await askName('Nom du projet', getState().projectName);
  if (name) setState({ projectName: name, dirty: true });
}

export const presetList = () => [...presets, ...getState().bundled, ...getState().customLooks];
