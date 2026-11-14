export type Aspect = 'original' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
export const aspects: Aspect[] = ['original', '16:9', '9:16', '1:1', '4:5', '4:3'];

export function cropGeometry(width: number, height: number, rotation = 0, aspect: Aspect = 'original') {
  if (rotation % 2) [width, height] = [height, width];
  const ratio = aspect === 'original' ? width / height : aspect.split(':').map(Number).reduce((a, b) => a / b);
  const sourceRatio = width / height, crop: [number, number] = sourceRatio > ratio ? [ratio / sourceRatio, 1] : [1, sourceRatio / ratio];
  return { width: Math.max(2, Math.floor(width * crop[0])), height: Math.max(2, Math.floor(height * crop[1])), crop };
}

/** Output size after crop and rotation, scaled so the longest edge is at most `max`. */
export function geometry(width: number, height: number, rotation = 0, aspect: Aspect = 'original', max = Infinity) {
  const { crop, width: baseWidth, height: baseHeight } = cropGeometry(width, height, rotation, aspect);
  const scale = Math.min(1, max / Math.max(baseWidth, baseHeight));
  return { width: Math.max(2, Math.floor(baseWidth * scale)), height: Math.max(2, Math.floor(baseHeight * scale)), crop };
}

export type VideoResolution = 'original' | '720' | '1080' | '2160';

export function exportGeometry(width: number, height: number, rotation = 0, aspect: Aspect = 'original', resolution: VideoResolution | string = '1080') {
  const g = cropGeometry(width, height, rotation, aspect);
  if (resolution === 'original') return { ...g, width: Math.max(2, Math.floor(g.width / 2) * 2), height: Math.max(2, Math.floor(g.height / 2) * 2) };
  const p = Number(resolution);
  if (![720, 1080, 2160].includes(p)) throw Error('Choisissez une résolution 720p, 1080p ou 4K.');
  // A resolution names the short edge, also for non-16:9 footage.
  const scale = p / Math.min(g.width, g.height);
  return { ...g, width: Math.max(2, Math.round((g.width * scale) / 2) * 2), height: Math.max(2, Math.round((g.height * scale) / 2) * 2) };
}

export function defaultVideoResolution(width: number, height: number): VideoResolution {
  const equivalent = Math.max(Math.min(width, height), (Math.max(width, height) * 9) / 16);
  return String([720, 1080, 2160].reduce((best, p) => (Math.abs(p - equivalent) < Math.abs(best - equivalent) ? p : best))) as VideoResolution;
}

/** Keeps the width/height pair linked to the cropped source ratio when `locked`. */
export function linkedSize(changed: 'width' | 'height', value: number, ratio: number, max = 16384) {
  const v = Math.max(1, Math.min(max, Math.round(value)));
  if (changed === 'width') return { width: v, height: Math.max(1, Math.min(max, Math.round(v / ratio))) };
  return { height: v, width: Math.max(1, Math.min(max, Math.round(v * ratio))) };
}
