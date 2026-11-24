// Lays the phone, tablet and desktop captures of one state side by side on a
// labelled sheet at their own pixel size, so a state can be reviewed at all
// three sizes in one image. For a state captured only at key frames, name the
// moment to show.
// Usage: node contact.mjs <round> <state> <output.png> [milliseconds]
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [round, state, output, moment] = process.argv.slice(2);
const dir = resolve('shots', round);
const suffix = moment === undefined ? '' : `--${String(moment).padStart(4, '0')}ms`;
const sizes = ['phone', 'tablet', 'desktop'];
const files = sizes.map((size) => `${state}--${size}${suffix}.png`);
const missing = files.filter((f) => !existsSync(resolve(dir, f)));
if (missing.length) throw new Error(`Missing captures: ${missing.join(', ')}`);

const cells = files
  .map(
    (f, i) => `<figure style="margin:0;display:flex;flex-direction:column;gap:10px">
      <figcaption style="font:700 18px system-ui;color:#161a2b">${sizes[i]}</figcaption>
      <img src="${f}" style="display:block;border-radius:12px;border:1px solid #d9d3c7" />
    </figure>`,
  )
  .join('');
const title = `${state}${moment === undefined ? '' : ` · ${Number(moment)} ms`}`;
const htmlPath = resolve(dir, `.contact-${state}.html`);
writeFileSync(
  htmlPath,
  `<body style="margin:0;padding:24px;background:#f7f4ef;display:inline-block">
     <h1 style="margin:0 0 16px;font:800 24px system-ui;color:#161a2b">${title}</h1>
     <div style="display:flex;gap:24px;align-items:flex-start">${cells}</div>
   </body>`,
);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 400, height: 400 } });
await tab.goto(pathToFileURL(htmlPath).href);
await tab.waitForLoadState('networkidle');
const box = await tab.evaluate(() => [document.body.scrollWidth, document.body.scrollHeight]);
await tab.setViewportSize({ width: box[0], height: box[1] });
await tab.screenshot({ path: output, fullPage: true });
await browser.close();
rmSync(htmlPath);
console.log(`sheet ${title}`);
