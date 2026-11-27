// Checks the choice prototype the way a child and a workflow would use
// it: taps every option at its middle and near its edges and in the gaps
// between options; checks that one pick moves the tick, a second tap
// takes it away, a ruled-out option cannot be ticked and a locked choice
// changes nothing; steps each box under the score through tick, cross
// and empty, and checks each box stands under its bar; checks that tiles
// in a choice are one size, staves stay inside their tiles, bubbles cover
// no option and nothing leaves the choice; that set() draws a state with
// nothing moving, now or a moment later; that a snippet option sounds in
// a lecture and not in practice, and stop silences it; that one tap
// after a rebuild raises one event; and that the page does not scroll
// sideways. Every tap first scrolls its target into view, so a tap never
// lands off screen.
// Usage: node choicetest.mjs <fragment.html> [width]
import { openPage } from './serve.mjs';

const [, , file, width = '390'] = process.argv;
const { page, errors, close } = await openPage(file, width);

const events = (from, type) => page.evaluate(([f, t]) => window.tlEvents.filter((e) => e.from === f && e.type === t), [from, type]);
const last = async (from, type) => (await events(from, type)).pop() || null;
const count = async (from, type) => (await events(from, type)).length;
const state = (name) => page.evaluate((n) => { const c = window.tlChoices[n]; return { selected: c.selected.slice(), values: c.values.slice(), cols: c.cols }; }, name);
const inView = (sel) => page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
const tapAt = async (sel, fx, fy) => { await inView(sel); const b = await page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }); await page.mouse.click(b.x + b.w * fx, b.y + b.h * fy); };
const opt = (host, id) => `${host} .tl-ch-opt[data-id="${id}"]`;
const say = (s) => console.log(s);

// Layout of every choice: one size per choice, staves inside, nothing outside.
const layout = () => page.$$eval('.tl-ch', (hosts) => hosts.map((h) => {
  const box = h.getBoundingClientRect(), out = [];
  const tiles = [...h.querySelectorAll('.tl-ch-opt')].map((t) => t.getBoundingClientRect());
  const sizes = new Set(tiles.map((r) => Math.round(r.width) + 'x' + Math.round(r.height)));
  h.querySelectorAll('.tl-ch-opt').forEach((t) => {
    const r = t.getBoundingClientRect();
    t.querySelectorAll('.tl-ch-staff svg, .tl-ch-text, .tl-ch-term, .tl-ch-box').forEach((p) => { const q = p.getBoundingClientRect(); if (q.left < r.left - .5 || q.right > r.right + .5 || q.top < r.top - .5 || q.bottom > r.bottom + .5) out.push(`${t.dataset.id}: ${p.className.baseVal ?? p.className} leaves its tile`); });
  });
  h.querySelectorAll('.tl-ch-opt, .tl-ch-mark, .tl-ch-bubble, .tl-ch-stem').forEach((e) => { const r = e.getBoundingClientRect(); if (r.left < box.left - 10 || r.right > box.right + 10 || r.bottom > box.bottom + 1) out.push(`${e.dataset.id || e.dataset.index || e.className} leaves the choice`); });
  const bub = h.querySelector('.tl-ch-bubble');
  if (bub) { const b = bub.getBoundingClientRect(); h.querySelectorAll('.tl-ch-opt, .tl-ch-mark').forEach((t) => { const r = t.getBoundingClientRect(); if (b.left < r.right && r.left < b.right && b.top < r.bottom && r.top < b.bottom) out.push(`bubble covers ${t.dataset.id || t.dataset.index}`); }); }
  return { id: h.id, cols: getComputedStyle(h.querySelector('.tl-ch-opts') || h).getPropertyValue('--cols').trim() || '-', sizes: [...sizes], out };
}));
for (const l of await layout()) say(`${l.id}: ${l.cols} per row, tile sizes ${l.sizes.join(' ') || '-'}${l.out.length ? ', PROBLEMS ' + l.out.join('; ') : ''}`);

