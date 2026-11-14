// Builds src/generated/icons.json with solid icons only, from the MingCute "fill" collection on Iconify
// (https://icones.js.org/collection/mingcute). Every icon is a filled SVG using currentColor.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { getIconData } from '@iconify/utils';
const require = createRequire(import.meta.url);
const collection = require('@iconify-json/mingcute/icons.json');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// App name → MingCute icon (always the "-fill" variant)
export const iconMap = {
  minus: 'minimize', square: 'square', x: 'close', pencil: 'edit-2', sliders: 'settings-6', clapperboard: 'clapperboard',
  plus: 'add', export: 'share-forward', 'bookmark-plus': 'bookmark-add', search: 'search', heart: 'heart', bookmark: 'bookmark',
  sparkle: 'sparkles', help: 'question', image: 'pic', undo: 'back-2', redo: 'forward-2', compare: 'columns-2', eye: 'eye-2',
  'move-horizontal': 'chevrons-left-right', download: 'download-2', 'skip-back': 'skip-previous', 'skip-forward': 'skip-forward',
  play: 'play', pause: 'pause', fit: 'scan', scissors: 'scissors', bracket: 'brackets', volume: 'volume', 'volume-off': 'volume-mute',
  folder: 'folder-open', reset: 'refresh-anticlockwise-1', 'rotate-ccw': 'anticlockwise', 'rotate-cw': 'clockwise', palette: 'palette',
  lens: 'lens-convex', focus: 'focus', film: 'film', crop: 'frame', check: 'check', workflow: 'process', 'circle-check': 'check-circle',
  sun: 'sun', droplets: 'drop', thermometer: 'thermometer', paintbrush: 'paint-brush', power: 'power', upload: 'upload-2',
  'chevron-right': 'right', 'chevron-left': 'left', 'chevron-down': 'down', 'chevron-up': 'up', 'file-image': 'file-image', moon: 'moon',
  grip: 'dots-vertical', curve: 'chart-line', 'flip-horizontal': 'flip-vertical', 'flip-vertical': 'flip-horizontal', 'window-restore': 'copy-2',
  fullscreen: 'fullscreen', 'exit-fullscreen': 'fullscreen-exit', 'collapse-left': 'layout-leftbar-close', 'expand-left': 'layout-leftbar-open',
  'collapse-right': 'layout-rightbar-close', 'expand-right': 'layout-rightbar-open', link: 'link', unlink: 'unlink', cpu: 'chip', gpu: 'circuit-board',
  info: 'information', haze: 'haze', flare: 'sparkles-2', diffusion: 'contrast', aberration: 'rainbow', distortion: 'lens-concave',
  lock: 'lock', unlock: 'unlock', warning: 'warning', save: 'save', magic: 'magic-2', target: 'aiming-2', globe: 'globe-2', file: 'file',
  layers: 'layers', mixer: 'color-filter',
};
export async function buildIcons() {
  const out = {};
  for (const [name, id] of Object.entries(iconMap)) {
    const data = getIconData(collection, id + '-fill');
    if (!data) throw Error('Icône introuvable : mingcute:' + id + '-fill');
    out[name] = { body: data.body, width: data.width ?? collection.width ?? 24, height: data.height ?? collection.height ?? 24, id: 'mingcute:' + id + '-fill' };
  }
  await fs.mkdir(path.join(root, 'src/generated'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/generated/icons.json'), JSON.stringify(out) + '\n');
  console.log(`Icons: ${Object.keys(out).length} solid MingCute icons.`);
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildIcons().catch((e) => { console.error(e); process.exitCode = 1; });
