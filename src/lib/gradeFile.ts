/*
 * Color-correction files.
 * - `.cube`: a standard 3D LUT readable by any software. LumiLooks also embeds every setting in
 *   comment lines (ignored by other software) so that re-importing the .cube restores all parameters,
 *   including grain, optics and effects that a LUT cannot contain.
 * - `.lumilook`: the same settings as plain JSON, without the LUT table.
 */
import { buildLUT, normalizedEnabled, normalizedSettings, parseCube, serializeCube, type Enabled, type Lut, type Preset, type Settings } from './color';
import { fromBase64, gunzip, gzip, packLUT, toBase64, unpackLUT } from './lutPacking';

export interface GradeData {
  format: 'LumiLooksGrade';
  version: 1;
  app: string;
  createdAt: string;
  preset: string;
  presetName?: string;
  settings: Settings;
  enabled: Enabled;
  lutName: string | null;
  /** Id of a bundled look whose LUT is reused on import. */
  lutRef?: string;
  /** Imported LUT that is not part of LumiLooks, packed (.llut) and base64-encoded. */
  lutPack?: string;
}
export interface GradeSource { settings: Settings; enabled: Enabled; preset: string; lut: Lut | null; lutName: string | null }
export interface ImportedGrade { settings: Settings; enabled: Enabled; preset: string; lut: Lut | null; lutName: string | null; restored: boolean; name: string }

const BEGIN = 'LUMILOOKS-GRADE-BEGIN v1', END = 'LUMILOOKS-GRADE-END', CHUNK = 96;

export async function gradeData(source: GradeSource, presetList: Preset[], appVersion: string): Promise<GradeData> {
  const preset = presetList.find((p) => p.id === source.preset);
  const data: GradeData = {
    format: 'LumiLooksGrade', version: 1, app: 'LumiLooks ' + appVersion, createdAt: new Date().toISOString(),
    preset: source.preset, presetName: preset?.name, settings: normalizedSettings(source.settings), enabled: normalizedEnabled(source.enabled), lutName: source.lutName,
  };
  if (source.lut) {
    const bundled = presetList.find((p) => p.lut && !p.custom && p.lut.data === source.lut!.data);
    if (bundled) data.lutRef = bundled.id;
    else data.lutPack = toBase64(await packLUT(source.lut));
  }
  return data;
}

export async function serializeGradeCube(source: GradeSource, presetList: Preset[], appVersion: string, size = 33) {
  const data = await gradeData(source, presetList, appVersion);
  const encoded = toBase64(await gzip(new TextEncoder().encode(JSON.stringify(data))));
  const header = ['LumiLooks · correction colorimétrique', 'Importez ce fichier dans LumiLooks pour retrouver tous les réglages.', BEGIN];
  for (let i = 0; i < encoded.length; i += CHUNK) header.push(encoded.slice(i, i + CHUNK));
  header.push(END);
  return serializeCube(buildLUT(source.settings, source.enabled, source.lut, size), header);
}

export async function serializeGradeJson(source: GradeSource, presetList: Preset[], appVersion: string) {
  return JSON.stringify(await gradeData(source, presetList, appVersion), null, 2) + '\n';
}

/** Extracts the embedded LumiLooks settings from a .cube, or null for a plain LUT. */
export async function embeddedGrade(text: string): Promise<GradeData | null> {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.replace(/^#\s*/, '').trim() === BEGIN);
  if (start < 0) return null;
  const chunks: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].replace(/^#\s?/, '').trim();
    if (line === END) {
      const json = new TextDecoder().decode(await gunzip(fromBase64(chunks.join(''))));
      return validateGrade(JSON.parse(json));
    }
    if (!lines[i].startsWith('#')) break;
    chunks.push(line);
  }
  throw Error('Les réglages LumiLooks de ce fichier .cube sont incomplets.');
}

export function validateGrade(value: unknown): GradeData {
  const data = value as GradeData;
  if (!data || data.format !== 'LumiLooksGrade' || data.version !== 1 || typeof data.settings !== 'object') throw Error('Ce fichier de correction LumiLooks est invalide.');
  return data;
}

export async function readGradeFile(name: string, text: string, presetList: Preset[]): Promise<ImportedGrade> {
  const lower = name.toLowerCase();
  let data: GradeData | null = null, plainLut: Lut | null = null;
  if (lower.endsWith('.lumilook') || lower.endsWith('.json')) data = validateGrade(JSON.parse(text));
  else {
    data = await embeddedGrade(text);
    if (!data) { const lut = parseCube(text); plainLut = { ...lut, data: Array.from(lut.data) }; }
  }
  if (!data) return { settings: normalizedSettings({}), enabled: normalizedEnabled({}), preset: 'original', lut: plainLut, lutName: name, restored: false, name };
  let lut: Lut | null = null;
  if (data.lutPack) { const unpacked = await unpackLUT(fromBase64(data.lutPack)); lut = { ...unpacked, data: Array.from(unpacked.data) }; }
  else if (data.lutRef) {
    const bundled = presetList.find((p) => p.id === data!.lutRef);
    if (!bundled?.lut) throw Error('Cette correction utilise un look LumiLooks introuvable. Mettez à jour LumiLooks.');
    lut = bundled.lut;
  }
  const preset = presetList.some((p) => p.id === data.preset) ? data.preset : 'original';
  return { settings: normalizedSettings(data.settings), enabled: normalizedEnabled(data.enabled), preset, lut, lutName: lut ? data.lutName : null, restored: true, name };
}
