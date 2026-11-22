// Lays every art/icon-*.png out on one labelled sheet, at full size and at the
// small sizes the pages use, so the set can be reviewed at a glance.
// Usage: node sheet.mjs <output.png>
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const [output] = process.argv.slice(2);
const icons = readdirSync('art')
  .filter((f) => /^icon-.*\.png$/.test(f))
  .sort();
const cells = icons
  .map(
    (f) => `<figure style="margin:0;display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px;background:#fff;border-radius:20px;border:1px solid #e8eaf0">
      <img src="${f}" style="width:160px;height:160px;object-fit:contain" />
      <div style="display:flex;gap:10px;align-items:center"><img src="${f}" style="width:48px;height:48px" /><img src="${f}" style="width:28px;height:28px" /></div>
      <figcaption style="font:600 14px system-ui">${f.replace(/^icon-|\.png$/g, '')}</figcaption>
    </figure>`,
  )
  .join('');
const htmlPath = resolve('art/.sheet.html');
writeFileSync(
  htmlPath,
  `<body style="margin:0;padding:24px;background:#f6f7fb;display:grid;grid-template-columns:repeat(5,1fr);gap:16px;width:1100px">${cells}</body>`,
);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1148, height: 400 } });
await tab.goto(pathToFileURL(htmlPath).href);
await tab.waitForLoadState('networkidle');
await tab.screenshot({ path: output, fullPage: true });
await browser.close();
rmSync(htmlPath);
console.log(`${icons.length} icons`);
