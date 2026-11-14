// Packs the raw LUT sources of luts-src/ (not shipped, not committed) into public/assets/lut-packs/*.llut
// and writes src/generated/bundled-presets.json. The packed files are committed, so builds don't need the sources.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseCube, packLUT, tableBytes } from './lut-tools.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'luts-src'), manifests = path.join(root, 'src/preset-packs'), output = path.join(root, 'public/assets/lut-packs'), generated = path.join(root, 'src/generated');
const inside = (base, target) => { if (!target.startsWith(base + path.sep)) throw Error('Chemin du pack LUT hors du projet.'); return target; };
export async function packAllLUTs() {
  if (!existsSync(sourceRoot)) { console.log('luts-src/ absent : packs LUT déjà compilés conservés.'); return null; }
  const files = (await fs.readdir(manifests)).filter((name) => name.endsWith('.json')).sort(), entries = [], seen = new Set();
  let sourceBytes = 0, packedBytes = 0;
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(generated, { recursive: true });
  for (const name of files) {
    const pack = JSON.parse(await fs.readFile(path.join(manifests, name), 'utf8'));
    for (const entry of pack) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.id) || seen.has(entry.id)) throw Error('Identifiant LUT invalide ou dupliqué : ' + entry.id);
      seen.add(entry.id);
      const source = inside(sourceRoot, path.resolve(sourceRoot, entry.lutPath.replace(/^assets\/luts\//, ''))), bytes = await fs.readFile(source);
      let lut;
      if (path.extname(source) === '.cube') lut = parseCube(bytes.toString('utf8'));
      else if (path.extname(source) === '.bin' && entry.lutSize) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), data = new Float32Array(bytes.length / 4);
        for (let i = 0; i < data.length; i++) data[i] = view.getFloat32(i * 4, true);
        lut = { size: entry.lutSize, data };
      } else throw Error('Format source LUT non pris en charge : ' + entry.lutPath);
      const packed = await packLUT(lut, (data) => gzipSync(data, { level: 9 })), file = entry.id + '.llut';
      await fs.writeFile(inside(output, path.join(output, file)), packed);
      entries.push({ ...entry, lutPath: 'assets/lut-packs/' + file, lutSize: lut.size, lutEncoding: 'llut-v1', lutTableSha256: createHash('sha256').update(tableBytes(lut)).digest('hex'), lutPackedSha256: createHash('sha256').update(packed).digest('hex') });
      sourceBytes += bytes.length; packedBytes += packed.length;
    }
  }
  await fs.writeFile(path.join(generated, 'bundled-presets.json'), JSON.stringify(entries, null, 2) + '\n');
  console.log(`LUT packs: ${entries.length} tables, ${sourceBytes} → ${packedBytes} bytes (${((1 - packedBytes / sourceBytes) * 100).toFixed(2)}% smaller, lossless).`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) packAllLUTs().catch((e) => { console.error(e); process.exitCode = 1; });
