import { describe, expect, it } from 'vitest';
import { buildLUT, defaults, effectiveSettings, groups, makeTransform, normalizedSettings, parseCube, serializeCube, settingRange, allEnabled } from '../src/lib/color';

describe('color pipeline', () => {
  it('is the identity with default settings', () => {
    const t = makeTransform(defaults, allEnabled());
    for (const v of [0, 0.25, 0.5, 0.75, 1]) t(v, v, v).forEach((c) => expect(c).toBeCloseTo(v, 6));
  });
  it('declares every optical effect in the optics group with a range', () => {
    for (const key of ['hazeAmount', 'flareAmount', 'aberration', 'distortion', 'diffusionAmount']) {
      expect(groups.optics).toContain(key);
      expect(defaults[key]).toBe(0);
    }
    expect(settingRange('distortion')).toEqual([-100, 100]);
    expect(settingRange('hazeHue')).toEqual([0, 360]);
  });
  it('resets a disabled group to defaults', () => {
    const s = effectiveSettings({ flareAmount: 60, contrast: 20 }, { optics: false });
    expect(s.flareAmount).toBe(0);
    expect(s.contrast).toBe(20);
  });
  it('clamps settings to their ranges', () => {
    const s = normalizedSettings({ exposure: 12, distortion: -400, hazeX: 300, unknown: 4 } as never);
    expect(s.exposure).toBe(4); expect(s.distortion).toBe(-100); expect(s.hazeX).toBe(100); expect('unknown' in s).toBe(false);
  });
  it('round-trips a .cube', () => {
    const lut = buildLUT({ contrast: 30, saturation: -20 }, allEnabled(), null, 9);
    const parsed = parseCube(serializeCube(lut, ['commentaire']));
    expect(parsed.size).toBe(9);
    for (let i = 0; i < lut.data.length; i += 37) expect(parsed.data[i]).toBeCloseTo(lut.data[i], 6);
  });
});
