// Checks the note-placing prototype at one width: layout (inside the
// page, the reachable range inside the stave box, columns apart, keys
// one size), taps on every line and space, a drag, the accidental keys,
// the keyboard, the key signature in what a note sounds like, lock,
// verdicts and the right note shown beside a wrong one (marks clear of
// each other), counting and stopping it, a state drawn with nothing
// moving, a rebuild keeping state with one event per tap, sound only in
// lectures, and no console errors.
// Usage: node notetest.mjs <width>
import { openPage } from './serve.mjs';

const [, , width = '390'] = process.argv;
const { page, errors, close } = await openPage('proto/c10-note-place.html', width, 1000, 1);
const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const hostOf = { a: 'np-a', b: 'np-b', c: 'np-c', d: 'np-d', multi: 'g-multi', sharps: 'g-sharps', run: 'run-np' };
const events = () => page.evaluate(() => window.tlEvents.length);
const since = (n) => page.evaluate((k) => window.tlEvents.slice(k), n);
const show = async (name) => { await page.$eval('#' + hostOf[name], (e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(60); };
const point = (name, id, pos) => page.evaluate(([h, i, p]) => {
  const c = window.tlComps[h], pt = c.svg.createSVGPoint();
  pt.x = c.cx[i]; pt.y = c.yOf(p);
  const s = pt.matrixTransform(c.svg.getScreenCTM());
  return { x: s.x, y: s.y, step: c.step * c.k };
}, [name, id, pos]);
const tapXY = async (x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(40); };
const key = async (name, k) => { const el = await page.$(`#${hostOf[name]} .tl-np-key[data-key="${k}"]`); const b = await el.boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
const info = (name, id) => page.evaluate(([h, i]) => window.tlComps[h].info(i), [name, id]);
const call = (name, fn, ...args) => page.evaluate(([h, f, a]) => window.tlComps[h][f](...a), [name, fn, args]);
const rect = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
const meet = (p, q) => p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;

// ---------- Layout ----------
const lay = await page.evaluate(() => Object.fromEntries(Object.entries(window.tlComps).map(([k, c]) => {
  const box = c.box.getBoundingClientRect(), host = c.host.getBoundingClientRect(), pt = c.svg.createSVGPoint();
  const at = (p) => { pt.x = 0; pt.y = c.yOf(p); return pt.matrixTransform(c.svg.getScreenCTM()).y; };
  const xs = [].concat(...c.cols.map((col) => col.kind === 'given' ? [c.cx[col.id]] : [c.cx[col.id], c.revealX[col.id]])).sort((a, b) => a - b);
  let gap = Infinity; for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
  const keys = [...c.host.querySelectorAll('.tl-np-key')].map((e) => e.getBoundingClientRect());
  return [k, { hostL: host.left, hostR: host.right, top: at(c.hi), bottom: at(c.lo), boxT: box.top, boxB: box.bottom, gap, k: c.k, keyW: keys.map((r) => Math.round(r.width)), keyH: keys.map((r) => Math.round(r.height)) }];
})));
const vw = await page.evaluate(() => document.documentElement.clientWidth);
ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'page scrolls sideways');
for (const [k, l] of Object.entries(lay)) {
  ok(l.hostL >= 0 && l.hostR <= vw + .5, `${k}: component outside the page`);
  ok(l.top - 8 >= l.boxT && l.bottom + 8 <= l.boxB, `${k}: highest or lowest place outside the stave box (${(l.top - l.boxT).toFixed(1)}, ${(l.boxB - l.bottom).toFixed(1)})`);
  ok(new Set(l.keyW).size === 1 && l.keyW[0] >= 44 && l.keyH.every((h) => h >= 44), `${k}: keys not one size of at least 44 (${l.keyW})`);
  ok(l.gap >= 34 || l.k <= 1.51, `${k}: columns ${l.gap.toFixed(1)} apart at scale ${l.k.toFixed(2)}`);
}
const gaps = Object.fromEntries(Object.entries(lay).map(([k, l]) => [k, `${l.gap.toFixed(0)}u@${l.k.toFixed(2)}`]));

// ---------- Taps on every line and space ----------
await show('a');
const range = await page.evaluate(() => [window.tlComps.a.lo, window.tlComps.a.hi]);
const missed = [];
for (let p = range[0]; p <= range[1]; p++) {
  for (const off of [0, -.4, .4]) {
    const q = await point('a', 'n', p);
    const n0 = await events();
    await tapXY(q.x, q.y + off * q.step);
    const ev = await since(n0);
    if (ev.length !== 1 || ev[0].type !== 'notePlace' || ev[0].pos !== p || ev[0].by !== 'tap') missed.push(`${p}${off ? (off > 0 ? '-' : '+') : ''}`);
  }
}
ok(!missed.length, 'taps landing on the wrong place: ' + missed.join(' '));
// A tap over the clef still writes in the answer column; a tap on the name under the paper is blank.
{
  const q = await point('a', 'n', 3), box = await rect('#np-a .tl-np-svgbox');
  const n0 = await events();
  await tapXY(box.l + 12, q.y);
  const ev = await since(n0);
  ok(ev.length === 1 && ev[0].id === 'n' && ev[0].pos === 3, 'tap over the clef does not write in the answer column');
  const nm = await rect('#np-a .tl-np-name');
  const n1 = await events();
  await tapXY((nm.l + nm.r) / 2, (nm.t + nm.b) / 2);
  const ev1 = await since(n1);
  ok(ev1.length === 1 && ev1[0].type === 'blankTap', 'tap on the name is not blank');
}

// ---------- Drag ----------
{
  await call('a', 'clear');
  const p0 = await point('a', 'n', 1), p1 = await point('a', 'n', 6);
  const n0 = await events();
  await page.mouse.move(p0.x, p0.y); await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await page.waitForTimeout(80);
  const mid = await page.evaluate(() => ({ band: window.tlComps.a.band.classList.contains('on'), ev: window.tlEvents.length }));
  await page.mouse.up(); await page.waitForTimeout(60);
  const ev = await since(n0);
  ok(mid.band && mid.ev === n0, 'drag: no band while dragging, or events before letting go');
  ok(ev.length === 1 && ev[0].by === 'drag' && ev[0].pos === 6 && ev[0].written === 'D5', 'drag: not one notePlace on D5 (' + JSON.stringify(ev.map((e) => [e.type, e.pos])) + ')');
  ok(!(await page.evaluate(() => window.tlComps.a.band.classList.contains('on'))), 'drag: band stays after letting go');
}

// ---------- Accidental keys ----------
{
  await call('a', 'clear');
  let n0 = await events();
  await key('a', 'acc:sharp');
  let ev = await since(n0);
  ok(ev.length === 1 && ev[0].type === 'accidentalPress' && ev[0].accepted === false, 'accidental with no note is not refused');
  ok(await page.$('#np-a .tl-np-flash'), 'accidental with no note: no flash');
  const q = await point('a', 'n', 3);
  await tapXY(q.x, q.y);
  await key('a', 'acc:sharp'); await page.waitForTimeout(320);
  const i = await info('a', 'n');
  ok(i.written === 'A#4' && i.sounding === 'A#4' && i.midi === 70, 'sharp not written: ' + i.written);
  const accBox = await page.$eval('#np-a .tl-np-col .tl-np-acc', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, l: r.left, r: r.right }; });
  const headBox = await rect('#np-a .tl-np-col .tl-np-head');
  ok(accBox.w > 3 && accBox.r <= headBox.l + 1 && headBox.l - accBox.r < 8, 'sharp not drawn just in front of the head: ' + JSON.stringify({ accBox, headBox }));
  ok(await page.$eval('#np-a .tl-np-key[data-key="acc:sharp"]', (e) => e.getAttribute('aria-pressed') === 'true'), 'sharp key not shown pressed');
  await key('a', 'acc:sharp');
  ok((await info('a', 'n')).accidental === null, 'second press does not take the sharp away');
  await key('a', 'acc:dblflat');
  ok((await info('a', 'n')).sounding === 'Abb4', 'double flat not written');
  n0 = await events();
  await key('a', 'erase');
  ev = await since(n0);
  ok(ev.length === 1 && ev[0].type === 'noteErase' && ev[0].accepted && !(await info('a', 'n')), 'erase does not rub the note out');
}

