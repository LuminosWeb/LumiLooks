/* Shared, deterministic color pipeline. Used by the preview, thumbnails, LUT export and video export. */

export type Settings = Record<string, number>;
export type GroupKey = 'color' | 'wheels' | 'lens' | 'optics' | 'film' | 'lut' | 'crop';
export type Enabled = Record<GroupKey, boolean>;
export interface Lut {
  size: number;
  data: Float32Array | number[];
  domainMin?: number[];
  domainMax?: number[];
}
export interface Preset {
  id: string;
  name: string;
  category: string;
  description: string;
  color?: string;
  settings: Partial<Settings>;
  enabled?: Partial<Enabled>;
  lut?: Lut | null;
  lutName?: string | null;
  pack?: string;
  custom?: boolean;
  lutPath?: string;
  lutPackedSha256?: string;
}

export const defaults: Settings = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, temperature: 0,
  tint: 0, fade: 0, gamma: 0, shadowHue: 220, shadowAmount: 0, midHue: 285,
  midAmount: 0, highHue: 40, highAmount: 0, grain: 0, vignette: 0, glow: 0,
  sharpness: 0, intensity: 100,
};

export const hslBands = [
  { id: 'Red', name: 'Rouges', hue: 0, radius: 40, color: '#df6b76' },
  { id: 'Orange', name: 'Oranges', hue: 30, radius: 30, color: '#d6a16c' },
  { id: 'Yellow', name: 'Jaunes', hue: 60, radius: 40, color: '#c4b96e' },
  { id: 'Green', name: 'Verts', hue: 120, radius: 60, color: '#76b68c' },
  { id: 'Aqua', name: 'Turquoises', hue: 180, radius: 60, color: '#6bb9b7' },
  { id: 'Blue', name: 'Bleus', hue: 240, radius: 40, color: '#729bd7' },
  { id: 'Purple', name: 'Violets', hue: 270, radius: 30, color: '#a986cf' },
  { id: 'Magenta', name: 'Magentas', hue: 300, radius: 40, color: '#cf83b5' },
] as const;

export const curveChannels = ['Master', 'Red', 'Green', 'Blue'] as const;

Object.assign(defaults, {
  brightness: 0, whites: 0, blacks: 0, vibrance: 0, hueShift: 0, dehaze: 0, redGain: 0, greenGain: 0, blueGain: 0,
  clarity: 0, texture: 0, denoise: 0, vignetteMidpoint: 50, vignetteSoftness: 50, vignetteRoundness: 50,
  glowRadius: 50, grainSize: 50, grainColor: 0, flipHorizontal: 0, flipVertical: 0,
});

/** Optical effects inspired by Magic Bullet Looks: haze/flare, anamorphic flare, chromatic aberration, lens distortion, optical diffusion. */
export const opticsDefaults: Settings = {
  hazeAmount: 0, hazeSize: 50, hazeX: 78, hazeY: 18, hazeHue: 35,
  flareAmount: 0, flareThreshold: 70, flareLength: 60, flareHue: 210,
  aberration: 0,
  distortion: 0,
  diffusionAmount: 0, diffusionSize: 50, diffusionThreshold: 55,
};
Object.assign(defaults, opticsDefaults);

for (const band of hslBands) for (const suffix of ['H', 'S', 'L']) defaults['hsl' + band.id + suffix] = 0;
for (const channel of curveChannels) for (const point of ['Low', 'Mid', 'High']) defaults['curve' + channel + point] = 0;

const advancedColorKeys = [
  'brightness', 'whites', 'blacks', 'vibrance', 'hueShift', 'dehaze', 'redGain', 'greenGain', 'blueGain',
  ...Object.keys(defaults).filter((k) => k.startsWith('hsl') || k.startsWith('curve')),
];

