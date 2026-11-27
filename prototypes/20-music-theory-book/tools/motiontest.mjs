// How smooth the conclusion stack moves. For a push that grows in place,
// samples frame by frame the slip that shrinks (its place, size and text
// size), the slip above it, the new slip, the whole stack's height and the
// top of what lies under the stack, without and with a slip folding into
// the pile; reports the largest change between two frames, how often each
// turns back (each should change one way only) and how far it has gone at
// 100, 150 and 260 ms. For a push that flies in from the act's component,
// samples the flying copy: its distance to where it lands, how far it has
// gone at 100 and 150 ms, that it never turns back, that it ends exactly
// on the slip and that the slip shows only once it has landed. Then
// freezes every animation of the folding push at moments through it and
// puts the frames side by side.
// The page is scrolled, not the stage frame: a frame that clips its
// content can be scrolled by script, and it would slide back as the stack
// grows, which a child scrolling the page never sees.
// Usage: node motiontest.mjs <width> <out-dir>
import { openPage } from './serve.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');
const [, , width = '390', out = '.'] = process.argv;
const page_ = join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'c7-conclusion-stack.html');
const { page, errors, close } = await openPage(page_, width, 1000, 2);
const toStack = () => page.evaluate(() => window.scrollTo(0, document.querySelector('#main-stack').getBoundingClientRect().top + window.scrollY - 20));
await toStack();
const fails = [];

const sample = (from, to, shrinking, above) => page.evaluate(([from, to, shrinking, above]) => new Promise((done) => {
  window.tlGoTo(from, 'set');
  setTimeout(() => {
    const rows = [], t0 = performance.now();
    const read = () => {
      const h = document.querySelector('#main-stack'), q = (id) => h.querySelector(`.tl-cs-list .tl-cs-slip[data-id="${id}"]`);
      const s = q(shrinking), a = q(above), n = h.querySelector('.tl-cs-list .tl-cs-slip:last-of-type');
      const rs = s.getBoundingClientRect(), ra = a ? a.getBoundingClientRect() : { top: 0 };
      rows.push({ t: Math.round(performance.now() - t0), top: rs.top, h: rs.height, w: rs.width, fs: parseFloat(getComputedStyle(s.querySelector('.tl-cs-body')).fontSize), above: ra.top, newH: n && n !== s ? n.getBoundingClientRect().height : 0, stack: h.getBoundingClientRect().height, below: document.querySelector('#main-act').getBoundingClientRect().top });
      if (performance.now() - t0 < 1200) requestAnimationFrame(read); else done(rows);
    };
    window.tlGoTo(to, 'here');
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
    if (turns(k)) fails.push(`${label}: ${name} turns back`);
  }
};
report('push 3 (no fold)', await sample(2, 3, 'k2', 'k1'));
report('push 4 (folds the oldest)', await sample(3, 4, 'k3', 'k2'));

// The flight: from the act's component up to the new slip.
await page.evaluate(() => window.tlGoTo(1, 'set'));
await page.waitForTimeout(400);
await toStack();
const flight = await page.evaluate(() => new Promise((done) => {
  const h = document.querySelector('#main-stack'), rows = [], t0 = performance.now();
  window.tlGoTo(2, 'fly');
  const read = () => {
    const f = h.querySelector('.tl-cs-flyer'), s = h.querySelector('.tl-cs-list .tl-cs-slip[data-id="k2"]');
    const rs = s.getBoundingClientRect();
    if (f) { const rf = f.getBoundingClientRect(); rows.push({ t: Math.round(performance.now() - t0), d: Math.hypot(rf.left + rf.width / 2 - (rs.left + rs.width / 2), rf.top + rf.height / 2 - (rs.top + rs.height / 2)), dw: Math.abs(rf.width - rs.width), op: Number(getComputedStyle(f).opacity), slipShown: getComputedStyle(s).visibility === 'visible' }); }
    else rows.push({ t: Math.round(performance.now() - t0), gone: true, slipShown: getComputedStyle(s).visibility === 'visible' });
    if (performance.now() - t0 < 1300) requestAnimationFrame(read); else done(rows);
  };
  requestAnimationFrame(read);
}));
const flying = flight.filter((r) => !r.gone);
const d0 = flying[0].d, at = (ms) => { const r = flying.find((x) => x.t >= ms) || flying[flying.length - 1]; return Math.round(100 * (1 - r.d / d0)); };
let back = 0; flying.slice(1).forEach((r, i) => { if (r.d > flying[i].d + .75) back++; });
const last = flying[flying.length - 1], landedAt = flight.find((r) => r.gone);
console.log(`flight: ${flying.length} frames, starts ${d0.toFixed(0)} px away, gone by ${d0 ? 100 : 0}% at 100/150/400 ms ${at(100)}%/${at(150)}%/${at(400)}%, last frame ${last.d.toFixed(1)} px off (width off ${last.dw.toFixed(1)}), turns back ${back} times, lands at ${landedAt ? landedAt.t : '-'} ms`);
if (back) fails.push('flight turns back');
if (at(100) > 4) fails.push(`flight already ${at(100)}% along at 100 ms`);
if (last.d > 6) fails.push(`flight ends ${last.d.toFixed(1)} px from the slip`);
if (flying.some((r) => r.slipShown)) fails.push('the slip shows before the copy lands');
if (!landedAt || !landedAt.slipShown) fails.push('the slip does not show after landing');

// Filmstrip of the folding push.
await page.evaluate(() => window.tlGoTo(3, 'set'));
await page.waitForTimeout(400);
await toStack();
await page.evaluate(() => { window.tlGoTo(4, 'here'); document.getAnimations().forEach((a) => a.pause()); });
const frames = [];
for (const t of [0, 100, 200, 300, 400, 520, 640, 900]) {
  await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), t);
  await page.waitForTimeout(60);
  const p = `${out}/motion-${width}-${t}.png`;
  await (await page.$('#main-stack')).screenshot({ path: p });
  frames.push([t, p]);
}
if (errors.length) fails.push('console: ' + errors.join(' | '));
await close();
const html = '<body style="margin:0;background:#e8e0d2;display:flex;flex-wrap:wrap;gap:10px;padding:10px;font:14px sans-serif;align-items:flex-start">' + frames.map(([t, p]) => `<figure style="margin:0;background:#f6efe4;padding:6px;border-radius:8px"><figcaption>${t} ms</figcaption><img style="width:${Math.min(380, Number(width))}px;display:block" src="data:image/png;base64,${readFileSync(p).toString('base64')}"></figure>`).join('') + '</body>';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1640, height: 900 } });
await pg.setContent(html);
await pg.waitForTimeout(300);
await pg.screenshot({ path: `${out}/motion-${width}-sheet.png`, fullPage: true });
await b.close();
console.log(fails.length ? 'FAIL ' + fails.join('; ') : 'PASS');
