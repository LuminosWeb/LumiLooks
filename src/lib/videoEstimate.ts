/* Bitrate recommendations and file-size estimates for the video export dialog. */
export type Quality = 'compact' | 'high' | 'maximum';
export type EncoderKind = 'cpu' | 'gpu';
export const qualityLabels: Record<Quality, string> = { compact: 'Fichier compact', high: 'Haute qualité', maximum: 'Qualité maximale' };
const bitsPerPixel: Record<Quality, number> = { compact: 0.06, high: 0.12, maximum: 0.24 };
export const MIN_KBPS = 500, MAX_KBPS = 200000;

/** Recommended H.264 video bitrate in kbit/s for a resolution, frame rate and quality preset. */
export function recommendedBitrate(width: number, height: number, fps: number, quality: Quality, format = 'mp4') {
  // VP9/AV1 reach the same quality with roughly 30 % less data than H.264; WMV2 needs much more.
  const efficiency = format === 'webm' ? 0.7 : format === 'wmv' ? 1.8 : 1;
  const kbps = (width * height * fps * bitsPerPixel[quality] * efficiency) / 1000;
  return clampBitrate(Math.round(kbps / 100) * 100);
}
export function clampBitrate(kbps: number) {
  return Math.max(MIN_KBPS, Math.min(MAX_KBPS, Math.round(Number(kbps) || MIN_KBPS)));
}
/** Estimated size in bytes: (video + audio bitrate) × duration, plus ~1.5 % container overhead. */
export function estimateBytes(videoKbps: number, audioKbps: number, seconds: number) {
  return Math.max(0, ((videoKbps + audioKbps) * 1000 * seconds) / 8) * 1.015;
}
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Ko';
  const units = ['octets', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0, v = bytes;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}
/** Rough per-pixel cost estimate for the image export (lossless PNG ≈ 3 bytes/px, JPEG/WebP ≈ 0.35). */
export function estimateImageBytes(width: number, height: number, format: string) {
  const px = width * height;
  if (format === 'png') return px * 2.2;
  if (format === 'pdf') return px * 2.0;
  return px * 0.35;
}
export function encoderNotes(kind: EncoderKind, format: string, gpuLabel?: string) {
  if (kind === 'gpu') return {
    title: `Carte graphique${gpuLabel ? ' · ' + gpuLabel : ''}`,
    lines: [
      'Encodage matériel : jusqu’à 5 à 10 × plus rapide, le processeur reste disponible.',
      'À débit égal, l’image est légèrement moins fine (environ 10 à 20 % de débit en plus pour la même qualité).',
      format === 'webm' ? 'WebM est encodé en AV1 par la carte graphique (lecture récente requise).' : 'Idéal pour la 4K, les longues vidéos et les débits élevés.',
    ],
  };
  return {
    title: format === 'webm' ? 'Processeur · VP9' : format === 'wmv' ? 'Processeur · WMV' : 'Processeur · x264',
    lines: [
      'Compression la plus efficace : la meilleure qualité possible à débit égal.',
      'Rendu plus lent et processeur fortement sollicité pendant l’export.',
      'Recommandé pour les débits faibles, l’archivage et une compatibilité maximale.',
    ],
  };
}
