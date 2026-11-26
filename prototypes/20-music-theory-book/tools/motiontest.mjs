// How smooth a push is. Samples, frame by frame, the slip that shrinks
// (its place, size and text size), the slip above it, the new slip, the
// whole stack's height and the top of what lies under the stack, for a
// push without and a push with a slip folding into the pile. Reports the
// largest change between two frames and how often each turns back (each
// should change one way only). Then freezes every animation of the
// folding push at moments through it and puts the frames side by side.
// The page is scrolled, not the stage frame: a frame that clips its
// content can be scrolled by script, and it would slide back as the stack
// grows, which a child scrolling the page never sees.
// Usage: node csmotion.mjs <width> <out-dir>
import { openPage } from '../tools/serve.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');
const [, , width = '390', out = '.'] = process.argv;
const { page, errors, close } = await openPage('proto/c7-conclusion-stack.html', width, 1000, 2);
const toStack = () => page.evaluate(() => window.scrollTo(0, document.querySelector('#main-stack').getBoundingClientRect().top + window.scrollY - 20));
await toStack();

const sample = (from, to, shrinking, above) => page.evaluate(([from, to, shrinking, above]) => new Promise((done) => {
  window.tlGoTo(from, false);
  setTimeout(() => {
    const rows = [], t0 = performance.now();
    const read = () => {
      const h = document.querySelector('#main-stack'), q = (id) => h.querySelector(`.tl-cs-slip[data-id="${id}"]`);
      const s = q(shrinking), a = q(above), n = h.querySelector('.tl-cs-slip:last-of-type');
      const rs = s.getBoundingClientRect(), ra = a ? a.getBoundingClientRect() : { top: 0 };
      rows.push({ t: Math.round(performance.now() - t0), top: rs.top, h: rs.height, w: rs.width, fs: parseFloat(getComputedStyle(s.querySelector('.tl-cs-body')).fontSize), above: ra.top, newH: n && n !== s ? n.getBoundingClientRect().height : 0, stack: h.getBoundingClientRect().height, below: document.querySelector('.act-slot').getBoundingClientRect().top });
      if (performance.now() - t0 < 1200) requestAnimationFrame(read); else done(rows);
    };
    window.tlGoTo(to, true);
    requestAnimationFrame(read);
  }, 300);
}), [from, to, shrinking, above]);

const report = (label, rows) => {
  const jump = (k) => Math.max(...rows.slice(1).map((s, i) => Math.abs(s[k] - rows[i][k])));
  const span = (k) => `${rows[0][k].toFixed(1)} -> ${rows[rows.length - 1][k].toFixed(1)}`;
  const turns = (k) => { let dir = 0, n = 0; rows.slice(1).forEach((s, i) => { const d = s[k] - rows[i][k]; if (Math.abs(d) < .5) return; const sg = Math.sign(d); if (dir && sg !== dir) n++; dir = sg; }); return n; };
  const moving = (k) => { const m = rows.filter((s, i) => i && Math.abs(s[k] - rows[i - 1][k]) > .05); return m.length ? `${m[0].t}-${m[m.length - 1].t} ms` : 'still'; };
  const at = (k, ms) => { const r = rows.find((s) => s.t >= ms) || rows[rows.length - 1]; const a = rows[0][k], b = rows[rows.length - 1][k]; return b === a ? '-' : Math.round(100 * (r[k] - a) / (b - a)) + '%'; };
  console.log(`${label}: ${rows.length} frames over ${rows[rows.length - 1].t} ms`);
  for (const [k, name] of [['fs', 'shrinking slip text size'], ['h', 'shrinking slip height'], ['top', 'shrinking slip top'], ['above', 'slip above, top'], ['newH', 'new slip height'], ['stack', 'stack height'], ['below', 'what lies under the stack, top']]) {
    console.log(`  ${name}: ${span(k)}, largest change in one frame ${jump(k).toFixed(1)}, turns back ${turns(k)} times, moving ${moving(k)}, done by 100/150/260 ms ${at(k, 100)}/${at(k, 150)}/${at(k, 260)}`);
  }
};
report('push 3 (no fold)', await sample(2, 3, 'k2', 'k1'));
report('push 4 (folds the oldest)', await sample(3, 4, 'k3', 'k2'));

// Filmstrip of the folding push.
await page.evaluate(() => window.tlGoTo(3, false));
await page.waitForTimeout(400);
await toStack();
await page.evaluate(() => { window.tlGoTo(4, true); document.getAnimations().forEach((a) => a.pause()); });
const frames = [];
for (const t of [0, 100, 200, 300, 400, 520, 640, 900]) {
  await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), t);
  await page.waitForTimeout(60);
  const p = `${out}/motion-${width}-${t}.png`;
  await (await page.$('#main-stack')).screenshot({ path: p });
  frames.push([t, p]);
}
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
const html = '<body style="margin:0;background:#e8e0d2;display:flex;flex-wrap:wrap;gap:10px;padding:10px;font:14px sans-serif;align-items:flex-start">' + frames.map(([t, p]) => `<figure style="margin:0;background:#f6efe4;padding:6px;border-radius:8px"><figcaption>${t} ms</figcaption><img style="width:${Math.min(380, Number(width))}px;display:block" src="data:image/png;base64,${readFileSync(p).toString('base64')}"></figure>`).join('') + '</body>';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1640, height: 900 } });
await pg.setContent(html);
await pg.waitForTimeout(300);
await pg.screenshot({ path: `${out}/motion-${width}-sheet.png`, fullPage: true });
await b.close();
console.log('sheet written');
