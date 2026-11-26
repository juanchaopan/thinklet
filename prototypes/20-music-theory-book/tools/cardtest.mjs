// Checks the fact card prototype the way a child and a workflow would use
// it: on every card of the deck taps every row at its middle and near its
// top and bottom edges, the head and the margin under the last row; checks
// lights fade and blank taps clear; that bubbles stay inside the card and
// badges, claims and verdicts cover no text; that masks survive a change of
// card; that practice taps do nothing; that the stacked strips line up; that
// rows sound and a playback stops; and that the page does not scroll
// sideways.
// Usage: node cardtest.mjs <fragment.html> [width]
import { openPage } from './serve.mjs';

const [, , file, width = '390'] = process.argv;
const { page, errors, close, loading } = await openPage(file, width);
if (loading) console.log(`loading screen: ${loading.note}, bar ${loading.bar}`);

const lastOf = (type) => page.evaluate((t) => window.tlEvents.filter((e) => e.type === t).pop() || null, type);
const countOf = (type) => page.evaluate((t) => window.tlEvents.filter((e) => e.type === t).length, type);
const toCard = () => page.$eval('#main-card', (e) => e.scrollIntoView({ block: 'center' }));
const turnTo = async (id) => { await page.evaluate((i) => window.tlMain.show(i), id); await page.waitForTimeout(800); await toCard(); };
const lit = () => page.$$eval('#main-card .tl-fc-row.tl-lit, #main-card .tl-fc-head.tl-lit', (r) => r.length);

