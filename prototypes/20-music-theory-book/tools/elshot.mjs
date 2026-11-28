// Screenshots one element of a prototype page at 2x after clicking
// selectors, at a given width. The page opens the way it is published
// (the prototype folder served over local HTTP, the page at its own path,
// the loading screen's 开始 tapped).
// Usage: node elshot.mjs <page path in the prototype folder> <out.png> <width> <element> [click ...]
import { openPage } from './serve.mjs';

const [, , file, out, width, el, ...clicks] = process.argv;
const { page, errors, close } = await openPage(file, width, 900, 2);
await page.waitForTimeout(500);
for (const c of clicks) { await page.click(c); await page.waitForTimeout(250); }
await page.waitForTimeout(600);
await page.locator(el).first().screenshot({ path: out });
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
