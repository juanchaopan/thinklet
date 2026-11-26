// Checks the conclusion stack prototype the way a child and a workflow
// would use it: pushes every act, taps every slip at its middle and near
// its edges, the pile and the blank margins; checks that lights fade and
// blank taps clear; that slips, numbers and bubbles cover no text and stay
// inside the stack; that the thread ends at its sources; that stepping back
// restores an act with nothing moving and masks survive; that practice taps
// do nothing; that a slip with a stave sounds and stop silences it; and
// that the page does not scroll sideways. Every tap first scrolls the stack
// into view, so a tap never lands off screen. How smooth a push moves is
// checked separately (probe/csmotion.mjs).
// Usage: node stacktest.mjs <fragment.html> [width]
import { openPage } from './serve.mjs';

const [, , file, width = '390'] = process.argv;
const { page, errors, close, loading } = await openPage(file, width);
if (loading) console.log(`loading screen: ${loading.note}, bar ${loading.bar}`);

const lastOf = (type) => page.evaluate((t) => window.tlEvents.filter((e) => e.type === t).pop() || null, type);
const countOf = (type) => page.evaluate((t) => window.tlEvents.filter((e) => e.type === t).length, type);
const toStack = (sel = '#main-stack') => page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
const lit = () => page.$$eval('#main-stack .tl-cs-slip.tl-lit', (r) => r.length);
const settle = (ms = 2900) => page.waitForTimeout(ms);
const centreOf = async (sel) => { await toStack(); return page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width * .5, y: b.top + b.height / 2 }; }); };

// Overlaps between texts, staves, numbers, the pile label and bubbles, and
// anything leaving the stack.
const overlaps = () => page.$eval('#main-stack', (h) => {
  const box = h.getBoundingClientRect();
  const parts = [...h.querySelectorAll('.tl-cs-body > .tl-cs-text, .tl-cs-body > .tl-cs-staff svg, .tl-cs-body > .tl-cs-op, .tl-cs-num, .tl-cs-seal, .tl-cs-more, .tl-cs-bubble')]
    .map((e) => ({ c: (e.className.baseVal ?? e.className).split(' ')[0] || e.tagName, id: e.closest('.tl-cs-slip')?.dataset.id || '-', r: e.getBoundingClientRect() }))
    .filter((b) => b.r.width > 0);
  const out = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i].r, b = parts[j].r;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${parts[i].id}.${parts[i].c}~${parts[j].id}.${parts[j].c}`);
  }
  [...h.querySelectorAll('.tl-cs-slip, .tl-cs-bubble')].forEach((e) => { const r = e.getBoundingClientRect(); if (r.left < box.left - .5 || r.right > box.right + .5 || r.bottom > box.bottom + .5) out.push(`${e.dataset.id || 'bubble'} outside`); });
  return out;
});

// Push the five acts, checking each settles cleanly.
await toStack();
for (let i = 1; i <= 5; i++) {
  await page.click('[data-cmd="next"]');
  await settle();
  await toStack();
  const o = await overlaps();
  const st = await page.$eval('#main-stack', (h) => ({ slips: h.querySelectorAll('.tl-cs-slip').length, folded: (h.querySelector('.tl-cs-more')?.textContent || '').trim(), height: Math.round(h.getBoundingClientRect().height) }));
  console.log(`act ${i}: slips ${st.slips}, pile "${st.folded}", stack ${st.height} px high${o.length ? ', OVERLAPS ' + o.join(' ') : ''}`);
}

// Thread: one dot per visible source (or the pile), the tip at the newest slip.
const thread = await page.$eval('#main-stack', (h) => {
  const dots = [...h.querySelectorAll('.tl-cs-thread circle')].map((c) => c.getBoundingClientRect()).map((r) => r.top + r.height / 2);
  const targets = [...h.querySelectorAll('.tl-cs-pile, .tl-cs-slip')].map((e) => ({ id: e.dataset.id || 'pile', r: e.getBoundingClientRect() }));
  const hit = dots.map((y) => (targets.find((t) => y >= t.r.top && y <= t.r.bottom) || {}).id);
  const tip = h.querySelector('.tl-cs-thread path:last-child').getBoundingClientRect();
  const fresh = h.querySelector('.tl-cs-fresh').getBoundingClientRect();
  return { dots: hit, tipInFresh: tip.top >= fresh.top && tip.bottom <= fresh.bottom, tipGap: Math.round(fresh.left - tip.right) };
});
console.log(`thread dots on ${thread.dots.join(', ')}; tip inside the answer's height ${thread.tipInFresh}, ${thread.tipGap} px from its edge`);

// Taps on every slip at its middle and just inside its visible top and
// bottom (the next slip lies over the last 3 px).
let taps = 0, hits = 0;
const missed = [];
await toStack();
const pts = await page.$$eval('#main-stack .tl-cs-slip', (s) => s.flatMap((e) => { const b = e.getBoundingClientRect(); return [['mid', b.top + b.height / 2], ['top', b.top + 4], ['bottom', b.bottom - 6]].map(([w, y]) => ({ id: e.dataset.id, w, x: b.left + b.width * .6, y })); }));
for (const p of pts) {
  await page.mouse.click(p.x, p.y);
  const ev = await lastOf('itemTap');
  taps++;
  if (ev && ev.id === p.id) hits++; else missed.push(`${p.id}.${p.w}->${ev && ev.id}`);
}
console.log(`taps ${taps}, hit ${hits}${missed.length ? ', missed ' + missed.join(' ') : ''}`);
const ansTap = await lastOf('itemTap');

// Blank: the clip's side and the margin under the newest slip.
const blanks0 = await countOf('blankTap');
await toStack();
const blankPts = await page.$eval('#main-stack', (h) => { const b = h.getBoundingClientRect(); const f = h.querySelector('.tl-cs-fresh').getBoundingClientRect(); return [{ x: b.left + 12, y: b.top + 4 }, { x: b.left + b.width / 2, y: f.bottom + 12 }]; });
for (const p of blankPts) await page.mouse.click(p.x, p.y);
console.log(`blank taps registered ${(await countOf('blankTap')) - blanks0} of 2; lit after ${await lit()}`);

// Tap lights fade.
const mid = pts.find((p) => p.w === 'mid');
await page.mouse.click(mid.x, mid.y);
const litNow = await lit();
await page.waitForTimeout(2300);
console.log(`a tap lights ${litNow}; 2.3 s later lit ${await lit()}; the masked answer reported hidden ${ansTap && ansTap.hidden} with text ${ansTap && ansTap.text}`);

// Pile: open, everything shown without overlaps; a blank tap folds it back.
await toStack();
const pile = await page.$('#main-stack .tl-cs-pile');
if (pile) {
  const pb = await pile.boundingBox();
  await page.mouse.click(pb.x + pb.width - 20, pb.y + pb.height / 2);
  await page.waitForTimeout(900);
  const opened = await lastOf('pileTap');
  const shown = await page.$$eval('#main-stack .tl-cs-slip', (s) => s.length);
  const o = await overlaps();
  await toStack();
  const f = await page.$eval('#main-stack', (h) => { const r = h.querySelector('.tl-cs-fresh').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 12 }; });
  await page.mouse.click(f.x, f.y);
  await page.waitForTimeout(900);
  console.log(`pile tap -> open ${opened.open}, slips ${shown}${o.length ? ', OVERLAPS ' + o.join(' ') : ''}; after a blank tap slips ${await page.$$eval('#main-stack .tl-cs-slip', (s) => s.length)}`);
}