// ---------- Keyboard ----------
{
  await call('a', 'clear');
  await page.$eval('#np-a .tl-np-svgbox', (e) => e.focus());
  const type = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(30); };
  await type('ArrowUp');
  ok((await info('a', 'n'))?.pos === 1, 'first arrow does not place the note on the given note');
  await type('ArrowUp'); await type('ArrowUp');
  ok((await info('a', 'n')).pos === 3, 'arrows do not move the note');
  await type('Shift+Digit3');
  ok((await info('a', 'n')).accidental === 'sharp', '# does not write a sharp');
  await type('Shift+Digit3');
  ok((await info('a', 'n')).accidental === 'dblsharp', '# again does not make a double sharp');
  await type('Shift+Digit3');
  ok((await info('a', 'n')).accidental === null, '# on a double sharp does not take it away');
  await type('b'); await type('b');
  ok((await info('a', 'n')).accidental === 'dblflat', 'b b does not make a double flat');
  await type('n');
  ok((await info('a', 'n')).accidental === 'natural', 'n does not write a natural');
  await type('Backspace');
  ok(!(await info('a', 'n')), 'backspace does not rub out');
}

// ---------- Key signature ----------
{
  await show('c');
  const q = await point('c', 'n', 11);
  await tapXY(q.x, q.y);
  const i = await info('c', 'n');
  ok(i.written === 'B5' && i.sounding === 'Bb5', 'B in B flat major does not sound B flat');
  await show('sharps');
  const r = await point('sharps', 'n', 6);
  await tapXY(r.x, r.y);
  ok((await info('sharps', 'n')).sounding === 'D#5', 'D in B major does not sound D sharp');
  await key('sharps', 'acc:natural');
  ok((await info('sharps', 'n')).sounding === 'D5', 'a natural does not cancel the key');
}

