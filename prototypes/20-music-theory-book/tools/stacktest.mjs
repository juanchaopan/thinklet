// Checks the conclusion stack (a wheel) the way a child and a workflow
// would use it, on its demo page, in its tall board and in its phone
// strip:
// - the theme's constants reach the component: the page sets --th-* and
//   a slip's ink is the theme's ink;
// - a first conclusion pushed without a flight, with motion allowed,
//   grows into view on its own within about a second (the wheel already
//   stands where it goes, so nothing else moves the frames);
// - pushing every conclusion with a flight: the flying copy only ever
//   gets nearer its place, has hardly moved at 100 ms, lands on it, and
//   the wheel ends turned to the newest, which stands in the middle at
//   full size with every other slip no bigger the farther it is (far
//   slips all rest at the smallest size);
// - turning by mouse wheel, by mouse drag and by keyboard: the wheel comes
//   to rest on a conclusion, centred, and a drag is never a tap;
// - tapping a slip that is not in focus: one itemTap for that slip, and
//   the wheel turns to it; tapping the empty board: blankTap;
// - set: exactly the given slips, nothing moving;
// - the strip turns sideways; the page never scrolls sideways; no errors.
// Usage: node stacktest.mjs <width>
import { openPage } from './serve.mjs';

const [, , width = '1280'] = process.argv;
const { page, errors, close } = await openPage('components/conclusion-stack/demo.html', width, 1000);
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const events = (type, where) => page.evaluate(([t, w]) => window.tlEvents.filter((e) => e.type === t && (!w || e.where === w)), [type, where]);

// Where each slip of a stack stands: its middle, size against the slip's
// own width, opacity, and the view's middle.
const shape = (key) => page.evaluate((k) => {
  const s = window.tlStacks[k], v = s.view.getBoundingClientRect();
  return {
    axis: s.axis, p: s.p, focus: s.focusIndex(), order: s.order.slice(),
    mid: s.axis === 'y' ? v.top + v.height / 2 : v.left + v.width / 2,
    slips: s.order.map((id) => { const el = s.els[id], r = el.getBoundingClientRect(); return { id, c: s.axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2, k: r.width / el.offsetWidth, a: Number(el.style.opacity) }; })
  };
}, key);
const centred = (sh, what) => {
  const f = sh.slips[sh.focus];
  check(Math.abs(f.c - sh.mid) < 2, `${what}: the slip in focus is ${Math.round(f.c - sh.mid)}px off the middle`);
  check(Math.abs(f.k - 1) < .02, `${what}: the slip in focus is not full size (${f.k.toFixed(2)})`);
  sh.slips.forEach((s, i) => { if (i !== sh.focus) check(s.k < f.k - .1, `${what}: slip ${i} is not smaller than the focus`); });
  for (let i = 0; i + 1 < sh.slips.length; i++) {
    const d0 = Math.abs(i - sh.focus), d1 = Math.abs(i + 1 - sh.focus);
    const near = d0 < d1 ? sh.slips[i].k : sh.slips[i + 1].k, far = d0 < d1 ? sh.slips[i + 1].k : sh.slips[i].k;
    if (d0 !== d1) check(near >= far - .001, `${what}: slip ${d0 < d1 ? i + 1 : i} is bigger than its neighbour nearer the focus`);
  }
};

await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.evaluate(() => window.scrollTo(0, 0));

// A first conclusion pushed without a flight grows into view by itself.
await page.evaluate(() => window.tlCmd.grow());
await page.waitForTimeout(1000);
const grown = await page.evaluate(() => Object.keys(window.tlStacks).map((k) => {
  const s = window.tlStacks[k], el = s.els[s.order[0]];
  return { k, n: s.order.length, a: el ? Number(el.style.opacity) : 0, seen: el ? getComputedStyle(el).visibility : 'none', ink: el ? getComputedStyle(el).color : '' };
}));
grown.forEach((g) => check(g.n === 1 && g.a > .95 && g.seen === 'visible', `${g.k}: a first conclusion pushed without a flight is not shown after 1 s (opacity ${g.a}, ${g.seen})`));
const theme = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--th-ink').trim());
check(theme === '#241a12', `the page does not set the theme's constants (--th-ink is "${theme}")`);
check(grown.every((g) => g.ink === 'rgb(36, 26, 18)'), `a slip's ink is not the theme's ink (${grown.map((g) => g.ink).join(', ')})`);
console.log(`grow: ${grown.map((g) => `${g.k} opacity ${g.a} ${g.seen}`).join(', ')}`);
await page.evaluate(() => window.tlCmd.clear());

