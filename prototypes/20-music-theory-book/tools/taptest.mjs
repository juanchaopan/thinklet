// Taps every note of every score component in a prototype where a child
// would: on the note head, just left of it (where an accidental sits) and
// just above it. Reports taps that do not light that note, and page errors.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');

const [, , file, width = '390'] = process.argv;
const body = readFileSync(file, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.setContent(html, { waitUntil: 'networkidle' });
const boxes = await page.$$eval('.tl-svgbox', (els) => els.length);
let misses = 0;
let total = 0;
for (let s = 0; s < boxes; s += 1) {
  const count = await page.$$eval('.tl-svgbox', (els, s) => els[s].querySelectorAll('.abcjs-note').length, s);
  for (let i = 0; i < count; i += 1) {
    for (const where of ['head', 'left', 'above']) {
      const pt = await page.$$eval('.tl-svgbox', (els, a) => {
        const el = els[a.s].querySelectorAll('.abcjs-note')[a.i];
        const head = el.querySelector('.abcjs-notehead') || el;
        head.scrollIntoView({ block: 'center' });
        const r = head.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (a.where === 'left') return { x: r.left - 6, y: cy };
        if (a.where === 'above') return { x: cx, y: r.top - 10 };
        return { x: cx, y: cy };
      }, { s, i, where });
      await page.mouse.click(pt.x, pt.y);
      const ok = await page.$$eval('.tl-svgbox', (els, a) => els[a.s].querySelectorAll('.abcjs-note')[a.i].classList.contains('tl-lit'), { s, i });
      total += 1;
      if (!ok) { misses += 1; console.log('miss score', s, 'note', i, where); }
    }
  }
}
console.log(`width ${width}: scores ${boxes}, taps ${total}, misses ${misses}`);
if (errors.length) console.log('errors:', errors.join(' | '));
await browser.close();
