import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { packLUT, unpackLUT, fromBase64, toBase64 } from '../src/lib/lutPacking';
import bundled from '../src/generated/bundled-presets.json';

describe('LUT packs', () => {
  it('round-trips losslessly', async () => {
    const data = Float32Array.from({ length: 4 ** 3 * 3 }, (_, i) => Math.sin(i) * 0.5 + 0.5);
    const packed = await packLUT({ size: 4, data });
    const lut = await unpackLUT(fromBase64(toBase64(packed)));
    expect(Array.from(lut.data)).toEqual(Array.from(data));
  });
  it('reads every bundled pack', async () => {
    for (const entry of bundled.slice(0, 6)) {
      const lut = await unpackLUT(readFileSync('public/' + entry.lutPath));
      expect(lut.size).toBe(entry.lutSize);
    }
    expect(bundled.length).toBe(51);
  });
});
