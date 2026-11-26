// Joins the key frames of one animation, captured by render.mjs, into a single
// labelled strip, so the whole movement can be reviewed in one image.
// Usage: node strip.mjs <round> <page-name> <size> <output.png>
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [round, name, size, output] = process.argv.slice(2);
const dir = resolve('shots', round);
const pattern = new RegExp(`^${name}--${size}--(\\d+)ms\\.png$`);
const frames = readdirSync(dir)
  .map((f) => [f, pattern.exec(f)])
  .filter(([, m]) => m)
  .sort((a, b) => Number(a[1][1]) - Number(b[1][1]));
const width = { phone: 300, tablet: 360, desktop: 520 }[size];
const cells = frames
  .map(
    ([f, m]) => `<figure style="margin:0;display:flex;flex-direction:column;gap:8px;align-items:center">
      <img src="${f}" style="width:${width}px;border-radius:12px;border:1px solid #d9d3c7" />
      <figcaption style="font:700 16px system-ui">${Number(m[1])} ms</figcaption>
    </figure>`,
  )
  .join('');
const htmlPath = resolve(dir, `.strip-${name}-${size}.html`);
writeFileSync(htmlPath, `<body style="margin:0;padding:20px;background:#f7f4ef;display:inline-flex;gap:16px">${cells}</body>`);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 400, height: 400 } });
await tab.goto(pathToFileURL(htmlPath).href);
await tab.waitForLoadState('networkidle');
const box = await tab.evaluate(() => [document.body.scrollWidth, document.body.scrollHeight]);
await tab.setViewportSize({ width: box[0], height: box[1] });
await tab.screenshot({ path: output, fullPage: true });
await browser.close();
rmSync(htmlPath);
console.log(`${frames.length} frames`);