export const groups: Record<GroupKey, string[]> = {
  color: ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'temperature', 'tint', 'fade', 'gamma', ...advancedColorKeys],
  wheels: ['shadowHue', 'shadowAmount', 'midHue', 'midAmount', 'highHue', 'highAmount'],
  lens: ['glow', 'vignette', 'sharpness', 'clarity', 'texture', 'denoise', 'vignetteMidpoint', 'vignetteSoftness', 'vignetteRoundness', 'glowRadius'],
  optics: Object.keys(opticsDefaults),
  film: ['grain', 'grainSize', 'grainColor'],
  lut: [],
  crop: ['flipHorizontal', 'flipVertical'],
};

export const allEnabled = (): Enabled => ({ color: true, wheels: true, lens: true, optics: true, film: true, lut: true, crop: true });

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export function settingRange(key: string): [number, number] {
  if (key === 'exposure') return [-4, 4];
  if (key === 'hueShift') return [-180, 180];
  if (/^hsl.*H$/.test(key)) return [-45, 45];
  if (['shadowHue', 'midHue', 'highHue', 'hazeHue', 'flareHue'].includes(key)) return [0, 360];
  if (key.startsWith('flip')) return [0, 1];
  if (['aberration', 'distortion'].includes(key)) return [-100, 100];
  if ([
    'intensity', 'grain', 'vignette', 'glow', 'sharpness', 'denoise', 'vignetteMidpoint', 'vignetteSoftness', 'vignetteRoundness',
    'glowRadius', 'grainSize', 'grainColor', 'shadowAmount', 'midAmount', 'highAmount',
    'hazeAmount', 'hazeSize', 'hazeX', 'hazeY', 'flareAmount', 'flareThreshold', 'flareLength',
    'diffusionAmount', 'diffusionSize', 'diffusionThreshold',
  ].includes(key)) return [0, 100];
  return [-100, 100];
}

export function normalizedSettings(input: Partial<Settings> = {}): Settings {
  const out: Settings = { ...defaults };
  for (const k of Object.keys(out)) {
    const value = input[k];
    if (typeof value === 'number' && Number.isFinite(value)) out[k] = clamp(value, ...settingRange(k));
  }
  out.intensity = clamp(out.intensity, 0, 100);
  return out;
}

export function normalizedEnabled(input: Partial<Enabled> = {}): Enabled {
  const out = allEnabled();
  for (const key of Object.keys(out) as GroupKey[]) if (typeof input[key] === 'boolean') out[key] = input[key] as boolean;
  return out;
}

export function effectiveSettings(s: Partial<Settings>, enabled: Partial<Enabled> = {}): Settings {
  const out = normalizedSettings(s);
  for (const [group, keys] of Object.entries(groups)) if (enabled[group as GroupKey] === false) for (const k of keys) out[k] = defaults[k];
  return out;
}

export function hueRGB(hue: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60, x = 1 - Math.abs((h % 2) - 1);
  return h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r = clamp(r); g = clamp(g); b = clamp(b);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo, l = (hi + lo) / 2;
  if (d < 1e-9) return [0, 0, l];
  const h = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const a = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [a[0] + m, a[1] + m, a[2] + m];
}

function adjustHsl(r: number, g: number, b: number, s: Settings): [number, number, number] {
  const [h, sat, l] = rgbToHsl(r, g, b);
  let dh = 0, ds = 0, dl = 0, total = 0;
  for (const band of hslBands) {
    let w = clamp(1 - Math.abs(((h - band.hue + 540) % 360) - 180) / band.radius);
    w = w * w * (3 - 2 * w);
    total += w; dh += w * s['hsl' + band.id + 'H']; ds += w * s['hsl' + band.id + 'S']; dl += w * s['hsl' + band.id + 'L'];
  }
  const weight = Math.max(total, 0.00001);
  return hslToRgb(h + s.hueShift + dh / weight, clamp(sat * (1 + ds / weight / 100)), clamp(l + (dl / weight) * 0.003));
}

export function curveSample(x: number, points: number[]): number {
  const p = [0, clamp(0.25 + points[0] / 400), clamp(0.5 + points[1] / 400), clamp(0.75 + points[2] / 400), 1];
  const t = clamp(x) * 4, i = Math.min(3, Math.floor(t));
  return p[i] + (p[i + 1] - p[i]) * (t - i);
}

