// Opens a fragment and prints its page errors and a screenshot.
// Usage: node errs.mjs <fragment.html> [width] [shot.png]
import { openPage } from './serve.mjs';

const [, , file, width = '390', shot] = process.argv;
const { page, errors, close } = await openPage(file, width);
await page.waitForTimeout(800);
if (shot) await page.screenshot({ path: shot, fullPage: true });
console.log(errors.length ? errors.join('\n') : 'no errors');
await close();
