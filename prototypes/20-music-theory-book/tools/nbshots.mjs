// Screenshots the narration bar prototype at one width: the lecture
// screen at the start of the run, while a line plays with the child's
// replay flag, at the child's turn, with the speed menu open; and the
// gallery of states.
// Usage: node nbshots.mjs <width> <out-dir>
import { openPage } from '../tools/serve.mjs';

const [, , width = '390', out = '.'] = process.argv;
const { page, errors, close } = await openPage('proto/c11-narration.html', width, 1000, 2);
await page.waitForSelector('body[data-ready="yes"]', { timeout: 20000 });
const shot = async (sel, name) => { const el = await page.$(sel); await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await el.screenshot({ path: `${out}/${name}-${width}.png` }); };
const center = (sel) => page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
const tap = async (sel) => { await center(sel); const b = await (await page.$(sel)).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(80); };

await shot('#lesson', 'lesson-empty');
await tap('#run-btn');
await page.waitForTimeout(2600);
await shot('#lesson', 'lesson-speaking');
await tap('#nb-main [data-act="nextScene"]');
await page.waitForTimeout(5200);
await tap('#nb-main [data-act="prevLine"]');
await page.waitForTimeout(700);
await shot('#lesson', 'lesson-replay');
await page.evaluate(() => { window.tlRun.token++; window.tlBars.main.set({ scene: [1, 3], line: 's2-3', waiting: true }); document.getElementById('mk-tap').hidden = false; });
await page.waitForTimeout(400);
await shot('#lesson', 'lesson-turn');
await tap('#nb-main [data-act="rate"]');
await page.waitForTimeout(400);
await shot('#lesson', 'lesson-rate');
await page.mouse.click(2, 2);
await tap('[data-g="long"]');
await page.waitForTimeout(900);
await shot('.gallery', 'gallery');
console.log(errors.filter((e) => !e.includes('404')).length ? 'errors: ' + errors.join(' | ') : 'no errors');
await close();
