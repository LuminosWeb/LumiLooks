export interface VideoFormat { value: string; label: string; extension: string; audioKbps: number; gpu: boolean }
export const videoFormats: VideoFormat[] = [
  { value: 'mp4', label: 'MP4 · H.264', extension: 'mp4', audioKbps: 192, gpu: true },
  { value: 'webm', label: 'WebM · VP9 / AV1', extension: 'webm', audioKbps: 160, gpu: true },
  { value: 'mov', label: 'MOV · H.264', extension: 'mov', audioKbps: 192, gpu: true },
  { value: 'avi', label: 'AVI · H.264', extension: 'avi', audioKbps: 192, gpu: true },
  { value: 'wmv', label: 'WMV', extension: 'wmv', audioKbps: 192, gpu: false },
];
export const imageFormats = [
  { value: 'png', label: 'PNG · Sans perte', extension: 'png', mime: 'image/png' },
  { value: 'jpg', label: 'JPG · Haute qualité', extension: 'jpg', mime: 'image/jpeg' },
  { value: 'jpeg', label: 'JPEG · Haute qualité', extension: 'jpeg', mime: 'image/jpeg' },
  { value: 'webp', label: 'WebP · Haute qualité', extension: 'webp', mime: 'image/webp' },
  { value: 'pdf', label: 'PDF · Image pleine page', extension: 'pdf', mime: 'application/pdf' },
] as const;
export type ImageFormat = (typeof imageFormats)[number]['value'];

export function videoFormat(value = 'mp4') {
  const format = videoFormats.find((f) => f.value === value);
  if (!format) throw Error('Format vidéo non pris en charge.');
  return format;
}
export function imageFormat(value = 'png') {
  const format = imageFormats.find((f) => f.value === value);
  if (!format) throw Error('Format image non pris en charge.');
  return format;
}
export function withExtension(file: string, extension: string) {
  const known = /\.(mp4|webm|mov|avi|wmv|png|jpg|jpeg|webp|pdf|cube|lumilook|lumilooks)$/i;
  return known.test(file) ? file.replace(known, '.' + extension) : file + '.' + extension;
}