export function makeTransform(settings: Partial<Settings>, enabled: Partial<Enabled> = {}, imported: Lut | null = null) {
  const s = effectiveSettings(settings, enabled), exp = 2 ** s.exposure, con = 1 + s.contrast / 100, sat = 1 + s.saturation / 100, gam = 2 ** (-s.gamma / 100);
  const t = s.temperature / 350, tint = s.tint / 400, fade = s.fade / 500, amount = s.intensity / 100;
  const wheels = ([['shadow', s.shadowHue], ['mid', s.midHue], ['high', s.highHue]] as const).map(([name, h]) => hueRGB(h).map((v) => ((v - 0.5) * s[name + 'Amount']) / 220));
  const hslEnabled = s.hueShift !== 0 || Object.keys(s).some((k) => k.startsWith('hsl') && s[k] !== 0);
  const curves = curveChannels.map((channel) => ['Low', 'Mid', 'High'].map((point) => s['curve' + channel + point]));
  const curvesEnabled = curves.some((points) => points.some((v) => v !== 0));
  const gains = [s.redGain, s.greenGain, s.blueGain].map((v) => 2 ** (v / 100)), haze = s.dehaze * 0.0035;
  return (r: number, g: number, b: number): [number, number, number] => {
    const orig = [r, g, b];
    r *= exp; g *= exp; b *= exp;
    r += t + tint * 0.4; g -= tint; b -= t;
    r = ((r + s.brightness * 0.003) * gains[0] - 0.7 * haze) / (1 - haze);
    g = ((g + s.brightness * 0.003) * gains[1] - 0.7 * haze) / (1 - haze);
    b = ((b + s.brightness * 0.003) * gains[2] - 0.7 * haze) / (1 - haze);
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const low = (1 - clamp(y)) ** 2, high = clamp(y) ** 2;
    const lift = (s.shadows / 220) * low + (s.highlights / 220) * high + (s.blacks / 200) * low * low + (s.whites / 200) * high * high;
    r += lift; g += lift; b += lift;
    r = (r - 0.5) * con + 0.5; g = (g - 0.5) * con + 0.5; b = (b - 0.5) * con + 0.5;
    if (hslEnabled) [r, g, b] = adjustHsl(r, g, b, s);
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const saturation = sat * (1 + (s.vibrance / 100) * (1 - clamp(Math.max(r, g, b) - Math.min(r, g, b))) * 0.9);
    r = y + (r - y) * saturation; g = y + (g - y) * saturation; b = y + (b - y) * saturation;
    const weights = [(1 - clamp(y)) ** 2, 1 - Math.abs(clamp(y) * 2 - 1), clamp(y) ** 2];
    let result = [r, g, b].map((v, c) => {
      v = Math.pow(clamp(v), gam);
      for (let i = 0; i < 3; i++) v += wheels[i][c] * weights[i];
      return clamp(v * (1 - fade) + fade);
    }) as [number, number, number];
    if (curvesEnabled) result = result.map((v, c) => curveSample(curveSample(v, curves[0]), curves[c + 1])) as [number, number, number];
    if (imported && enabled.lut !== false) result = sampleLUT(imported, ...result);
    return result.map((v, i) => clamp(orig[i] + (v - orig[i]) * amount)) as [number, number, number];
  };
}

export function buildLUT(s: Partial<Settings>, enabled: Partial<Enabled>, imported: Lut | null = null, size = 33): { size: number; data: Float32Array } {
  const transform = makeTransform(s, enabled, imported), data = new Float32Array(size * size * size * 3);
  let n = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) for (const c of transform(r / (size - 1), g / (size - 1), b / (size - 1))) data[n++] = c;
  return { size, data };
}

export function sampleLUT(lut: Lut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size, max = n - 1, domainMin = lut.domainMin || [0, 0, 0], domainMax = lut.domainMax || [1, 1, 1];
  const p = [r, g, b].map((v, i) => clamp((v - domainMin[i]) / (domainMax[i] - domainMin[i])) * max), a = p.map(Math.floor), f = p.map((v, i) => v - a[i]);
  const out: [number, number, number] = [0, 0, 0];
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const index = ((Math.min(a[2] + dz, max) * n + Math.min(a[1] + dy, max)) * n + Math.min(a[0] + dx, max)) * 3;
    const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
    for (let c = 0; c < 3; c++) out[c] += (lut.data[index + c] as number) * w;
  }
  return out;
}

