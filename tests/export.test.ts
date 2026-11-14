import { describe, expect, it } from 'vitest';
import { estimateBytes, formatBytes, recommendedBitrate, clampBitrate } from '../src/lib/videoEstimate';
import { exportGeometry, geometry, linkedSize } from '../src/lib/geometry';

describe('export helpers', () => {
  it('recommends bitrates that scale with quality, size and codec', () => {
    const high = recommendedBitrate(1920, 1080, 30, 'high');
    expect(high).toBe(7500);
    expect(recommendedBitrate(1920, 1080, 30, 'maximum')).toBeGreaterThan(high);
    expect(recommendedBitrate(1920, 1080, 30, 'compact')).toBeLessThan(high);
    expect(recommendedBitrate(1920, 1080, 30, 'high', 'webm')).toBeLessThan(high);
    expect(clampBitrate(10)).toBe(500);
  });
  it('estimates the file size from the bitrates and the duration', () => {
    const bytes = estimateBytes(8000, 192, 60);
    expect(bytes / 1e6).toBeCloseTo(62.4, 0);
    expect(formatBytes(bytes)).toMatch(/^62(,\d)? Mo$/);
  });
  it('keeps the original ratio when width and height are linked', () => {
    expect(linkedSize('width', 1000, 1.5)).toEqual({ width: 1000, height: 667 });
    expect(linkedSize('height', 400, 16 / 9)).toEqual({ height: 400, width: 711 });
  });
  it('computes crop and export geometry', () => {
    expect(geometry(4000, 3000, 1, 'original')).toMatchObject({ width: 3000, height: 4000 });
    expect(exportGeometry(1920, 1080, 0, '9:16', '1080')).toMatchObject({ width: 1080, height: 1922 });
  });
});
