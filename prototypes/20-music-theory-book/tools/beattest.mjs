// Taps every tile of the main beat grid and checks the tileTap event names
// that tile; taps every beat cell; checks blank taps clear, lights fade,
// commands run without errors, grids in one group are the same size, the
// page does not scroll sideways, and the sound source reaches ready.
// Usage: node beattest.mjs <fragment.html> [width] [shot.png]
import { openPage } from './serve.mjs';

const [, , file, width = '390', shot] = process.argv;
const { page, errors, close } = await openPage(file, width);
await page.waitForTimeout(500);

const lastOf = (type) => page.evaluate((t) => window.tlEvents.filter((e) => e.type === t).pop(), type);
const litNow = () => page.$$eval('#main-grid .tl-part.tl-lit', (ps) => ps.length);

// Tap the middle of each tile's ribbon.
async function tapTile(i) {
  const pt = await page.$eval(`#main-grid .tl-part[data-i="${i}"] .tl-ribbon`, (r) => { r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.click(pt.x, pt.y);
}
async function tapGlyph(i) {
  const pt = await page.$eval(`#main-grid .tl-part[data-i="${i}"] .tl-glyph`, (r) => { r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.click(pt.x, pt.y);
}

for (const meter of ['m78', 'm24']) {
  await page.click(`[data-cmd="${meter}"]`);
  await page.waitForTimeout(200);
  const n = await page.$$eval('#main-grid .tl-part', (ps) => new Set(ps.map((p) => p.dataset.i)).size);
  let hitR = 0, hitG = 0; const missed = [];
  for (let i = 0; i < n; i++) {
    await tapTile(i); const a = await lastOf('tileTap'); if (a && a.index === i) hitR++; else missed.push('r' + i);
    await tapGlyph(i); const b = await lastOf('tileTap'); if (b && b.index === i) hitG++; else missed.push('g' + i);
  }
  const rows = await page.$$eval('#main-grid .tl-row', (rs) => rs.length);
  const over = await page.$$eval('#main-grid .tl-part.tl-over', (ps) => new Set(ps.map((p) => p.dataset.i)).size);
  console.log(`${meter} width ${width}: tiles ${n}, ribbon hits ${hitR}, glyph hits ${hitG}${missed.length ? ', missed ' + missed.join(',') : ''}; rows ${rows}; over ${over}`);
}

await page.click('[data-cmd="m78"]');
const cells = await page.$$eval('#main-grid .tl-cell', (cs) => cs.map((c) => Number(c.dataset.beat)));
let beatHits = 0;
for (const b of [...new Set(cells)]) {
  const pt = await page.$eval(`#main-grid .tl-cell[data-beat="${b}"]`, (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(pt.x, pt.y);
  const e = await lastOf('beatTap'); if (e && e.beat === b) beatHits++;
}
console.log(`beats ${new Set(cells).size}, beat hits ${beatHits}`);

await tapTile(4);
const afterTap = await litNow();
const blank = await page.$eval('#main-grid .tl-card', (c) => { const r = c.getBoundingClientRect(); return { x: r.left + 4, y: r.top + 4 }; });
await page.mouse.click(blank.x, blank.y);
const afterBlank = await litNow();
await tapTile(4);
await page.waitForTimeout(2300);
const afterFade = await litNow();
console.log(`lit after tap ${afterTap}, after blank tap ${afterBlank}, after 2.3s ${afterFade}`);

for (const cmd of ['unknown', 'm34', 'sub', 'label', 'spot', 'count', 'play', 'clear']) {
  await page.click(`[data-cmd="${cmd}"]`);
  await page.waitForTimeout(cmd === 'count' ? 2000 : 300);
}
const counts = await page.evaluate(() => window.tlEvents.filter((e) => e.type === 'countStep').map((e) => e.n + '/' + e.total).join(' '));
console.log(`countStep ${counts}`);
await page.waitForTimeout(3500);
const plays = await page.evaluate(() => window.tlEvents.filter((e) => e.type === 'playStart' || e.type === 'playEnd').map((e) => e.type).join(' '));
console.log(`play events ${plays}`);

for (const g of ['#g-pair', '#g-three']) {
  const sizes = await page.$$eval(`${g} .tl-card`, (cs) => cs.map((c) => `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`));
  console.log(g, [...new Set(sizes)].join(' | '));
}
// Beat 2 of (a) and (b) in the pair must start at the same x.
const align = await page.$$eval('#g-pair .tl-bg', (gs) => gs.map((g) => { const c = g.querySelector('.tl-cell[data-beat="2"]'); return c ? Math.round(c.getBoundingClientRect().left) : null; }));
console.log('pair beat 2 left', align.join(' / '));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('page scrolls sideways', overflow);
console.log(await page.$eval('#sound-state', (e) => e.textContent));
if (shot) { await page.click('[data-cmd="m78"]'); await page.click('[data-cmd="label"]'); await page.waitForTimeout(600); await page.screenshot({ path: shot, fullPage: true }); }
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
