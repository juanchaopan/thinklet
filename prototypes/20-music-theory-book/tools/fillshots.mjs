// Screenshots each part of the fill-in prototype at one width: the main
// stage empty, while typing, after workflow commands and after a check;
// every look in the gallery after typing and a check; the lecture run
// while a key is pressed and at its end.
// Usage: node fishots.mjs <width> <out-dir>
import { openPage } from '../tools/serve.mjs';

const [, , width = '390', out = '.'] = process.argv;
const { page, errors, close } = await openPage('proto/c9-fill.html', width, 1000, 2);
const shot = async (sel, name) => { const el = await page.$(sel); await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await el.screenshot({ path: `${out}/${name}-${width}.png` }); };
const tap = async (sel) => { const el = await page.$(sel); await el.scrollIntoViewIfNeeded(); const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(60); };
const key = (host, k) => tap(`${host} .tl-fi-key[data-key="${k}"]`);

await shot('.stage', 'main-empty');
await tap('#main-fill .tl-fi-field[data-id="high"]');
await key('#main-fill', 'k:3');
await page.waitForTimeout(500);
await shot('.stage', 'main-typing');
for (const c of ['label', 'lit', 'caption']) { await page.click(`[data-cmd="${c}"]`); await page.waitForTimeout(150); }
await page.waitForTimeout(900);
await shot('.stage', 'main-lecture');
await page.click('[data-cmd="uncaption"]');
await page.click('[data-cmd="type"]');
await page.waitForTimeout(1200);
await page.click('[data-cmd="check"]');
await page.waitForTimeout(900);
await shot('.stage', 'main-checked');

await tap('#g-meter .tl-fi-field[data-id="top"]');
await key('#g-meter', 'k:3'); await key('#g-meter', 'next'); await key('#g-meter', 'k:8');
for (const [i, ks] of [['c1', ['IV']], ['c2', ['I', 'c']], ['c3', ['V']], ['c4', ['II']]]) {
  await tap(`#g-chord .tl-fi-field[data-id="${i}"]`);
  for (const k of ks) await key('#g-chord', 'k:' + k);
}
await tap('#g-count .tl-fi-field[data-id="n"]');
await key('#g-count', 'k:1'); await key('#g-count', 'k:2');
await page.waitForTimeout(500);
await shot('.gallery', 'gallery-typed');
for (const g of ['meter', 'chord', 'count']) await page.click(`[data-g="${g}"][data-act="check"]`);
await page.click('[data-g="chord"][data-act="caption"]');
await page.waitForTimeout(1000);
await shot('.gallery', 'gallery-checked');

await page.click('#run-btn');
await page.waitForTimeout(6100);
await shot('#run-stage', 'run-typing');
await page.waitForTimeout(2400);
await shot('#run-stage', 'run-end');
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no errors');
await close();
