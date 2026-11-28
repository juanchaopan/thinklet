// Checks the fill-in on its demo page at one width: layout of every look
// (boxes and keys inside the component, keys one size, boxes under the
// score not overlapping and how far they sit from their chords, seals and
// letters on a box's corners clear of every other box), taps on the
// middle and edges of every box and key and in the gaps between keys,
// writing with the keys (auto-advance, full boxes, delete, next), typing
// on a keyboard, lock and unlock, check seals, caption room, the type and
// stop commands, set drawing with nothing replayed, rebuild keeping what
// is written with one event per tap, and no horizontal page scroll.
// Usage: node filltest.mjs <width>
import { openPage } from './serve.mjs';

const width = process.argv[2] || '390';
const { page, errors, close } = await openPage('components/fill/demo.html', width, 900, 1);
const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const wait = (ms) => page.waitForTimeout(ms);
const events = () => page.evaluate(() => window.tlEvents.length);
const since = (n) => page.evaluate((n) => window.tlEvents.slice(n), n);
const rect = (sel) => page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
const into = async (sel) => { await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' })); await wait(80); };
const tapAt = async (x, y) => { await page.mouse.click(x, y); await wait(40); };
const F = (name, expr) => page.evaluate(([n, e]) => { const f = window.tlFills[n]; return eval(e); }, [name, expr]);

// Layout of every fill-in, with a letter and a seal on every box.
for (const name of ['main', 'meter', 'chord', 'count', 'run']) {
  const r = await page.evaluate((n) => {
    const f = window.tlFills[n], h = f.host.getBoundingClientRect();
    const fields = [...f.host.querySelectorAll('.tl-fi-field')];
    const boxes = fields.map((e) => e.getBoundingClientRect());
    const keys = [...f.host.querySelectorAll('.tl-fi-key')].map((e) => e.getBoundingClientRect());
    const inside = (b) => b.left >= h.left - 1 && b.right <= h.right + 1 && b.top >= h.top - 1 && b.bottom <= h.bottom + 1;
    const cross = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    let overlap = false;
    boxes.forEach((a, i) => boxes.forEach((b, j) => { if (i < j && cross(a, b)) overlap = true; }));
    const sizes = new Set(keys.map((k) => Math.round(k.width) + 'x' + Math.round(k.height)));
    const words = [...f.host.querySelectorAll('.tl-fi-text, .tl-fi-term')].map((e) => e.getBoundingClientRect());
    let onText = false;
    words.forEach((w) => boxes.forEach((b) => { if (cross(w, b)) onText = true; }));
    const labels = {}, checks = {};
    f.list.forEach((x, i) => { labels[x.id] = 'ABCD'[i]; checks[x.id] = i % 2 === 0; });
    f.set({ labels, checks });
    let corner = false;
    fields.forEach((e, i) => e.querySelectorAll('.tl-fi-seal, .tl-fi-badge').forEach((m) => {
      const mb = m.getBoundingClientRect();
      fields.forEach((o, j) => { if (j !== i && cross(mb, o.getBoundingClientRect())) corner = true; });
    }));
    f.set({});
    return { inside: boxes.concat(keys).every(inside), overlap, sizes: [...sizes], cols: f.cols, keyW: keys[0].width, onText, corner };
  }, name);
  ok(r.inside, `${name}: everything inside the component`);
  ok(!r.overlap, `${name}: boxes do not overlap`);
  ok(r.sizes.length === 1, `${name}: keys one size (${r.sizes})`);
  ok(r.keyW >= 44, `${name}: keys at least 44 wide`);
  ok(!r.onText, `${name}: no box on the words`);
  ok(!r.corner, `${name}: corner seals and letters clear of other boxes`);
  console.log(`${name}: key columns ${r.cols}, key ${r.sizes[0]}`);
}
// How far each box under the score sits from its chord.
const off = await page.evaluate(() => {
  const f = window.tlFills.chord, xs = window.tlChordNotes();
  return f.list.map((x, i) => { const b = f.fieldEls[x.id].getBoundingClientRect(); return Math.abs(b.left + b.width / 2 - xs[i]); });
});
console.log('chord boxes off their chords (px):', off.map((v) => v.toFixed(1)).join(' '));

// Taps on the middle and the edges of each box and key.
await into('#main-fill');
for (const id of ['high', 'low']) {
  const b = await rect(`#main-fill .tl-fi-field[data-id="${id}"]`);
  for (const [x, y] of [[b.x + b.w / 2, b.y + b.h / 2], [b.x + 2, b.y + 2], [b.x + b.w - 2, b.y + b.h - 2], [b.x - 6, b.y + b.h / 2]]) {
    const n = await events(); await tapAt(x, y);
    const ev = await since(n);
    ok(ev.length === 1 && ev[0].type === 'fieldTap' && ev[0].id === id, `tap on box ${id} at ${x | 0},${y | 0}: ${JSON.stringify(ev)}`);
  }
}
await page.evaluate(() => window.tlFills.main.clear());
await wait(100);
const keyIds = await F('main', 'f.keys.map((k) => k.id)');
for (const k of keyIds) {
  if (k === 'back' || k === 'next') continue;
  const b = await rect(`#main-fill .tl-fi-key[data-key="${k}"]`);
  for (const [x, y] of [[b.x + b.w / 2, b.y + b.h / 2], [b.x + 2, b.y + 2], [b.x + b.w - 2, b.y + b.h - 2]]) {
    await page.evaluate(() => window.tlFills.main.clear()); await wait(30);
    const n = await events(); await tapAt(x, y);
    const ev = await since(n);
    ok(ev.length === 1 && ev[0].type === 'keyPress' && ev[0].key === k.slice(2), `tap on key ${k}: ${JSON.stringify(ev)}`);
  }
}
// The gap between two keys goes to one of them; the tray's corner is the blank.
{
  const a = await rect('#main-fill .tl-fi-key[data-key="k:1"]'), b = await rect('#main-fill .tl-fi-key[data-key="k:2"]');
  if (Math.abs(a.y - b.y) < 2) {
    await page.evaluate(() => window.tlFills.main.clear()); await wait(30);
    const n = await events(); await tapAt((a.x + a.w + b.x) / 2 - 1, a.y + a.h / 2);
    const ev = await since(n);
    ok(ev.length === 1 && ev[0].type === 'keyPress' && ev[0].key === '1', `gap between keys: ${JSON.stringify(ev)}`);
  }
  const t = await rect('#main-fill .tl-fi-pad');
  const n = await events(); await tapAt(t.x + 1, t.y + 1);
  const ev = await since(n);
  ok(ev.length === 1 && ev[0].type === 'blankTap', `tray corner is blank: ${JSON.stringify(ev)}`);
}

// Writing with the keys.
const key = async (k) => { const b = await rect(`#main-fill .tl-fi-key[data-key="${k}"]`); await tapAt(b.x + b.w / 2, b.y + b.h / 2); };
await page.evaluate(() => window.tlFills.main.clear()); await wait(50);
{
  const b = await rect('#main-fill .tl-fi-field[data-id="high"]'); await tapAt(b.x + b.w / 2, b.y + b.h / 2);
  await key('k:1'); await key('k:2');
  ok(await F('main', 'f.text("high")') === '12', 'two keys write 12');
  ok(await F('main', 'f.cur') === 'low', 'a full box hands on to the next');
  await key('k:3'); await key('k:4');
  const n = await events(); await key('k:5');
  const ev = await since(n);
  ok(ev[0] && ev[0].accepted === false && (await F('main', 'f.text("low")')) === '34', 'a full box takes no more');
  ok(await page.$eval('#main-fill .tl-fi-field[data-id="low"]', (e) => e.classList.contains('tl-fi-full')), 'a full box flashes');
  await key('back'); await key('back');
  ok(await F('main', 'f.text("low")') === '', 'delete twice empties the box');
  await key('back');
  ok(await F('main', 'f.cur') === 'high', 'delete in an empty box steps back');
  await key('next');
  ok(await F('main', 'f.cur') === 'low', 'next moves on');
  await wait(350);
  const toks = await page.evaluate(() => [...document.querySelectorAll('#main-fill .tl-fi-field')].map((e) => e.querySelectorAll('.tl-fi-tok').length));
  ok(toks[0] === 2 && toks[1] === 0, `deleted ink leaves nothing behind (${toks})`);
}

// Typing on a keyboard.
await page.evaluate(() => window.tlFills.main.clear()); await wait(50);
{
  const b = await rect('#main-fill .tl-fi-field[data-id="high"]'); await tapAt(b.x + b.w / 2, b.y + b.h / 2);
  await page.keyboard.type('7'); await page.keyboard.press('Enter'); await page.keyboard.type('2'); await page.keyboard.type('x');
  ok((await F('main', 'f.all()')).high === '7' && (await F('main', 'f.all()')).low === '2', 'typing 7, Enter, 2 (x ignored)');
  await page.keyboard.press('Backspace');
  ok(await F('main', 'f.text("low")') === '', 'Backspace deletes');
  await page.keyboard.press('ArrowLeft');
  ok(await page.evaluate(() => document.activeElement.dataset.id) === 'high', 'ArrowLeft moves to the box before');
  await into('#g-chord');
  const c = await rect('#g-chord .tl-fi-field[data-id="c1"]'); await tapAt(c.x + c.w / 2, c.y + c.h / 2);
  await page.keyboard.type('iv');
  await page.keyboard.press('Enter'); await page.keyboard.type('Ic');
  const v = await F('chord', 'f.all()');
  ok(v.c1 === 'IV' && v.c2 === 'Ic', `typing roman numerals (${JSON.stringify(v)})`);
  await page.evaluate(() => window.tlFills.chord.clear());
}

// Lock and unlock: the tray folds away and taps change nothing.
await into('#main-fill');
await page.evaluate(() => window.tlFills.main.set({ values: { high: '3' } })); await wait(100);
{
  const h0 = (await rect('#main-fill')).h;
  await page.evaluate(() => window.tlFills.main.lock(true)); await wait(750);
  const h1 = (await rect('#main-fill')).h, pad = (await rect('#main-fill .tl-fi-padwrap')).h;
  ok(pad === 0 && h1 < h0 - 60, `locked: tray folded (${h0} -> ${h1}, tray ${pad})`);
  const b = await rect('#main-fill .tl-fi-field[data-id="low"]');
  const n = await events(); await tapAt(b.x + b.w / 2, b.y + b.h / 2); await page.keyboard.type('5');
  ok((await since(n)).every((e) => e.type === 'blankTap') && (await F('main', 'f.text("low")')) === '', 'locked: taps and keys change nothing');
  await page.evaluate(() => window.tlFills.main.lock(false)); await wait(750);
  ok(Math.abs((await rect('#main-fill')).h - h0) < 2, 'unlocked: tray back');
}

// Check seals; caption room covers nothing.
await page.evaluate(() => { window.tlFills.main.fill({ low: '2' }); window.tlJudge('main'); }); await wait(600);
ok(await page.$$eval('#main-fill .tl-fi-seal.tl-fi-yes', (s) => s.length) === 1 && await page.$$eval('#main-fill .tl-fi-seal.tl-fi-no', (s) => s.length) === 1, 'one right seal, one wrong seal');
await page.evaluate(() => { const f = window.tlFills.main; f.set({}); f.caption('low', 'the low F is in bar 1'); }); await wait(900);
{
  const r = await page.evaluate(() => {
    const f = window.tlFills.main, b = f.host.querySelector('.tl-fi-bubble').getBoundingClientRect(), h = f.host.getBoundingClientRect();
    const others = [...f.host.querySelectorAll('.tl-fi-field, .tl-fi-key, .tl-fi-text, .tl-fi-term')].map((e) => e.getBoundingClientRect());
    const hit = others.some((o) => b.left < o.right - 1 && o.left < b.right - 1 && b.top < o.bottom - 1 && o.top < b.bottom - 1);
    return { hit, inside: b.left >= h.left - 1 && b.right <= h.right + 1 };
  });
  ok(!r.hit && r.inside, `bubble covers nothing and stays inside (${JSON.stringify(r)})`);
  await page.evaluate(() => window.tlFills.main.caption(null)); await wait(900);
  ok(await page.$$eval('#main-fill .tl-fi-room', (s) => s.length) === 0, 'caption room closes');
}

// The type command presses keys one by one; stop leaves the rest unpressed.
await page.evaluate(() => { window.tlFills.main.clear(); window.tlFills.main.type('high', '12'); }); await wait(500);
ok(await page.$$eval('#main-fill .tl-fi-key.tl-fi-flash', (s) => s.length) === 1, 'a pressed key glows');
await page.evaluate(() => window.tlFills.main.stop()); await wait(700);
ok(await F('main', 'f.text("high")') === '1', 'stop leaves the rest unpressed');

// set draws with nothing moving, now or later.
const running = () => page.evaluate(() => window.tlFills.main.host.getAnimations({ subtree: true }).filter((a) => a.animationName !== 'tl-fi-blink').length);
await page.evaluate(() => window.tlFills.main.set({ values: { high: '3', low: '1' }, checks: { high: true, low: false }, labels: { high: 'A', low: 'B' }, locked: true, caption: { key: 'high', html: 'x' } }));
ok(await running() === 0, 'set: nothing moving at once');
await wait(260);
ok(await running() === 0, 'set: nothing replayed later');

// A rebuild keeps what is written; one tap, one event.
await page.evaluate(() => window.tlFills.main.set({ values: { high: '3' } }));
await page.setViewportSize({ width: Number(width) + 40, height: 900 }); await wait(500);
await page.setViewportSize({ width: Number(width), height: 900 }); await wait(500);
ok(await F('main', 'f.text("high")') === '3', 'rebuild keeps what is written');
await into('#main-fill');
{
  const b = await rect('#main-fill .tl-fi-field[data-id="low"]');
  const n = await events(); await tapAt(b.x + b.w / 2, b.y + b.h / 2);
  ok((await since(n)).length === 1, 'one event per tap after rebuild');
}

const sw = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
ok(sw <= 0, `no horizontal scroll (${sw})`);
ok(errors.length === 0, 'no console errors: ' + errors.join(' | '));
console.log(fails.length ? `FAIL ${width}:\n  ` + fails.join('\n  ') : `all pass at ${width}`);
await close();
