// Downloads the static FFmpeg sidecar for a Rust target triple into src-tauri/binaries/ (Tauri externalBin naming).
// Usage: node scripts/fetch-ffmpeg.mjs [--target x86_64-pc-windows-msvc]
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.env.FFMPEG_STATIC_TAG || 'b6.1.1';
const arg = process.argv.indexOf('--target');
const target = arg > 0 ? process.argv[arg + 1] : /host: (\S+)/.exec(execSync('rustc -vV').toString())[1];
const platforms = {
  'x86_64-pc-windows-msvc': 'win32-x64',
  'aarch64-pc-windows-msvc': 'win32-x64',
  'x86_64-apple-darwin': 'darwin-x64',
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-unknown-linux-gnu': 'linux-x64',
  'aarch64-unknown-linux-gnu': 'linux-arm64',
};
const platform = platforms[target];
if (!platform) throw Error(`Cible non prise en charge : ${target}`);
const base = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/`;
async function download(name) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(base + name, { redirect: 'follow' });
      if (!response.ok) throw Error(`${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 4) throw Error(`Téléchargement impossible de ${name} : ${error.message}`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}
const binaries = path.join(root, 'src-tauri/binaries'), licenses = path.join(binaries, 'licenses');
await fs.mkdir(licenses, { recursive: true });
const exe = target.includes('windows') ? '.exe' : '';
const output = path.join(binaries, `ffmpeg-${target}${exe}`);
const binary = gunzipSync(await download(`ffmpeg-${platform}.gz`));
await fs.writeFile(output, binary);
await fs.chmod(output, 0o755);
await fs.writeFile(path.join(licenses, 'FFmpeg-LICENSE.txt'), await download(`${platform}.LICENSE`));
await fs.writeFile(path.join(licenses, 'FFmpeg-README.txt'), await download(`${platform}.README`));
console.log(`FFmpeg ${tag} (${platform}) → ${path.relative(root, output)} (${(binary.length / 1e6).toFixed(1)} Mo)`);
