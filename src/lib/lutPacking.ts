/* Lossless LUT packing (.llut v1): float32 table, byte transform, gzip. */
const HEADER = 64, MAGIC = [76, 76, 85, 84];
export interface PackedLut { size: number; data: Float32Array; domainMin: number[]; domainMax: number[] }

function validateSize(size: number) {
  if (!Number.isInteger(size) || size < 2 || size > 65) throw Error('Dimensions du pack LUT invalides.');
}
function shuffle(bytes: Uint8Array, reverse = false) {
  const result = new Uint8Array(bytes.length), count = bytes.length / 4;
  for (let i = 0; i < count; i++) for (let b = 0; b < 4; b++) {
    if (reverse) result[4 * i + b] = bytes[b * count + i];
    else result[b * count + i] = bytes[4 * i + b];
  }
  return result;
}
export function tableBytes(lut: { size: number; data: ArrayLike<number> }) {
  validateSize(lut.size);
  if (lut.data.length !== lut.size ** 3 * 3) throw Error('Table LUT incomplète.');
  const bytes = new Uint8Array(lut.data.length * 4), view = new DataView(bytes.buffer);
  for (let i = 0; i < lut.data.length; i++) {
    view.setFloat32(i * 4, lut.data[i], true);
    if (!Number.isFinite(view.getFloat32(i * 4, true))) throw Error('Valeur LUT invalide.');
  }
  return bytes;
}
function transform(bytes: Uint8Array, mode: number, reverse = false) {
  if (mode === 0) return bytes;
  const shuffled = mode >= 3, kind = mode === 1 || mode === 3 ? 'xor' : 'delta';
  if (reverse && shuffled) bytes = shuffle(bytes, true);
  const result = new Uint8Array(bytes.length);
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), output = new DataView(result.buffer);
  for (let i = 0; i < bytes.length / 4; i++) {
    const word = input.getUint32(i * 4, true), previous = i < 3 ? 0 : (reverse ? output : input).getUint32((i - 3) * 4, true);
    let value: number;
    if (kind === 'xor') value = (word ^ previous) >>> 0;
    else if (reverse) value = (previous + ((word >>> 1) ^ -(word & 1))) >>> 0;
    else { const delta = (word - previous) | 0; value = ((delta << 1) ^ (delta >> 31)) >>> 0; }
    output.setUint32(i * 4, value, true);
  }
  return shuffled && !reverse ? shuffle(result) : result;
}
type Compress = (data: Uint8Array) => Promise<Uint8Array | ArrayBuffer> | Uint8Array | ArrayBuffer;
export async function packLUT(lut: { size: number; data: ArrayLike<number>; domainMin?: number[]; domainMax?: number[] }, compress: Compress = gzip, { modes = [0, 1, 2, 3, 4] } = {}) {
  const bytes = tableBytes(lut), domainMin = lut.domainMin || [0, 0, 0], domainMax = lut.domainMax || [1, 1, 1];
  if (domainMin.length !== 3 || domainMax.length !== 3 || domainMin.some((v, i) => !Number.isFinite(v) || !Number.isFinite(domainMax[i]) || domainMax[i] <= v)) throw Error('Domaine LUT invalide.');
  let best: Uint8Array | undefined, mode = 0;
  for (const candidate of modes) {
    const packed = new Uint8Array(await compress(transform(bytes, candidate)));
    if (!best || packed.length < best.length) { best = packed; mode = candidate; }
  }
  const result = new Uint8Array(HEADER + best!.length), view = new DataView(result.buffer);
  result.set(MAGIC); result[4] = 1; result[5] = mode;
  view.setUint16(6, lut.size, true); view.setUint32(8, bytes.length, true);
  for (let c = 0; c < 3; c++) { view.setFloat64(16 + c * 8, domainMin[c], true); view.setFloat64(40 + c * 8, domainMax[c], true); }
  result.set(best!, HEADER);
  return result;
}
async function streamThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}
export const gzip = (bytes: Uint8Array) => streamThrough(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes: Uint8Array) => streamThrough(bytes, new DecompressionStream('gzip'));

export async function unpackLUT(input: ArrayBuffer | Uint8Array, inflate: (b: Uint8Array) => Promise<Uint8Array> = gunzip): Promise<PackedLut> {
  const packed = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (packed.length < HEADER || MAGIC.some((v, i) => packed[i] !== v) || packed[4] !== 1 || packed[5] > 4) throw Error('Format du pack LUT invalide.');
  const header = new DataView(packed.buffer, packed.byteOffset, HEADER), size = header.getUint16(6, true);
  validateSize(size);
  const length = size ** 3 * 3 * 4;
  if (header.getUint32(8, true) !== length) throw Error('Taille du pack LUT invalide.');
  const domainMin: number[] = [], domainMax: number[] = [];
  for (let c = 0; c < 3; c++) { domainMin.push(header.getFloat64(16 + c * 8, true)); domainMax.push(header.getFloat64(40 + c * 8, true)); }
  if (domainMin.some((v, i) => !Number.isFinite(v) || !Number.isFinite(domainMax[i]) || domainMax[i] <= v)) throw Error('Domaine du pack LUT invalide.');
  const inflated = new Uint8Array(await inflate(packed.subarray(HEADER)));
  if (inflated.length !== length) throw Error('Le pack LUT est incomplet.');
  const bytes = transform(inflated, packed[5], true), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), data = new Float32Array(length / 4);
  for (let i = 0; i < data.length; i++) { data[i] = view.getFloat32(i * 4, true); if (!Number.isFinite(data[i])) throw Error('Valeur du pack LUT invalide.'); }
  return { size, data, domainMin, domainMax };
}

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function fromBase64(text: string) {
  const binary = atob(text.replace(/\s+/g, '')), out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
