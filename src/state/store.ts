import { create } from 'zustand';
import { allEnabled, normalizedEnabled, normalizedSettings, type Enabled, type Lut, type Preset, type Settings } from '../lib/color';
import type { Aspect } from '../lib/geometry';
import { originalVolume } from '../lib/audio';
import type { VideoInfo } from '../lib/platform';

export type Tab = 'light' | 'color' | 'mixer' | 'curves' | 'wheels' | 'lens' | 'optics' | 'film' | 'crop';
export type Collection = 'Tous' | 'Packs' | 'Favoris' | 'Mes looks';
export type Workspace = 'grade' | 'edit';

export interface MediaFile {
  id: string;
  name: string;
  type: 'image' | 'video';
  url: string;
  path?: string;
  size?: number;
  video?: VideoInfo;
  width: number;
  height: number;
  duration: number;
  settings: Settings;
  enabled: Enabled;
  preset: string;
  rotation: number;
  aspect: Aspect;
  start: number;
  end: number;
  speed: number;
  volume: number;
  audio: boolean;
  lut: Lut | null;
  lutName: string | null;
}

export interface ToastState { id: number; message: string; error: boolean }

export interface AppState {
  files: MediaFile[];
  activeId: string | null;
  ready: boolean;
  tab: Tab;
  hslBand: string;
  curveChannel: string;
  collection: Collection;
  category: string;
  search: string;
  compare: boolean;
  bypass: boolean;
  split: number;
  projectName: string;
  dirty: boolean;
  exporting: boolean;
  chainVisible: boolean;
  theme: 'dark' | 'light';
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  workspace: Workspace;
  fullscreen: boolean;
  bundled: Preset[];
  customLooks: Preset[];
  favorites: string[];
  fileThumbs: Record<string, string>;
  lookThumbs: Record<string, string>;
  filmstrips: Record<string, string[]>;
  playing: boolean;
  time: number;
  zoom: { scale: number; fit: boolean; canZoomIn: boolean; canZoomOut: boolean };
  undo: { canUndo: boolean; canRedo: boolean };
  dragging: boolean;
  toast: ToastState | null;
  dialog: null | 'export' | 'help';
}

export const readStored = <T,>(key: string, fallback: T): T => {
  try { const value = localStorage.getItem(key); return value === null ? fallback : (JSON.parse(value) ?? fallback); } catch { return fallback; }
};
export const writeStored = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};

export const useStore = create<AppState>(() => ({
  files: [],
  activeId: null,
  ready: false,
  tab: 'light',
  hslBand: 'Red',
  curveChannel: 'Master',
  collection: 'Tous',
  category: 'Tous',
  search: '',
  compare: false,
  bypass: false,
  split: 0.5,
  projectName: 'Projet sans titre',
  dirty: false,
  exporting: false,
  chainVisible: readStored<boolean>('lumilooks.chainVisible', true) !== false,
  theme: readStored<string>('lumilooks.theme', 'dark') === 'light' ? 'light' : 'dark',
  leftCollapsed: readStored<boolean>('lumilooks.leftCollapsed', false) === true,
  rightCollapsed: readStored<boolean>('lumilooks.rightCollapsed', false) === true,
  workspace: 'grade',
  fullscreen: false,
  bundled: [],
  customLooks: readStored<Preset[]>('lumilooks.looks', []),
  favorites: readStored<string[]>('lumilooks.favorites', []),
  fileThumbs: {},
  lookThumbs: {},
  filmstrips: {},
  playing: false,
  time: 0,
  zoom: { scale: 1, fit: true, canZoomIn: true, canZoomOut: true },
  undo: { canUndo: false, canRedo: false },
  dragging: false,
  toast: null,
  dialog: null,
}));

export const getState = () => useStore.getState();
export const setState = useStore.setState;

export const useActive = () => useStore((s) => s.files.find((f) => f.id === s.activeId) ?? null);
export const activeFile = () => { const s = getState(); return s.files.find((f) => f.id === s.activeId) ?? null; };

export function newMediaFile(info: Partial<MediaFile> & { id: string; name: string; type: 'image' | 'video'; url: string }): MediaFile {
  return {
    path: undefined, size: undefined, video: undefined, width: 0, height: 0, duration: 0,
    ...info,
    settings: normalizedSettings(info.settings),
    enabled: normalizedEnabled(info.enabled),
    preset: info.preset || 'original',
    rotation: [0, 1, 2, 3].includes(info.rotation as number) ? (info.rotation as number) : 0,
    aspect: (info.aspect as Aspect) || 'original',
    start: Number(info.start) || 0,
    end: Number(info.end) || 0,
    speed: Number(info.speed) || 1,
    volume: originalVolume(info.volume ?? 100),
    audio: info.audio !== false,
    lut: info.lut || null,
    lutName: info.lutName || null,
  };
}

export function updateFile(id: string, patch: Partial<MediaFile> | ((file: MediaFile) => Partial<MediaFile>)) {
  setState((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...(typeof patch === 'function' ? patch(f) : patch) } : f)) }));
}
export function updateActive(patch: Partial<MediaFile> | ((file: MediaFile) => Partial<MediaFile>)) {
  const id = getState().activeId;
  if (id) updateFile(id, patch);
}

let toastSerial = 0, toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, error = false) {
  clearTimeout(toastTimer);
  setState({ toast: { id: ++toastSerial, message, error } });
  toastTimer = setTimeout(() => setState({ toast: null }), error ? 7500 : 3300);
}

export const resetEnabled = allEnabled;
