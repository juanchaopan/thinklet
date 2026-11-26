// Checks the circle of fifths prototype the way a child and a workflow
// would use it: taps every key name and a point of every wedge away from
// its name, the hub and the paper outside; checks lights fade and blank
// taps clear; shows every key and counts the accidentals drawn in the hub;
// turns the dial and taps the key at the top; runs every command; and
// checks that labels do not overlap, the stave stays inside the hub and
// the page does not scroll sideways.
// Usage: node circletest.mjs <fragment.html> [width]
import { openPage } from './serve.mjs';

const [, , file, width = '390'] = process.argv;
const { page, errors, close, loading } = await openPage(file, width);
if (loading) console.log(`loading screen: ${loading.note}, bar ${loading.bar}`);

const lastOf = (type) => page.evaluate((t) => window.tlEvents.filter((e) => e.type === t).pop() || null, type);
const countOf = (type) => page.evaluate((t) => window.tlEvents.filter((e) => e.type === t).length, type);
const toDial = () => page.$eval('#main-dial', (e) => e.scrollIntoView({ block: 'center' }));
await toDial();

// Every name line: a tap on it gives that key.
const lines = await page.$$eval('#main-dial .tl-cf-line', (ls) => ls.map((l) => { const r = l.getBoundingClientRect(); return { key: l.dataset.key, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
let hit = 0;
const missed = [];
for (const l of lines) {
  await page.mouse.click(l.x, l.y);
  const ev = await lastOf('keyTap');
  if (ev && ev.key === l.key) hit++; else missed.push(`${l.key}->${ev && ev.key}`);
}
console.log(`width ${width}: name lines ${lines.length}, hit ${hit}${missed.length ? ', missed ' + missed.join(' ') : ''}`);

// A point in each wedge near its edge, away from the name.
const wedgeTaps = await page.evaluate(() => {
  const d = window.tlMain, rect = d.dial.getBoundingClientRect(), u = d.u, R = CircleOfFifths.R, out = [];
  for (const [ring, r] of [['major', R.bezel - 6], ['minor', R.hub + 5]]) {
    for (let pos = 0; pos < 12; pos++) {
      const a = (pos * 30 + 11 + d.rot) * Math.PI / 180;
      out.push({ ring, pos, x: rect.left + (200 + r * Math.sin(a)) * u, y: rect.top + (200 - r * Math.cos(a)) * u, keys: d.keysAt(ring, pos).map((k) => k.id) });
    }
  }
  return out;
});
let wedgeHit = 0;
const wedgeMiss = [];
for (const w of wedgeTaps) {
  await page.mouse.click(w.x, w.y);
  const ev = await lastOf('keyTap');
  if (ev && w.keys.includes(ev.key)) wedgeHit++; else wedgeMiss.push(`${w.ring}${w.pos}->${ev && ev.key}`);
}
console.log(`taps near a wedge's edge that hit its key ${wedgeHit}/${wedgeTaps.length}${wedgeMiss.length ? ' missed ' + wedgeMiss.join(' ') : ''}`);

// Hub, bezel, outside, fade.
const centre = await page.$eval('#main-dial .tl-cf-dial', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
await page.mouse.click(centre.x, centre.y);
const hubEv = await lastOf('hubTap');
const lit = () => page.$$eval('#main-dial .tl-cf-wedge.tl-lit', (ws) => ws.length);
const bezelTap = await page.evaluate(() => { const d = window.tlMain, r = d.dial.getBoundingClientRect(); return { x: r.left + 200 * d.u + 175 * d.u * Math.sin(Math.PI / 3), y: r.top + 200 * d.u - 175 * d.u * Math.cos(Math.PI / 3) }; });
await page.mouse.click(bezelTap.x, bezelTap.y);
const bezelEv = await lastOf('keyTap');
const litAfterTap = await lit();
const bubble = !!(await page.$('#main-dial .tl-cf-bubble'));
const blanksBefore = await countOf('blankTap');
await page.mouse.click(centre.x - centre.w / 2 + 6, centre.y + centre.w / 2 - 6);
const litAfterBlank = await lit();
const blanks = (await countOf('blankTap')) - blanksBefore;
await page.mouse.click(bezelTap.x, bezelTap.y);
await page.waitForTimeout(2300);
console.log(`hub tap -> ${hubEv && hubEv.key}; bezel tap at 2 o'clock -> ${bezelEv && bezelEv.key}; lit after tap ${litAfterTap} (bubble ${bubble}); after a tap in the corner ${litAfterBlank} (blankTap ${blanks}); after 2.3 s ${await lit()}`);

// Bubbles stay inside the case, for every key.
const outside = [];
for (const l of lines) {
  await page.mouse.click(l.x, l.y);
  const ok = await page.$eval('#main-dial', (h) => { const b = h.querySelector('.tl-cf-bubble').getBoundingClientRect(), c = h.querySelector('.tl-cf-case').getBoundingClientRect(); return b.left >= c.left - .5 && b.right <= c.right + .5 && b.top >= c.top - .5 && b.bottom <= c.bottom + .5; });
  if (!ok) outside.push(l.key);
}
console.log(`bubbles reaching outside the case: ${outside.length}${outside.length ? ' (' + outside.join(' ') + ')' : ''}`);

// Every key on the dial: the hub draws as many accidentals as it has.
const sig = await page.evaluate(async () => {
  const bad = [];
  let n = 0;
  for (const clef of ['treble', 'bass', 'alto', 'tenor']) {
    window.tlMain.clef(clef);
    for (const id of Object.keys(window.tlMain.keys)) {
      const k = window.tlMain.keys[id];
      if (!window.tlMain.onDial(k)) continue;
      window.tlMain.show(id);
      n++;
      const drawn = window.tlMain.hub.querySelectorAll('.abcjs-key-signature path').length;
      if (drawn !== k.n) bad.push(`${clef} ${id} ${drawn}/${k.n}`);
      // The stave's corners stay inside the hub's circle.
      const s = window.tlMain.hub.querySelector('.tl-cf-stave svg').getBoundingClientRect(), h = window.tlMain.hub.getBoundingClientRect();
      const cx = h.left + h.width / 2, cy = h.top + h.height / 2, r = h.width / 2;
      const far = Math.max(...[[s.left, s.top], [s.right, s.top], [s.left, s.bottom], [s.right, s.bottom]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      if (far > r) bad.push(`${clef} ${id} stave reaches ${far.toFixed(0)} of ${r.toFixed(0)}`);
    }
  }
  window.tlMain.clef('treble');
  const h = window.tlMain.hub.querySelector('.tl-cf-stave svg').getBoundingClientRect();
  return { n, bad, size: `${Math.round(h.width)}x${Math.round(h.height)}`, hub: Math.round(window.tlMain.hub.getBoundingClientRect().width) };
});
console.log(`signatures checked ${sig.n}, wrong ${sig.bad.length}${sig.bad.length ? ': ' + sig.bad.slice(0, 6).join('; ') : ''}; stave ${sig.size} in a hub ${sig.hub} wide`);

// Turn a key to the top and tap the top name; then the bottom-right one.
const topTap = async (cmd, want) => {
  await page.click(`[data-cmd="${cmd}"]`);
  await toDial();
  await page.waitForTimeout(1100);
  const at = await page.evaluate(() => { const d = window.tlMain, r = d.dial.getBoundingClientRect(); return { x: r.left + 200 * d.u, y: r.top + (200 - 144) * d.u }; });
  await page.mouse.click(at.x, at.y);
  const ev = await lastOf('keyTap');
  return `${want} at the top -> ${ev && ev.key}`;
};
const turned = [await topTap('rotateG', 'G')];
const upright = await page.$eval('#main-dial .tl-cf-line[data-key="G"]', (l) => { const r = l.getBoundingClientRect(); return r.height < r.width * 1.5; });
turned.push(await topTap('rotateC', 'C'));
console.log(`after turning: ${turned.join('; ')}; names upright ${upright}`);

// Labels never overlap one another.
const overlaps = await page.$eval('#main-dial', (h) => {
  const boxes = [...h.querySelectorAll('.tl-cf-key, .tl-cf-count')].map((e) => ({ id: (e.dataset.ring || 'count') + (e.dataset.pos || e.style.left), r: e.getBoundingClientRect() })).filter((b) => b.r.width > 0);
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].r, b = boxes[j].r;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${boxes[i].id}~${boxes[j].id}`);
  }
  return out;
});
console.log(`overlapping labels ${overlaps.length}${overlaps.length ? ': ' + overlaps.slice(0, 8).join(' ') : ''}`);

// Every command.
for (const cmd of ['walkSharp', 'stop', 'walkFlat', 'stop', 'select', 'pair', 'sides', 'maskMinor', 'revealMinor', 'quiz', 'revealAll', 'label', 'spot', 'rotateG', 'rotateC', 'clef', 'clef', 'clef', 'clef', 'play', 'stop', 'clear']) {
  await page.click(`[data-cmd="${cmd}"]`);
  await page.waitForTimeout(cmd.startsWith('walk') ? 3500 : cmd === 'play' ? 2400 : 250);
  if (cmd === 'quiz') {
    const q = await page.$eval('#main-dial', (h) => ({ masked: h.querySelectorAll('.tl-cf-q').length, acc: h.querySelectorAll('.tl-cf-hub .abcjs-key-signature path').length, text: h.querySelector('.tl-cf-hubtext').textContent }));
    console.log(`quiz: ${q.masked} hidden names and counts, hub shows ${q.acc} accidentals, hub text "${q.text}"`);
  }
}
const steps = await page.evaluate(() => window.tlEvents.filter((e) => e.type === 'walkStep').map((e) => e.key + (e.added ? '+' + e.added : '')).join(' '));
console.log('walk steps', steps);

// The small dial: seven sharps and flats, three paired positions at the bottom.
const mini = await page.$eval('#mini-dial', (h) => ({ pairs: h.querySelectorAll('.tl-cf-key.tl-cf-pair').length, counts: [...h.querySelectorAll('.tl-cf-count')].map((c) => c.textContent.trim()).filter((t) => t.includes('/')).join(' | '), w: Math.round(h.querySelector('.tl-cf-dial').getBoundingClientRect().width) }));
console.log(`small dial ${mini.w} wide: paired positions ${mini.pairs}, paired counts ${mini.counts}`);

const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
console.log(`page width ${scroll.sw} for a ${scroll.iw} wide window; sound ${await page.evaluate(() => SoundSource.status().phase)}`);
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
