// Shows every generated logo lockup (art/logo-*.png, the planet with the name
// drawn in) at full width, at the heights the pages use, and on a dark
// surface, so the candidates can be compared on one sheet.
// Usage: node logo-sheet.mjs <output.png>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [output] = process.argv.slice(2);
const lockups = readdirSync('art')
  .filter((f) => /^logo-.*\.png$/.test(f))
  .sort();

const img = (file, height) => `<img src="../art/${file}" alt="" style="height:${height}px" class="w-auto shrink-0" />`;

const block = (file) => `
<section class="flex flex-col gap-6 rounded-card border border-line bg-surface p-8 shadow-card">
  <p class="text-sm font-bold text-ink-muted">${file.replace(/\.png$/, '')}</p>
  <div class="flex items-center justify-center rounded-2xl bg-canvas py-4">${img(file, 300)}</div>
  <div class="flex flex-wrap items-center gap-6">
    <div class="flex items-center rounded-2xl bg-canvas px-4 py-2">${img(file, 48)}</div>
    <div class="flex items-center rounded-2xl bg-surface px-3 py-1.5 ring-1 ring-line">${img(file, 36)}</div>
    <div class="flex items-center rounded-2xl bg-primary px-4 py-2">${img(file, 48)}</div>
  </div>
</section>`;

mkdirSync('build', { recursive: true });
writeFileSync(
  'build/logo-sheet.html',
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><link rel="stylesheet" href="styles.css" /></head>
   <body class="bg-app p-8 font-sans"><div class="grid w-[1100px] gap-6">${lockups.map(block).join('')}</div></body></html>`,
);
execFileSync(
  process.execPath,
  ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'src/theme.css', '-o', 'build/styles.css'],
  { stdio: 'inherit' },
);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1170, height: 800 } });
await tab.goto(new URL('build/logo-sheet.html', import.meta.url).href);
await tab.waitForLoadState('networkidle');
await tab.screenshot({ path: output, fullPage: true });
await browser.close();
console.log(`${lockups.length} lockups`);
