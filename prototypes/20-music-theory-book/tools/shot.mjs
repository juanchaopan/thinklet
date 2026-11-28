// Opens a prototype page the way it is published (the prototype folder
// served over local HTTP, the page at its own path, the loading screen's
// 开始 tapped) and saves full-page screenshots at the three thinklet screen
// sizes, after clicking the given selectors.
// Usage: node shot.mjs <page path in the prototype folder> <out-prefix> [click-selector ...]
import { openPage } from './serve.mjs';

const [, , file, out, ...clicks] = process.argv;
const sizes = { phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900] };
for (const [name, [width, height]] of Object.entries(sizes)) {
  const { page, errors, close } = await openPage(file, width, height);
  for (const sel of clicks) {
    await page.click(sel);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}--${name}.png`, fullPage: true });
  if (errors.length) console.log(name, 'errors:', errors.join(' | '));
  await close();
}
console.log('done');
