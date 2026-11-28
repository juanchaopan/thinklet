// Screenshots each part of the note-placing component's demo page at one
// width: the main stage empty, while dragging, after the child answers,
// after workflow commands and after a check with the right notes shown;
// every look in the gallery after answering and a check; the lecture run
// while counting, while its caption shows and at its end.
// Usage: node noteshots.mjs <width> <out-dir>
import { openPage } from './serve.mjs';

const [, , width = '390', out = '.'] = process.argv;
const { page, errors, close } = await openPage('components/note-place/demo.html', width, 1000, 2);
const hostOf = { a: 'np-a', b: 'np-b', c: 'np-c', d: 'np-d', multi: 'g-multi', sharps: 'g-sharps' };
const shot = async (sel, name) => { const el = await page.$(sel); await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await el.screenshot({ path: `${out}/${name}-${width}.png` }); };
const show = async (name) => { const el = await page.$('#' + hostOf[name] + ' .tl-np-svgbox'); await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(60); };
// Screen point of a staff position in an answer column.
const point = (name, id, pos) => page.evaluate(([h, i, p]) => {
  const c = window.tlComps[h], pt = c.svg.createSVGPoint();
  pt.x = c.cx[i]; pt.y = c.yOf(p);
  const s = pt.matrixTransform(c.svg.getScreenCTM());
  return { x: s.x, y: s.y };
}, [name, id, pos]);
const tapAt = async (name, id, pos) => { await show(name); const p = await point(name, id, pos); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); };
const key = async (name, k) => { const el = await page.$(`#${hostOf[name]} .tl-np-key[data-key="${k}"]`); await el.scrollIntoViewIfNeeded(); const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(80); };

await shot('.stage', 'main-empty');
// A drag on (b): down on the first space, held three steps higher.
await show('b');
const a0 = await point('b', 'n', 1), a1 = await point('b', 'n', 4);
await page.mouse.move(a0.x, a0.y); await page.mouse.down();
await page.mouse.move(a1.x, a1.y, { steps: 6 });
await page.waitForTimeout(250);
await shot('#np-b', 'drag');
await page.mouse.up();
await tapAt('a', 'n', 5); // C5: wrong on purpose (D5 is 6)
await key('b', 'acc:sharp');
await tapAt('c', 'n', 11); // B5, flat by the key
await tapAt('d', 'n', -4); // C2: wrong on purpose
await key('d', 'acc:flat');
await page.waitForTimeout(500);
await shot('.stage', 'main-answered');
for (const c of ['lit', 'label', 'caption']) { await page.click(`[data-cmd="${c}"]`); await page.waitForTimeout(150); }
await page.click('[data-cmd="count"]');
await page.waitForTimeout(1300);
await shot('.stage', 'main-lecture');
await page.click('[data-cmd="uncaption"]');
await page.click('[data-cmd="stop"]');
await page.click('[data-cmd="reveal"]');
await page.waitForTimeout(900);
await shot('.stage', 'main-checked');

for (const [id, pos] of [['s', 4], ['d', 5], ['l', 1]]) await tapAt('multi', id, pos);
await key('multi', 'acc:sharp');
await tapAt('sharps', 'n', 5);
await page.waitForTimeout(500);
await shot('.gallery', 'gallery-answered');
await page.click('[data-g="multi"][data-act="check"]');
await page.click('[data-g="sharps"][data-act="reveal"]');
await page.waitForTimeout(1000);
await shot('.gallery', 'gallery-checked');

await page.click('#run-btn');
await page.waitForTimeout(4600);
await shot('#run-stage', 'run-count');
await page.waitForTimeout(4200);
await shot('#run-stage', 'run-caption');
await page.waitForTimeout(8200);
await shot('#run-stage', 'run-end');
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no errors');
await close();