// Highlight brings a folded conclusion out; caption sits under the newest
// and the stack grows to hold it.
await page.click('[data-cmd="recall"]');
await page.waitForTimeout(900);
const recalled = await page.$$eval('#main-stack .tl-cs-slip.tl-lit', (s) => s.map((e) => e.dataset.id));
await page.click('[data-cmd="revealAnswer"]');
await page.click('[data-cmd="caption"]');
await page.waitForTimeout(900);
await toStack();
const capO = await overlaps();
console.log(`highlight k1 -> lit ${recalled.join(',')}; caption under the answer${capO.length ? ', OVERLAPS ' + capO.join(' ') : ' covers nothing and stays inside'}`);

// Stepping back restores an act with nothing moving; a masked conclusion stays masked.
await page.evaluate(() => window.tlMain.mask('k2'));
await page.click('[data-cmd="back"]');
await page.waitForTimeout(100);
const back = await page.$eval('#main-stack', (h) => ({ ids: [...h.querySelectorAll('.tl-cs-slip')].map((e) => e.dataset.id), moving: h.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length, draws: h.querySelectorAll('.tl-cs-draw').length, covers: h.querySelectorAll('.tl-cs-cover').length }));
console.log(`back one act -> slips ${back.ids.join(',')}, animations running ${back.moving}, threads drawing ${back.draws}, covers ${back.covers}`);
await page.evaluate(() => window.tlMain.reveal());

// Sound: a slip with a stave sounds its notes; stop silences them.
await page.evaluate(() => { window.__notes = []; const p = SoundSource.play; SoundSource.play = function (m, d, dur) { window.__notes.push([m, +(d || 0).toFixed(3), +dur.toFixed(3)]); return p.apply(this, arguments); }; });
const k4 = await centreOf('#main-stack .tl-cs-slip[data-id="k4"]');
await page.mouse.click(k4.x, k4.y);
const notes = await page.evaluate(() => window.__notes.splice(0));
await page.waitForTimeout(150);
const during = await page.evaluate(() => SoundSource.status().voices);
await page.evaluate(() => window.tlMain.stop());
await page.waitForTimeout(120);
console.log(`k4 sounds ${JSON.stringify(notes)}; voices ${during} while sounding, ${await page.evaluate(() => SoundSource.status().voices)} after stop`);

// Run demo: the interval chord sounds together.
await page.evaluate(() => window.tlRun.set(['i1', 'i2', 'i3', 'ia']));
await toStack('#run-stack');
const ia = await page.$eval('#run-stack .tl-cs-slip[data-id="ia"]', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width * .5, y: b.top + b.height / 2 }; });
await page.mouse.click(ia.x, ia.y);
console.log(`answer slip [_EG] sounds ${JSON.stringify(await page.evaluate(() => window.__notes.splice(0)))}`);

// Practice: taps do nothing.
await page.click('#mode');
await page.waitForTimeout(300);
const before = await countOf('itemTap'), litBefore = await lit();
const pr = await centreOf('#main-stack .tl-cs-slip');
await page.mouse.click(pr.x, pr.y);
console.log(`practice: itemTap ${(await countOf('itemTap')) - before}, lit ${litBefore} -> ${await lit()}, notes ${(await page.evaluate(() => window.__notes.length))}, slips kept ${await page.$$eval('#main-stack .tl-cs-slip', (s) => s.length)}`);
await page.click('#mode');
await page.waitForTimeout(300);

// After two rebuilds a tap still raises exactly one event.
const n0 = await countOf('blankTap');
await toStack();
const corner = await page.$eval('#main-stack', (h) => { const r = h.getBoundingClientRect(); return { x: r.left + 8, y: r.top + 4 }; });
await page.mouse.click(corner.x, corner.y);
const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
console.log(`one blank tap after two rebuilds -> ${(await countOf('blankTap')) - n0} event; page width ${scroll.sw} for a ${scroll.iw} wide window`);
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