// Taps on every option of the main choice at its middle and just inside
// its edges, and in the gap under it.
let taps = 0, hits = 0; const missed = [];
for (const id of ['aug5', 'min6', 'maj6', 'maj7']) {
  for (const [w, fx, fy] of [['mid', .5, .5], ['top', .5, .06], ['bottom', .5, .94], ['left', .03, .5], ['right', .97, .5]]) {
    await tapAt(opt('#main-choice', id), fx, fy);
    const ev = await last('main', 'optionTap'); taps++;
    if (ev && ev.id === id) hits++; else missed.push(`${id}.${w}->${ev && ev.id}`);
  }
}
say(`main: taps ${taps}, hit ${hits}${missed.length ? ', missed ' + missed.join(' ') : ''}`);
const gap = await page.$eval(opt('#main-choice', 'min6'), (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 4 }; });
await page.mouse.click(gap.x, gap.y);
say(`a tap 4 px under minor 6th (in the gap) -> ${(await last('main', 'optionTap')).id}`);

// One pick: ticking another moves the tick; a second tap takes it away.
await page.evaluate(() => window.tlChoices.main.clear());
await tapAt(opt('#main-choice', 'min6'), .5, .5);
await tapAt(opt('#main-choice', 'maj6'), .5, .5);
const moved = await state('main');
await tapAt(opt('#main-choice', 'maj6'), .5, .5);
const removed = await state('main');
await page.waitForTimeout(300);
const ink = await page.$$eval('#main-choice .tl-ch-box', (b) => b.map((x) => x.querySelectorAll('svg path').length));
say(`pick min6 then maj6 -> selected ${JSON.stringify(moved.selected)}; tap maj6 again -> ${JSON.stringify(removed.selected)}; ink strokes left once fades end ${ink.join(',')}`);

// Blank: the stem.
const b0 = await count('main', 'blankTap');
await tapAt('#main-choice .tl-ch-stem', .5, .5);
say(`a tap on the stem -> blankTap ${(await count('main', 'blankTap')) - b0}`);

// Struck options cannot be ticked; select() skips them; locked changes nothing.
await page.click('[data-cmd="strike"]');
await tapAt(opt('#main-choice', 'aug5'), .5, .5);
const struckTap = await last('main', 'optionTap');
await page.evaluate(() => window.tlChoices.main.select(['maj7']));
say(`tap a ruled-out option -> struck ${struckTap.struck}, selected ${JSON.stringify(struckTap.selected)}; select(ruled out) -> ${JSON.stringify((await state('main')).selected)}`);
await page.evaluate(() => window.tlChoices.main.select(['maj6']));
await page.click('[data-cmd="check"]');
const n0 = await count('main', 'optionTap');
await tapAt(opt('#main-choice', 'min6'), .5, .5);
say(`locked: a tap raises ${(await count('main', 'optionTap')) - n0} events, selected ${JSON.stringify((await state('main')).selected)}; verdict seals ${await page.$$eval('#main-choice .tl-ch-seal', (s) => s.map((x) => x.closest('.tl-ch-opt').dataset.id + ':' + x.className.split(' ')[1]).join(','))}`);

// Caption: room opens under the row, nothing covered.
await page.click('[data-cmd="caption"]');
await page.waitForTimeout(1000);
const cap = (await layout()).find((l) => l.id === 'main-choice');
say(`caption under minor 6th${cap.out.length ? ', PROBLEMS ' + cap.out.join('; ') : ' covers nothing and stays inside'}`);
await page.click('[data-cmd="uncaption"]');
await page.waitForTimeout(900);
say(`caption taken away -> rooms left ${await page.$$eval('#main-choice .tl-ch-room', (r) => r.length)}`);