export function parseCube(text: string): { size: number; data: Float32Array; domainMin: number[]; domainMax: number[]; title?: string } {
  if (typeof text !== 'string' || text.length > 60e6) throw Error('Fichier LUT trop volumineux.');
  let size = 0, domainMin = [0, 0, 0], domainMax = [1, 1, 1], title: string | undefined;
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    if (line.startsWith('TITLE')) title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (line.startsWith('LUT_3D_SIZE')) size = Number(line.split(/\s+/)[1]);
    else if (line.startsWith('DOMAIN_MIN')) domainMin = line.split(/\s+/).slice(1).map(Number);
    else if (line.startsWith('DOMAIN_MAX')) domainMax = line.split(/\s+/).slice(1).map(Number);
    else if (/^[+\-.\d]/.test(line)) {
      const row = line.split(/\s+/).map(Number);
      if (row.length !== 3 || row.some((v) => !Number.isFinite(v))) throw Error('Valeurs LUT invalides.');
      values.push(...row);
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > 65 || values.length !== size ** 3 * 3) throw Error('Utilisez une LUT 3D .cube de 2 à 65 points.');
  if (domainMin.length !== 3 || domainMax.length !== 3 || domainMin.some((v, i) => !Number.isFinite(v) || !Number.isFinite(domainMax[i]) || domainMax[i] <= v)) throw Error('Domaine LUT invalide.');
  return { size, data: new Float32Array(values), domainMin, domainMax, title };
}