let taps = 0, hits = 0;
const missed = [];
for (const id of ['con-dolore', 'upper-mordent', 'oboe', 'clarinet']) {
  await turnTo(id);
  const pts = await page.$$eval('#main-card .tl-fc-row', (rows) => rows.flatMap((r) => {
    const b = r.getBoundingClientRect();
    return [['mid', b.top + b.height / 2], ['top', b.top + 3], ['bottom', b.bottom - 3]].map(([w, y]) => ({ field: r.dataset.field, where: w, x: b.left + b.width * .7, y }));
  }));
  for (const p of pts) {
    await page.mouse.click(p.x, p.y);
    const ev = await lastOf('rowTap');
    taps++;
    if (ev && ev.field === p.field && ev.entry === id) hits++; else missed.push(`${id}.${p.field}.${p.where}->${ev && ev.field}`);
  }
  const head = await page.$eval('#main-card .tl-fc-word', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.click(head.x, head.y);
  const h = await lastOf('headTap');
  taps++;
  if (h && h.entry === id) hits++; else missed.push(`${id}.head`);
}
console.log(`width ${width}: taps ${taps}, hit ${hits}${missed.length ? ', missed ' + missed.join(' ') : ''}`);

// Blank margin, fade, bubbles.
await turnTo('con-dolore');
const first = await page.$eval('#main-card .tl-fc-row', (r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
await page.mouse.click(first.x, first.y);
const litTap = await lit();
const bubbleIn = await page.$eval('#main-card', (h) => { const b = h.querySelector('.tl-fc-bubble'), c = h.querySelector('.tl-fc-card').getBoundingClientRect(); if (!b) return 'none'; const r = b.getBoundingClientRect(); return r.left >= c.left - .5 && r.right <= c.right + .5 && r.top >= c.top - .5 && r.bottom <= c.bottom + .5; });
const blank = await page.$eval('#main-card .tl-fc-card', (c) => { const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.bottom - 6 }; });
const blanks0 = await countOf('blankTap');
await page.mouse.click(blank.x, blank.y);
const litBlank = await lit();
const blanks = (await countOf('blankTap')) - blanks0;
await page.mouse.click(first.x, first.y);
await page.waitForTimeout(2300);
console.log(`tap lights ${litTap} (bubble inside the card: ${bubbleIn}); tap in the bottom margin -> blankTap ${blanks}, lit ${litBlank}; 2.3 s after a tap lit ${await lit()}`);

// Every command on every card; marks must not cover text.
const overlaps = [];
for (const id of ['con-dolore', 'upper-mordent', 'oboe', 'clarinet']) {
  await turnTo(id);
  await page.evaluate(() => {
    const m = window.tlMain, f = m.rowsShown().map((r) => r.field);
    m.highlight([f[0]]); m.spotlight([f[0], f[1]]); m.label({ [f[0]]: 'A', [f[1]]: 'B' });
    m.check(f[0], 'a claim that is fairly long', false); m.check(f[1], 'right', true);
    if (m.strips.range) m.fit('range', 'G3', 'C5');
    m.caption(f[f.length - 1], 'a caption under the last row');
  });
  await page.waitForTimeout(600);
  const o = await page.$eval('#main-card', (h) => {
    const boxes = [...h.querySelectorAll('.tl-fc-badge, .tl-fc-ltext, .tl-fc-text, .tl-fc-claim, .tl-fc-verdict, .tl-fc-staff svg, .tl-fc-name')].map((e) => ({ c: e.className.baseVal ?? e.className, r: e.getBoundingClientRect() })).filter((b) => b.r.width > 0);
    const out = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      if (boxes[i].c === 'tl-fc-text' && boxes[j].c === 'tl-fc-text') continue;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${boxes[i].c}~${boxes[j].c}`);
    }
    const c = h.querySelector('.tl-fc-card').getBoundingClientRect(), bub = h.querySelector('.tl-fc-bubble');
    if (bub) { const r = bub.getBoundingClientRect(); if (r.left < c.left - .5 || r.right > c.right + .5 || r.top < c.top - .5 || r.bottom > c.bottom + .5) out.push('bubble outside'); }
    return out;
  });
  if (o.length) overlaps.push(`${id}: ${o.join(' ')}`);
  await page.evaluate(() => window.tlMain.clear());
}
console.log(`marks covering text or leaving the card: ${overlaps.length ? overlaps.join('; ') : 0}`);

// Masks survive a change of card; reveal uncovers.
await page.evaluate(() => window.tlMain.mask(['head', 'meaning']));
await turnTo('upper-mordent');
const masked = await page.$$eval('#main-card .tl-fc-slip', (s) => s.length);
const headEv = await (async () => { const b = await page.$eval('#main-card .tl-fc-word', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }); await page.mouse.click(b.x, b.y); return lastOf('headTap'); })();
await page.evaluate(() => window.tlMain.reveal());
await page.waitForTimeout(700);
console.log(`after turning to the ornament card: slips ${masked} (head and meaning), head tap reports hidden ${headEv.hidden} and name ${headEv.head}; after reveal slips ${await page.$$eval('#main-card .tl-fc-slip', (s) => s.length)}`);

// Sound: a tapped stave plays its notes played out; play stops.
await page.evaluate(() => { window.__notes = []; const p = SoundSource.play; SoundSource.play = function (m, d, dur) { window.__notes.push([m, +(d || 0).toFixed(3), +dur.toFixed(3)]); return p.apply(this, arguments); }; });
const sign = await page.$eval('#main-card .tl-fc-row[data-field="sign"]', (r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width * .7, y: b.top + b.height / 2 }; });
await page.mouse.click(sign.x, sign.y);
const signNotes = await page.evaluate(() => window.__notes.splice(0));
const played = await page.$eval('#main-card .tl-fc-row[data-field="played"]', (r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width * .7, y: b.top + b.height / 2 }; });
await page.waitForTimeout(800);
await page.mouse.click(played.x, played.y);
const playedNotes = await page.evaluate(() => window.__notes.splice(0));
console.log(`sign sounds ${JSON.stringify(signNotes)}; written-out sounds ${JSON.stringify(playedNotes)}`);
await turnTo('oboe');
const range = await page.$eval('#main-card .tl-fc-row[data-field="range"]', (r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
await page.mouse.click(range.x, range.y);
console.log(`range row sounds ${JSON.stringify(await page.evaluate(() => window.__notes.splice(0)))}`);

// Practice: taps do nothing.
await page.click('#mode');
await page.waitForTimeout(300);
await toCard();
const before = await countOf('rowTap');
const pr = await page.$eval('#main-card .tl-fc-row', (r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
await page.mouse.click(pr.x, pr.y);
console.log(`practice: rowTap ${(await countOf('rowTap')) - before}, lit ${await lit()}, notes ${(await page.evaluate(() => window.__notes.length))}, play button ${!!(await page.$('#main-card .tl-fc-play'))}`);
await page.click('#mode');
await page.waitForTimeout(300);

// Stacked strips line up: every C tick at the same x on the four cards.
const align = await page.$$eval('#compare .tl-fc-range', (ws) => {
  const xs = ws.map((w) => [...w.querySelectorAll('.tl-fc-tick')].map((t) => { const b = t.getBoundingClientRect(); return b.left + b.width / 2; }));
  let worst = 0; xs.forEach((row) => row.forEach((x, i) => { worst = Math.max(worst, Math.abs(x - xs[0][i])); }));
  return { cards: ws.length, worst: worst.toFixed(2), verdicts: [...document.querySelectorAll('#compare .tl-fc-verdict')].map((v) => v.textContent.trim()) };
});
console.log(`stacked strips ${align.cards}, C ticks out of line by at most ${align.worst} px; ${align.verdicts.join(' | ')}`);

// The pop-up.
await page.click('[data-term="dolce"]');
await page.waitForTimeout(600);
const pop = await page.$eval('#pop-card', (h) => ({ head: h.querySelector('.tl-fc-word').textContent, lit: h.querySelectorAll('.tl-fc-row.tl-lit').length, w: Math.round(h.getBoundingClientRect().width) }));
await page.click('[data-term="sotto-voce"]', { force: true }).catch(() => {});
await page.click('#sheet-close');
console.log(`pop-up card "${pop.head}" ${pop.w} wide, lit rows ${pop.lit}`);

const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
console.log(`page width ${scroll.sw} for a ${scroll.iw} wide window; sound ${await page.evaluate(() => SoundSource.status().phase)}`);
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
