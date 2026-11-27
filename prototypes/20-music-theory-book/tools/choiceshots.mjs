// Screenshots each part of the choice prototype at one width: the main
// stage before and after picks and commands, every look in the gallery
// after a pick and a check, and the lecture run at its end.
// Usage: node chshots.mjs <width> <out-dir>
import { openPage } from '../tools/serve.mjs';

const [, , width = '390', out = '.'] = process.argv;
const { page, errors, close } = await openPage('proto/c8-choice.html', width, 1000, 2);
const shot = async (sel, name) => { const el = await page.$(sel); await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await el.screenshot({ path: `${out}/${name}-${width}.png` }); };
const tapOpt = async (host, id) => { const el = await page.$(`${host} .tl-ch-opt[data-id="${id}"]`); await el.scrollIntoViewIfNeeded(); const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };

await shot('.stage', 'main-empty');
await tapOpt('#main-choice', 'min6');
await page.waitForTimeout(500);
await shot('.stage', 'main-picked');
for (const c of ['label', 'strike', 'lit', 'caption']) { await page.click(`[data-cmd="${c}"]`); await page.waitForTimeout(150); }
await page.waitForTimeout(800);
await shot('.stage', 'main-lecture');
await page.click('[data-cmd="check"]');
await page.waitForTimeout(700);
await shot('.stage', 'main-checked');

await tapOpt('#g-key', 'A');
await tapOpt('#g-clef', 'alto');
await tapOpt('#g-snip', 'p5');
await tapOpt('#g-tf', 'false');
for (const i of [0, 1, 1, 2, 3, 3, 3]) {
  const m = await page.$(`#g-marks .tl-ch-mark[data-index="${i}"]`); await m.scrollIntoViewIfNeeded();
  const b = await m.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
await page.waitForTimeout(500);
for (const g of ['key', 'clef', 'snip', 'tf', 'marks']) await page.click(`[data-g="${g}"][data-act="check"]`);
await page.click('[data-g="marks"][data-act="caption"]');
await page.waitForTimeout(900);
await shot('.gallery', 'gallery');

await page.click('#run-btn');
await page.waitForTimeout(11500);
await shot('.mini-stage.phone', 'run-end');
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no errors');
await close();
