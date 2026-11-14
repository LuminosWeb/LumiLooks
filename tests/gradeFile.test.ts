import { describe, expect, it } from 'vitest';
import { allEnabled, normalizedSettings, parseCube, presets, type Preset } from '../src/lib/color';
import { embeddedGrade, readGradeFile, serializeGradeCube, serializeGradeJson } from '../src/lib/gradeFile';

const settings = normalizedSettings({ contrast: 25, temperature: -12, grain: 30, vignette: 18, flareAmount: 40, hazeAmount: 22, distortion: 15, aberration: -30, diffusionAmount: 50 });
const enabled = { ...allEnabled(), wheels: false };
const customLut = { size: 5, data: Array.from({ length: 125 * 3 }, (_, i) => ((i * 7) % 100) / 100), domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const bundled: Preset = { id: 'pack-look', name: 'Pack', category: 'DAEDAL Cinematic', description: '', settings: {}, lut: { size: 2, data: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1] }, pack: 'X' };
const list = [...presets, bundled];

describe('color-correction files', () => {
  it('restores every setting from a LumiLooks .cube, including effects a LUT cannot hold', async () => {
    const text = await serializeGradeCube({ settings, enabled, preset: 'cinema', lut: customLut, lutName: 'perso.cube' }, list, '2.0.0', 9);
    expect(parseCube(text).size).toBe(9); // still a valid LUT for other software
    const grade = await readGradeFile('look.cube', text, list);
    expect(grade.restored).toBe(true);
    expect(grade.settings).toEqual(settings);
    expect(grade.enabled.wheels).toBe(false);
    expect(grade.preset).toBe('cinema');
    expect(grade.lutName).toBe('perso.cube');
    expect(grade.lut?.size).toBe(5);
    Array.from(grade.lut!.data).forEach((v, i) => expect(v).toBeCloseTo(customLut.data[i], 6));
  });
  it('references bundled LUTs instead of embedding them', async () => {
    const text = await serializeGradeJson({ settings, enabled, preset: 'pack-look', lut: bundled.lut!, lutName: 'pack.cube' }, list, '2.0.0');
    const data = JSON.parse(text);
    expect(data.lutRef).toBe('pack-look');
    expect(data.lutPack).toBeUndefined();
    const grade = await readGradeFile('look.lumilook', text, list);
    expect(grade.lut).toBe(bundled.lut);
  });
  it('treats a foreign .cube as a plain LUT', async () => {
    const plain = 'LUT_3D_SIZE 2\n' + Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`).join('\n');
    expect(await embeddedGrade(plain)).toBeNull();
    const grade = await readGradeFile('other.cube', plain, list);
    expect(grade.restored).toBe(false);
    expect(grade.lut?.size).toBe(2);
  });
});
