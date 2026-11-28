// Taps every key of the main keyboard and checks the keyTap event names
// that key; then checks blank taps clear, lights fade, commands run without
// errors, keyboards in one gallery are the same size, and the piano reaches
// the ready state.
// Usage: node keytest.mjs <fragment.html> [width]
import { openPage } from './serve.mjs';

const [, , file, width = '390'] = process.argv;
const { page, errors, close } = await openPage(file, width);

const keys = await page.$$eval('#main-kb .tl-key', (ks) => ks.map((k) => Number(k.dataset.midi)));
let hit = 0;
const missed = [];
for (const m of keys) {
  const pt = await page.$eval(`#main-kb .tl-key[data-midi="${m}"]`, (k) => {
    k.scrollIntoView({ block: 'center' });
    const r = k.getBoundingClientRect();
    const white = k.classList.contains('tl-white');
    return { x: r.left + r.width / 2, y: white ? r.bottom - 14 : r.top + r.height * 0.6 };
  });
  await page.mouse.click(pt.x, pt.y);
  const last = await page.evaluate(() => window.tlEvents.filter((e) => e.type === 'keyTap').pop());
  if (last && last.midi === m) hit++; else missed.push(m);
}
console.log(`width ${width}: keys ${keys.length}, hit ${hit}${missed.length ? ', missed ' + missed.join(',') : ''}`);
const rows = await page.$$eval('#main-kb .tl-row', (rs) => rs.length);
const keyW = await page.$eval('#main-kb .tl-white', (k) => Math.round(k.getBoundingClientRect().width));
console.log(`rows ${rows}, white key width ${keyW}px`);

const litNow = () => page.$$eval('#main-kb .tl-lit', (ks) => ks.length);
const tapKey = async (m) => {
  const pt = await page.$eval(`#main-kb .tl-key[data-midi="${m}"]`, (k) => { k.scrollIntoView({ block: 'center' }); const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 14 }; });
  await page.mouse.click(pt.x, pt.y);
};
await tapKey(64);
const afterTap = await litNow();
const lane = await page.$eval('#main-kb .tl-lane', (l) => { const r = l.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 8 }; });
await page.mouse.click(lane.x, lane.y);
const afterBlank = await litNow();
await tapKey(64);
await page.waitForTimeout(2300);
const afterFade = await litNow();
console.log(`lit after tap ${afterTap}, after blank tap ${afterBlank}, after 2.3s ${afterFade}`);

for (const cmd of ['scale', 'steps', 'play', 'count', 'enh', 'spot', 'clear']) {
  await page.click(`[data-cmd="${cmd}"]`);
  await page.waitForTimeout(cmd === 'count' ? 5200 : 300);
}
const counts = await page.evaluate(() => window.tlEvents.filter((e) => e.type === 'countStep').length);
console.log(`countStep events ${counts}`);
const sizes = await page.$$eval('#g-chords .tl-case', (cs) => cs.map((c) => `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`));
console.log('chord keyboards', [...new Set(sizes)].join(' | '));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('page scrolls sideways', overflow);
console.log(await page.$eval('#sound-state', (e) => e.textContent));
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