// ---------- Lock ----------
{
  await show('b');
  await call('b', 'clear');
  await call('b', 'lock', true);
  await page.waitForTimeout(650);
  const h = await page.$eval('#np-b .tl-np-padwrap', (e) => e.getBoundingClientRect().height);
  ok(h < .5, 'locked tray not folded: ' + h);
  const q = await point('b', 'n', 4);
  const n0 = await events();
  await tapXY(q.x, q.y);
  ok(!(await info('b', 'n')) && (await since(n0)).length === 0, 'locked stave takes a tap');
  await call('b', 'lock', false);
  await page.waitForTimeout(650);
  ok(await page.$eval('#np-b .tl-np-padwrap', (e) => e.getBoundingClientRect().height) > 60, 'unlocked tray not open');
}

// ---------- Verdicts and the right note ----------
{
  await show('d');
  await call('d', 'set', { notes: { n: 'C2' } });
  await call('d', 'label', { n: 'X' });
  await call('d', 'check', { n: false });
  await call('d', 'reveal', { n: 'Db3' });
  await page.waitForTimeout(700);
  const seal = await rect('#np-d .tl-np-seal.tl-np-no');
  const badge = await rect('#np-d .tl-np-badge');
  const head = await rect('#np-d .tl-np-col .tl-np-head');
  const rev = await rect('#np-d .tl-np-reveal .tl-np-body');
  const given = await rect('#np-d .abcjs-note');
  ok(!meet(seal, head) && !meet(seal, rev) && !meet(seal, given) && !meet(seal, badge), 'seal touches a note or the letter');
  ok(rev.l > head.r - 2, 'right note not to the right of the answer');
  const fills = await page.evaluate(() => {
    const c = window.tlComps.d;
    return { wrong: getComputedStyle(c.colEls.n.note.body).fill, rev: getComputedStyle(c.colEls.n.revNote.body).fill };
  });
  ok(fills.wrong === 'rgb(200, 69, 47)' && fills.rev === 'rgb(123, 77, 255)', 'colours of wrong and right notes: ' + JSON.stringify(fills));
  // Nothing written, the right note still shows.
  await call('d', 'set', { reveal: { n: 'Db3' } });
  ok(await page.$eval('#np-d .tl-np-reveal', (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 5), 'right note hidden when nothing is written');
  for (const name of ['a', 'b', 'c', 'sharps', 'multi']) {
    await show(name);
    const ids = await page.evaluate((h) => window.tlComps[h].answers, name);
    const notes = {}, rv = {}, ch = {};
    for (const id of ids) { notes[id] = name === 'multi' ? 'E4' : 'C5'; rv[id] = name === 'multi' ? 'G4' : 'Dn5'; ch[id] = false; }
    await call(name, 'set', { notes, checks: ch, reveal: rv, locked: true });
    const clash = await page.evaluate((h) => {
      const c = window.tlComps[h], rs = (e) => e.getBoundingClientRect();
      const seals = [...c.overlay.querySelectorAll('.tl-np-seal')].map(rs);
      const bodies = [...c.svg.querySelectorAll('.tl-np-body, .abcjs-note')].map(rs);
      return seals.some((s) => bodies.some((b) => s.left < b.right && b.left < s.right && s.top < b.bottom && b.top < s.bottom));
    }, name);
    ok(!clash, `${name}: a seal touches a note`);
    await call(name, 'clear');
  }
}

// ---------- Counting ----------
{
  await show('a');
  await call('a', 'clear');
  await call('a', 'count', 'n', 'D5');
  await page.waitForTimeout(1100);
  const walking = await page.evaluate(() => !!window.tlComps.a.marks.querySelector('.tl-np-ghost'));
  await call('a', 'stop');
  const after = await page.evaluate(() => ({ ghost: !!window.tlComps.a.marks.querySelector('.tl-np-ghost'), dots: window.tlComps.a.marks.querySelectorAll('.tl-np-dot').length }));
  await page.waitForTimeout(1500);
  const later = await page.evaluate(() => window.tlComps.a.marks.querySelectorAll('.tl-np-dot').length);
  ok(walking && !after.ghost && after.dots === later && later < 6, 'count does not stop: ' + JSON.stringify({ walking, after, later }));
  await call('a', 'count', 'n', 'D5');
  await page.waitForTimeout(450 * 7 + 200);
  const done = await page.evaluate(() => ({ dots: window.tlComps.a.marks.querySelectorAll('.tl-np-dot').length, num: window.tlComps.a.marks.querySelector('.tl-np-num')?.textContent, ghost: !!window.tlComps.a.marks.querySelector('.tl-np-ghost') }));
  ok(done.dots === 6 && done.num === '6' && !done.ghost, 'count F to D is not six: ' + JSON.stringify(done));
  await call('a', 'count', 'n', null);
  ok(!(await page.$('#np-a .tl-np-count')), 'count not taken away');
}

// ---------- A state drawn with nothing moving ----------
{
  await call('a', 'set', { notes: { n: 'Db5' }, checks: { n: true }, reveal: { n: 'D5' }, labels: { n: 'X' }, highlight: ['given0'], count: { id: 'n', to: 'D5' }, caption: { id: 'n', html: 'six letters' }, locked: true });
  await page.waitForTimeout(40);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => window.tlComps.a.host.contains(a.effect && a.effect.target) && a.playState === 'running').map((a) => a.animationName || a.transitionProperty || 'waapi'));
  ok(!running.length, 'set plays animations: ' + running.join(','));
  const st = await page.evaluate(() => ({ room: !!window.tlComps.a.host.querySelector('.tl-np-room'), pad: window.tlComps.a.padWrap.getBoundingClientRect().height }));
  ok(st.room && st.pad < .5, 'set: caption room or locked tray wrong');
  await call('a', 'clear');
  ok(await page.evaluate(() => !window.tlComps.a.host.querySelector('.tl-np-room') && !window.tlComps.a.host.querySelector('.tl-np-seal')), 'clear leaves marks');
}

