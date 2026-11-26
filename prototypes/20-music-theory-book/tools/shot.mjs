// Renders an artifact-style HTML fragment in Chromium and saves full-page
// screenshots at the three thinklet screen sizes.
// Usage: node shot.mjs <fragment.html> <out-prefix> [click-selector ...]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');

const [, , file, out, ...clicks] = process.argv;
const body = readFileSync(file, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;

const sizes = { phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900] };
const browser = await chromium.launch();
for (const [name, [width, height]] of Object.entries(sizes)) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setContent(html, { waitUntil: 'networkidle' });
  for (const sel of clicks) {
    await page.click(sel);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}--${name}.png`, fullPage: true });
  if (errors.length) console.log(name, 'errors:', errors.join(' | '));
  await page.close();
}
await browser.close();
console.log('done');
