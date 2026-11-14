// Renders each optical effect on a photo into one contact sheet (browser build served by `npm run preview`).
// Usage: CHROME_PATH=... node e2e/effects-sheet.mjs <photo> <output.png>
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 940 } });
await page.goto('http://127.0.0.1:4173/');
await page.waitForTimeout(800);
const chooser = page.waitForEvent('filechooser');
await page.click('#empty-import');
await (await chooser).setFiles([process.argv[2]]);
await page.waitForSelector('.media-item');
await page.waitForTimeout(2500);
const cases = [
  ['original', {}],
  ['haze-flare', { hazeAmount: 55, hazeSize: 55, hazeX: 80, hazeY: 15, hazeHue: 35 }],
  ['anamorphic-flare', { flareAmount: 75, flareThreshold: 55, flareLength: 75, flareHue: 210 }],
  ['chromatic-aberration', { aberration: 80 }],
  ['lens-distortion-barrel', { distortion: 70 }],
  ['optical-diffusion', { diffusionAmount: 65, diffusionSize: 60, diffusionThreshold: 40 }],
];
const out = [];
for (const [name, values] of cases) {
  await page.evaluate(() => window.__lumilooks.applyPreset('original'));
  await page.evaluate((v) => window.__lumilooks.setSettings(v), values);
  await page.waitForTimeout(700);
  const data = await page.evaluate(() => { const c = document.querySelector('#preview'); const t = document.createElement('canvas'); t.width = 640; t.height = Math.round(640 * c.height / c.width); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.85); });
  out.push([name, data]);
}
const html = '<body style="margin:0;background:#111;color:#eee;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,640px);gap:6px">' + out.map(([n, d]) => `<div><img src="${d}" style="width:640px;display:block"><div style="padding:4px">${n}</div></div>`).join('') + '</body>';
await page.setContent(html); await page.setViewportSize({ width: 1932, height: 900 });
await page.screenshot({ path: process.argv[3], fullPage: true });
await browser.close();