export function serializeCube(lut: { size: number; data: ArrayLike<number> }, header: string[] = []): string {
  const lines = ['TITLE "LumiLooks"', ...header.map((line) => '# ' + line), `LUT_3D_SIZE ${lut.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  const rows: string[] = [];
  for (let i = 0; i < lut.data.length; i += 3) rows.push(`${lut.data[i].toFixed(7)} ${lut.data[i + 1].toFixed(7)} ${lut.data[i + 2].toFixed(7)}`);
  return lines.join('\n') + '\n' + rows.join('\n') + '\n';
}

export const presets: Preset[] = [
  { id: 'original', name: 'Original', category: 'Essentiels', description: 'Votre image, sans correction.', color: '#c6c3cc', settings: {} },
  { id: 'luminos', name: 'Luminos signature', category: 'Signature', description: 'Des ombres violettes, une lumière douce.', color: '#a569f1', settings: { contrast: 15, temperature: 7, shadowHue: 272, shadowAmount: 17, highHue: 38, highAmount: 10, fade: 7, vignette: 16, glow: 14 } },
  { id: 'cinema', name: 'Teal & amber', category: 'Cinéma', description: 'Ombres cyan et hautes lumières ambrées.', color: '#5eb9b1', settings: { contrast: 22, saturation: -8, shadowHue: 186, shadowAmount: 28, highHue: 35, highAmount: 24, vignette: 20, grain: 10 } },
  { id: 'golden', name: 'Golden hour', category: 'Cinéma', description: 'La chaleur des dernières heures du jour.', color: '#e8b376', settings: { temperature: 30, contrast: 9, highlights: -16, shadows: 12, highHue: 35, highAmount: 16, glow: 22 } },
  { id: 'noir', name: 'Noir absolu', category: 'Argentique', description: 'Un noir et blanc dense et contrasté.', color: '#c0bbc8', settings: { saturation: -100, contrast: 32, shadows: -10, grain: 23, vignette: 25 } },
  { id: 'portra', name: 'Portrait doux', category: 'Argentique', description: 'Des tons chair délicats et des noirs relevés.', color: '#d6b5a5', settings: { temperature: 10, contrast: -9, saturation: -12, fade: 18, highlights: -18, grain: 15, glow: 10 } },
  { id: 'midnight', name: 'Midnight violet', category: 'Signature', description: 'Une nuit aux reflets de l’univers Luminos.', color: '#9b81de', settings: { exposure: -0.3, contrast: 18, temperature: -20, shadowHue: 262, shadowAmount: 30, midHue: 289, midAmount: 12, vignette: 28 } },
  { id: 'chrome', name: 'Chrome 200', category: 'Argentique', description: 'Des couleurs franches, un grain discret.', color: '#89bfc0', settings: { contrast: 20, saturation: 16, temperature: -7, highlights: -15, grain: 18, fade: 5 } },
  { id: 'desert', name: 'Dune', category: 'Cinéma', description: 'Une palette solaire, minérale et désaturée.', color: '#d4b78a', settings: { temperature: 23, saturation: -28, contrast: 19, fade: 10, shadowHue: 32, shadowAmount: 16, vignette: 13 } },
  { id: 'nordic', name: 'Nordic blue', category: 'Cinéma', description: 'Une lumière froide, calme et aérienne.', color: '#8cbbda', settings: { temperature: -25, contrast: -8, saturation: -15, shadows: 18, fade: 8, highHue: 207, highAmount: 10 } },
  { id: 'retro', name: 'Super 8', category: 'Argentique', description: 'Une pellicule chaude aux noirs délavés.', color: '#d2a67d', settings: { temperature: 18, contrast: 8, saturation: -15, fade: 32, grain: 40, vignette: 35, glow: 20 } },
  { id: 'clean', name: 'Clarté', category: 'Essentiels', description: 'Une image lumineuse et des détails précis.', color: '#d5e6dd', settings: { exposure: 0.16, contrast: 12, highlights: -15, shadows: 15, saturation: 8, sharpness: 30 } },
  { id: 'moody', name: 'Forest mood', category: 'Cinéma', description: 'Des verts profonds et une lumière feutrée.', color: '#7ca58f', settings: { exposure: -0.2, contrast: 25, saturation: -18, temperature: -8, shadowHue: 155, shadowAmount: 16, vignette: 30 } },
  { id: 'rose', name: 'Rose quartz', category: 'Signature', description: 'Une teinte rosée, tendre et lumineuse.', color: '#d99bc1', settings: { exposure: 0.1, tint: 18, contrast: -8, fade: 16, highHue: 326, highAmount: 15, glow: 20 } },
  { id: 'bleach', name: 'Silver bypass', category: 'Argentique', description: 'Des noirs denses et des couleurs retenues.', color: '#b1b7c4', settings: { saturation: -65, contrast: 38, temperature: -10, sharpness: 20, grain: 18 } },
  { id: 'vivid', name: 'Couleurs vives', category: 'Essentiels', description: 'Des couleurs riches pour vos images du quotidien.', color: '#a5c681', settings: { saturation: 28, contrast: 12, highlights: -12, shadows: 8 } },
  // Optical looks showcasing the lens effects.
  { id: 'anamorphic-night', name: 'Anamorphic night', category: 'Optique', description: 'Flares bleus horizontaux et diffusion douce, façon objectif anamorphique.', color: '#6f9ce8', settings: { contrast: 14, temperature: -12, shadowHue: 205, shadowAmount: 18, flareAmount: 55, flareThreshold: 62, flareLength: 70, flareHue: 212, diffusionAmount: 22, diffusionSize: 45, diffusionThreshold: 55, vignette: 18, aberration: 18 } },
  { id: 'dreamy-mist', name: 'Brume de rêve', category: 'Optique', description: 'Diffusion optique façon filtre Pro-Mist et halo chaud.', color: '#e8c9b0', settings: { contrast: -6, fade: 8, diffusionAmount: 55, diffusionSize: 65, diffusionThreshold: 40, hazeAmount: 28, hazeSize: 70, hazeHue: 32 } },
  { id: 'vintage-lens', name: 'Objectif vintage', category: 'Optique', description: 'Aberration chromatique, distorsion en barillet et voile solaire.', color: '#d7a46f', settings: { temperature: 12, saturation: -10, fade: 12, aberration: 45, distortion: 28, hazeAmount: 35, hazeHue: 28, vignette: 30, grain: 14 } },
];
