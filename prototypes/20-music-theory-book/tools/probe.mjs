// Opens a probe page, prints its #res text and saves a screenshot.
// Usage: node probe.mjs <fragment.html> <out.png> [width]
import { openPage } from './serve.mjs';

const [, , file, out, width = '700'] = process.argv;
const { page, errors, close } = await openPage(file, width);
await page.waitForTimeout(800);
console.log(await page.$eval('#res', (e) => e.textContent));
await page.screenshot({ path: out, fullPage: true });
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
