// Screenshots one element at 2x after clicking selectors, with the page
// served over local HTTP so sibling files load.
// Usage: node elshot2.mjs <fragment.html> <out.png> <width> <element> [click ...]
import { openPage } from './serve.mjs';

const [, , file, out, width, el, ...clicks] = process.argv;
const { page, errors, close } = await openPage(file, width, 900, 2);
await page.waitForTimeout(500);
for (const c of clicks) { await page.click(c); await page.waitForTimeout(250); }
await page.waitForTimeout(600);
await page.locator(el).first().screenshot({ path: out });
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
