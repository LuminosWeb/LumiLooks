// Node-side helpers for packing the bundled LUTs (same .llut v1 format as src/lib/lutPacking.ts).
export function parseCube(text) {
  let size = 0, values = [], domainMin = [0, 0, 0], domainMax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(); if (!line) continue;
    if (line.startsWith('LUT_3D_SIZE')) size = Number(line.split(/\s+/)[1]);
    else if (line.startsWith('DOMAIN_MIN')) domainMin = line.split(/\s+/).slice(1).map(Number);
    else if (line.startsWith('DOMAIN_MAX')) domainMax = line.split(/\s+/).slice(1).map(Number);
    else if (/^[+\-.\d]/.test(line)) { const row = line.split(/\s+/).map(Number); if (row.length !== 3 || row.some((v) => !Number.isFinite(v))) throw Error('Valeurs LUT invalides.'); values.push(...row); }
  }
  if (!Number.isInteger(size) || size < 2 || size > 65 || values.length !== size ** 3 * 3) throw Error('LUT 3D .cube invalide.');
  return { size, data: new Float32Array(values), domainMin, domainMax };
}
const HEADER = 64, MAGIC = [76, 76, 85, 84];
function shuffle(bytes) { const result = new Uint8Array(bytes.length), count = bytes.length / 4; for (let i = 0; i < count; i++) for (let b = 0; b < 4; b++) result[b * count + i] = bytes[4 * i + b]; return result; }
export function tableBytes(lut) {
  const bytes = new Uint8Array(lut.data.length * 4), view = new DataView(bytes.buffer);
  for (let i = 0; i < lut.data.length; i++) view.setFloat32(i * 4, lut.data[i], true);
  return bytes;
}
function transform(bytes, mode) {
  if (mode === 0) return bytes;
  const shuffled = mode >= 3, kind = mode === 1 || mode === 3 ? 'xor' : 'delta', result = new Uint8Array(bytes.length);
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), output = new DataView(result.buffer);
  for (let i = 0; i < bytes.length / 4; i++) {
    const word = input.getUint32(i * 4, true), previous = i < 3 ? 0 : input.getUint32((i - 3) * 4, true);
    let value; if (kind === 'xor') value = (word ^ previous) >>> 0; else { const delta = (word - previous) | 0; value = ((delta << 1) ^ (delta >> 31)) >>> 0; }
    output.setUint32(i * 4, value, true);
  }
  return shuffled ? shuffle(result) : result;
}
export async function packLUT(lut, compress) {
  const bytes = tableBytes(lut), domainMin = lut.domainMin || [0, 0, 0], domainMax = lut.domainMax || [1, 1, 1];
  let best, mode = 0;
  for (const candidate of [0, 1, 2, 3, 4]) { const packed = new Uint8Array(await compress(transform(bytes, candidate))); if (!best || packed.length < best.length) { best = packed; mode = candidate; } }
  const result = new Uint8Array(HEADER + best.length), view = new DataView(result.buffer);
  result.set(MAGIC); result[4] = 1; result[5] = mode; view.setUint16(6, lut.size, true); view.setUint32(8, bytes.length, true);
  for (let c = 0; c < 3; c++) { view.setFloat64(16 + c * 8, domainMin[c], true); view.setFloat64(40 + c * 8, domainMax[c], true); }
  result.set(best, HEADER); return result;
}