// ---------- Rebuild ----------
{
  await call('b', 'set', { notes: { n: 'D#3' }, checks: { n: true } });
  await page.evaluate(() => Object.values(window.tlComps).forEach((c) => c.build()));
  await page.waitForTimeout(60);
  ok((await info('b', 'n'))?.sounding === 'D#3' && await page.$('#np-b .tl-np-seal'), 'rebuild loses state');
  await call('b', 'clear');
  await show('b');
  const q = await point('b', 'n', 2);
  const n0 = await events();
  await tapXY(q.x, q.y);
  ok((await since(n0)).length === 1, 'one tap after rebuilds gives more than one event');
}

// ---------- Sound only in lectures ----------
{
  await page.evaluate(() => { window.__plays = 0; const p = SoundSource.play; SoundSource.play = function () { window.__plays++; return p.apply(this, arguments); }; });
  await show('a');
  const q = await point('a', 'n', 4);
  await tapXY(q.x, q.y);
  const practice = await page.evaluate(() => window.__plays);
  await show('run');
  const r = await point('run', 'n', 4);
  await tapXY(r.x, r.y);
  const lecture = await page.evaluate(() => window.__plays);
  ok(practice === 0 && lecture === 1, `sound: practice ${practice}, lecture ${lecture}`);
}

console.log(JSON.stringify(gaps));
ok(!errors.length, 'console errors: ' + errors.join(' | '));
console.log(fails.length ? 'FAIL ' + width + '\n- ' + fails.join('\n- ') : 'PASS ' + width);
await close();