// Push every conclusion with a flight, sampling the first flight.
await page.evaluate(() => {
  window.tlSamples = [];
  const s = window.tlStacks.wide, t0 = performance.now();
  window.tlCmd.fly();
  const tick = () => {
    const f = s.flight; if (!f) return;
    const a = f.flyer.getBoundingClientRect(), b = f.el.getBoundingClientRect();
    window.tlSamples.push({ t: performance.now() - t0, d: Math.hypot(a.left + a.width / 2 - b.left - b.width / 2, a.top + a.height / 2 - b.top - b.height / 2) });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(1200);
const samples = await page.evaluate(() => window.tlSamples);
check(samples.length > 20, `too few flight frames (${samples.length})`);
if (samples.length) {
  const d0 = samples[0].d, back = samples.filter((s, i) => i && s.d > samples[i - 1].d + 1).length;
  const at100 = samples.filter((s) => s.t <= 100).pop();
  check(back === 0, `the flying copy turned back ${back} times`);
  check(!at100 || (d0 - at100.d) / d0 < .06, `the flight moved ${at100 ? Math.round((d0 - at100.d) / d0 * 100) : '?'}% in its first 100 ms`);
  check(samples[samples.length - 1].d < 12, `the flight ended ${samples[samples.length - 1].d.toFixed(1)}px from its place`);
  console.log(`flight: ${samples.length} frames, ${Math.round(d0)}px, ${at100 ? Math.round((d0 - at100.d) / d0 * 100) : '?'}% at 100 ms, turned back ${back}`);
}
for (let i = 1; i < 6; i++) { await page.evaluate(() => window.tlCmd.fly()); await page.waitForTimeout(1000); }
check(!(await page.$('.tl-cs-flyer')), 'a flying copy was left behind');
let wide = await shape('wide');
check(wide.axis === 'y', 'the tall board does not turn up and down');
check(wide.order.length === 6 && wide.focus === 5, `after six pushes: ${wide.order.length} slips, focus ${wide.focus}`);
centred(wide, 'after pushing');
const phone = await shape('phone');
check(phone.axis === 'x', 'the phone strip does not turn sideways');
centred(phone, 'phone strip');

// Mouse wheel up two notches.
const view = await page.$eval('#board-wide .tl-cs-view', (v) => { const r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, h: r.height }; });
await page.mouse.move(view.x, view.y);
await page.mouse.wheel(0, -140); await page.waitForTimeout(60); await page.mouse.wheel(0, -140);
await page.waitForTimeout(900);
wide = await shape('wide');
check(wide.focus === 3, `two wheel notches up rest on slip 3, not ${wide.focus}`);
check(Math.abs(wide.p - Math.round(wide.p)) < .001, 'the wheel did not come to rest on a conclusion');
centred(wide, 'after the wheel');

// A mouse drag down turns back; it is not a tap.
const taps0 = (await events('itemTap')).length;
await page.mouse.move(view.x, view.y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(view.x, view.y + i * 10); await page.waitForTimeout(16); }
await page.waitForTimeout(150);
await page.mouse.up();
await page.waitForTimeout(900);
wide = await shape('wide');
check(wide.focus < 3, `a drag down did not turn the wheel back (focus ${wide.focus})`);
check((await events('itemTap')).length === taps0, 'a drag was taken for a tap');
centred(wide, 'after a drag');

// The keyboard turns one step.
await page.focus('#board-wide .tl-cs-view');
const before = wide.focus;
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(800);
wide = await shape('wide');
check(wide.focus === before + 1, `ArrowDown went from ${before} to ${wide.focus}`);

// A tap on the slip after the focus: one itemTap for it, and it comes to the middle.
const target = wide.slips[wide.focus + 1];
const at = await page.evaluate((id) => { const r = window.tlStacks.wide.els[id].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, target.id);
await page.mouse.click(at[0], at[1]);
await page.waitForTimeout(900);
const taps = (await events('itemTap', '电脑')).slice(taps0);
check(taps.length === 1 && taps[0].id === target.id, `a tap on ${target.id} gave ${JSON.stringify(taps.map((t) => t.id))}`);
wide = await shape('wide');
check(wide.order[wide.focus] === target.id, 'the tapped slip did not come to the middle');

// Set straight to two slips: nothing moving, turned to the last.
await page.evaluate(() => window.tlCmd.set2());
const set = await page.evaluate(() => { const s = window.tlStacks.wide; return { n: s.order.length, anim: !!s.anim || !!s.flight, p: s.p }; });
check(set.n === 2 && !set.anim && set.p === 1, `set: ${JSON.stringify(set)}`);
centred(await shape('wide'), 'after set');

// A tap on the empty board above the slips.
const blanks0 = (await events('blankTap', '电脑')).length;
await page.mouse.click(view.x, view.top + 8);
await page.waitForTimeout(200);
check((await events('blankTap', '电脑')).length === blanks0 + 1, 'a tap on the empty board was not blankTap');

const sideways = await page.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1);
check(!sideways, 'the page scrolls sideways');
if (errors.length) fails.push('console: ' + errors.join(' / '));
console.log(`stack @${width}: ` + (fails.length ? 'FAIL ' + fails.join('; ') : 'PASS'));
await close();
process.exit(fails.length ? 1 : 0);