// set(): the end of an act with nothing moving, now and a moment later.
const moving = () => page.$eval('#main-choice', (h) => h.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length);
await page.click('[data-cmd="set"]');
await page.waitForTimeout(60);
const now = await moving();
await page.waitForTimeout(200);
const st = await page.$eval('#main-choice', (h) => ({ out: [...h.querySelectorAll('.tl-ch-out')].map((e) => e.dataset.id).join(','), right: [...h.querySelectorAll('.tl-ch-right')].map((e) => e.dataset.id).join(','), on: [...h.querySelectorAll('.tl-ch-on')].map((e) => e.dataset.id).join(','), badges: h.querySelectorAll('.tl-ch-badge').length }));
say(`set -> animations running ${now} at once, ${await moving()} 0.26 s later; ruled out ${st.out}, ticked ${st.on}, right ${st.right}, badges ${st.badges}`);

// Keyboard: arrows move, space ticks.
await page.click('[data-cmd="clear"]');
await page.focus(opt('#main-choice', 'aug5'));
await page.keyboard.press('ArrowDown'); await page.keyboard.press(' ');
say(`keyboard: ArrowDown then space -> selected ${JSON.stringify((await state('main')).selected)} (${(await state('main')).cols} per row)`);

// Boxes under the score: steps, places.
await page.evaluate(() => window.tlChoices.marks.clear());
const seq = [];
for (let k = 0; k < 4; k++) { await tapAt('#g-marks .tl-ch-mark[data-index="1"]', .5, .5); seq.push((await last('marks', 'boxTap')).value); }
const near = await page.$eval('#g-marks .tl-ch-mark[data-index="2"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2 + 26, y: r.top + r.height / 2 }; });
await page.mouse.click(near.x, near.y);
const nearEv = await last('marks', 'boxTap');
const align = await page.evaluate(() => {
  const want = [...Array(4).keys()].map((m) => { const ns = [...document.querySelectorAll('#marks-score .abcjs-note.abcjs-m' + m)].map((n) => n.getBoundingClientRect()); return (Math.min(...ns.map((r) => r.left)) + Math.max(...ns.map((r) => r.right))) / 2; });
  const got = [...document.querySelectorAll('#g-marks .tl-ch-mark')].map((m) => { const r = m.getBoundingClientRect(); return r.left + r.width / 2; });
  return got.map((g, i) => Math.round(g - want[i]));
});
say(`box 2 taps -> ${seq.map(String).join(' > ')}; a tap 26 px right of box 3 -> box ${nearEv.index + 1}; boxes off their bar centres by ${align.join(', ')} px`);

// Sound: snippet option in a lecture sounds; stop silences; practice is silent.
await page.evaluate(() => { window.__notes = []; const p = SoundSource.play; SoundSource.play = function (m, d, dur) { window.__notes.push([m, +(d || 0).toFixed(3), +dur.toFixed(3)]); return p.apply(this, arguments); }; });
await tapAt(opt('#g-snip', 'd5'), .5, .3);
const notes = await page.evaluate(() => window.__notes.splice(0));
await page.waitForTimeout(150);
const during = await page.evaluate(() => SoundSource.status().voices);
await page.evaluate(() => window.tlChoices.snip.stop());
await page.waitForTimeout(120);
say(`lecture snippet E–B♭ sounds ${JSON.stringify(notes)}; voices ${during} while sounding, ${await page.evaluate(() => SoundSource.status().voices)} after stop`);
await page.evaluate(() => { window.tlChoices.snip.o.mode = 'practice'; window.tlChoices.snip.build(); });
const kept = (await state('snip')).selected;
await tapAt(opt('#g-snip', 'p5'), .5, .3);
say(`after a rebuild the pick is kept ${JSON.stringify(kept)}; practice tap on a snippet: notes ${(await page.evaluate(() => window.__notes.splice(0))).length}, selected ${JSON.stringify((await state('snip')).selected)}`);

// One tap after a rebuild raises one event.
await page.evaluate(() => window.tlChoices.main.build());
const e0 = await count('main', 'optionTap');
await tapAt(opt('#main-choice', 'maj7'), .5, .5);
const pageW = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
say(`one tap after a rebuild -> ${(await count('main', 'optionTap')) - e0} event; page width ${pageW.sw} for a ${pageW.iw} wide window`);
if (errors.length) say('errors: ' + errors.join(' | '));
await close();
