// Taps every rung of the main scale ladder and checks the rungTap event
// names that degree; then checks taps between rungs, blank taps clear,
// lights fade, every command runs without errors, the small ladders line
// up rung for rung, the raised degrees of the minor forms sit higher,
// nothing overlaps sideways, and the sound source is ready.
// Usage: node laddertest.mjs <fragment.html> [width]
import { openPage } from './serve.mjs';

const [, , file, width = '390'] = process.argv;
const { page, errors, close, loading } = await openPage(file, width);
if (loading) console.log(`loading screen: ${loading.note}, bar ${loading.bar}`);

const centre = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const lastTap = () => page.evaluate(() => window.tlEvents.filter((e) => e.type === 'rungTap').pop());
const card = (d) => `#main-ladder .tl-sl-rung[data-degree="${d}"] .tl-sl-card`;
await page.$eval('#main-ladder', (e) => e.scrollIntoView({ block: 'center' }));

const degrees = await page.$$eval('#main-ladder .tl-sl-rung', (rs) => rs.map((r) => Number(r.dataset.degree)));
let hit = 0;
const missed = [];
for (const d of degrees) {
  const p = await centre(card(d));
  await page.mouse.click(p.x, p.y);
  const ev = await lastTap();
  if (ev && ev.degree === d) hit++; else missed.push(d);
}
console.log(`width ${width}: rungs ${degrees.length}, hit by card ${hit}${missed.length ? ', missed ' + missed.join(',') : ''}`);

// Taps 40% of the way from a rung to the next one a tone above, and on the technical name.
let between = 0;
for (const d of [1, 2, 4, 5, 6]) {
  const a = await centre(card(d)), b = await centre(card(d + 1));
  await page.mouse.click(a.x, a.y + (b.y - a.y) * 0.4);
  const ev = await lastTap();
  if (ev && ev.degree === d) between++;
}
const tech = await centre('#main-ladder .tl-sl-rung[data-degree="5"] .tl-sl-tech');
await page.mouse.click(tech.x, tech.y);
console.log(`taps 40% of the way to the next rung that hit the nearer rung ${between}/5; tap on "Dominant" -> degree ${(await lastTap()).degree}`);
const names = await page.evaluate(() => window.tlEvents.filter((e) => e.type === 'rungTap').slice(0, 8).map((e) => `${e.degree}:${e.name}/${e.technical}/${e.numeral}`));
console.log('names', names.join(' '));

const litNow = () => page.$$eval('#main-ladder .tl-lit', (ks) => ks.length);
const tapDeg = async (d) => { const p = await centre(card(d)); await page.mouse.click(p.x, p.y); };
await tapDeg(3);
const afterTap = await litNow();
const bubble = await page.$('#main-ladder .tl-sl-bubble');
const below = await page.$eval('#main-ladder .tl-sl-case', (c) => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 3, y: r.bottom - 6 }; });
await page.mouse.click(below.x, below.y);
const afterBlank = await litNow();
const blanks = await page.evaluate(() => window.tlEvents.filter((e) => e.type === 'blankTap').length);
await tapDeg(3);
await page.waitForTimeout(2300);
const afterFade = await litNow();
console.log(`lit after tap ${afterTap} (bubble ${!!bubble}), after a tap under the ladder ${afterBlank} (blankTap ${blanks}), after 2.3s ${afterFade}`);

for (const cmd of ['steps', 'count', 'mask', 'reveal', 'chordV', 'chordIb', 'label', 'spot', 'minor', 'major', 'play', 'down', 'clear']) {
  await page.click(`[data-cmd="${cmd}"]`);
  await page.waitForTimeout(cmd === 'count' ? 2900 : cmd === 'minor' || cmd === 'major' ? 900 : 300);
  if (cmd === 'minor') {
    const minor = await page.$$eval('#main-ladder .tl-sl-rung', (rs) => rs.map((r) => r.getAttribute('aria-label').split(' ')[3].split('，')[0]).join(' '));
    console.log('C harmonic minor:', minor);
  }
}
const counts = await page.evaluate(() => window.tlEvents.filter((e) => e.type === 'countStep').map((e) => e.n).join(','));
console.log(`countStep ${counts}`);

// Small ladders: same size, tonics at the same height, raised degrees higher.
const trio = await page.$$eval('#trio .tl-sl', (ls) => ls.map((l) => {
  const y = (d) => Math.round(l.querySelector(`.tl-sl-rung[data-degree="${d}"]`).getBoundingClientRect().top);
  const c = l.querySelector('.tl-sl-case').getBoundingClientRect();
  return { size: `${Math.round(c.width)}x${Math.round(c.height)}`, y1: y(1), y8: y(8), y6: y(6), y7: y(7) };
}));
console.log('small ladders', trio.map((t) => `${t.size} 1@${t.y1} 8@${t.y8} 6@${t.y6} 7@${t.y7}`).join(' | '));

// Nothing a small ladder draws reaches outside its case.
const spill = await page.$$eval('#trio .tl-sl', (ls) => ls.map((l) => {
  const c = l.querySelector('.tl-sl-case').getBoundingClientRect();
  return [...l.querySelectorAll('.tl-sl-card, .tl-sl-step, .tl-sl-rail')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < c.left - 0.5 || r.right > c.right + 0.5; }).length;
}));
console.log('small ladder parts outside their case', spill.join(','));

// Step marks never cover the numerals in the main ladder.
await page.click('[data-cmd="steps"]');
await page.waitForTimeout(1300);
const overlaps = await page.evaluate(() => {
  const steps = [...document.querySelectorAll('#main-ladder .tl-sl-step')].map((e) => e.getBoundingClientRect());
  const nums = [...document.querySelectorAll('#main-ladder .tl-sl-num span')].map((e) => e.getBoundingClientRect());
  let n = 0;
  steps.forEach((s) => nums.forEach((m) => { if (s.right > m.left && s.left < m.right && s.bottom > m.top && s.top < m.bottom) n++; }));
  return n;
});
console.log('step marks overlapping numerals', overlaps);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('page scrolls sideways', overflow);
console.log(await page.$eval('#sound-state', (e) => e.textContent));
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
