import entries from '../generated/bundled-presets.json';
import { unpackLUT } from './lutPacking';
import type { Preset } from './color';

interface Entry { id: string; name: string; category: string; description: string; pack?: string; settings: Record<string, number>; lutName?: string; lutPath: string; lutPackedSha256: string }

async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('');
}
export async function loadBundledPresets(): Promise<Preset[]> {
  return Promise.all((entries as Entry[]).map(async (entry) => {
    const response = await fetch(entry.lutPath);
    if (!response.ok) throw Error(`Le preset ${entry.name} est introuvable. Réinstallez LumiLooks.`);
    const bytes = await response.arrayBuffer();
    if ((await sha256(bytes)) !== entry.lutPackedSha256) throw Error(`Le pack ${entry.name} est endommagé. Réinstallez LumiLooks.`);
    const lut = await unpackLUT(bytes);
    return { ...entry, lut: { ...lut, data: Array.from(lut.data) } } as Preset;
  }));
}
