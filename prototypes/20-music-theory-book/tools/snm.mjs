// Prints the instrument names abcjs draws on each line for a few spellings of the short name.
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<div id="o" style="width:300px"></div><script src="https://cdn.jsdelivr.net/npm/abcjs@6.7.2/dist/abcjs-basic-min.js"></script>', { waitUntil: 'networkidle' });
for (const f of ['snm', 'subname', 'sname']) {
  const t = await page.evaluate((f) => {
    ABCJS.renderAbc('o', `X:1\nM:3/4\nL:1/8\n%%score V\nV:V clef=treble name="Violin" ${f}="Vln."\nK:C\n[V:V] c6|c6|c6|c6|]`, { add_classes: true, staffwidth: 200, wrap: { minSpacing: 1.6, maxSpacing: 2.7, preferredMeasuresPerLine: 1 } });
    return [...document.querySelectorAll('#o text')].map((e) => e.textContent).join(' / ');
  }, f);
  console.log(f, '=>', t);
}
await browser.close();
