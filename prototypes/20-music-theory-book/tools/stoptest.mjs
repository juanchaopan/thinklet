// Presses a component's play button, presses it again mid-way, and checks
// that the sound source has nothing left sounding or queued; then starts
// two components at once, stops one, and checks the other keeps playing.
// Usage: node stoptest.mjs <fragment.html> <play-button selector> [width]
import { openPage } from './serve.mjs';

const [, , file, selector, width = '390'] = process.argv;
const { page, errors, close } = await openPage(file, width);
const voices = () => page.evaluate(() => SoundSource.status().voices);
const buttons = await page.$$(selector);
if (buttons.length === 0) { console.log(`no play button matches ${selector}`); await close(); process.exit(1); }

await buttons[0].scrollIntoViewIfNeeded();
await buttons[0].click();
await page.waitForTimeout(700);
const during = await voices();
await buttons[0].click();
await page.waitForTimeout(250);
const after = await voices();
await page.waitForTimeout(1500);
const later = await voices();
console.log(`${file.split(/[\\/]/).pop()}: voices while playing ${during}, 0.25 s after pause ${after}, 1.75 s after pause ${later}`);

if (buttons.length > 1) {
  await buttons[0].click();
  await buttons[1].click();
  await page.waitForTimeout(500);
  const both = await voices();
  await buttons[0].click();
  await page.waitForTimeout(250);
  const other = await voices();
  await buttons[1].click();
  await page.waitForTimeout(250);
  console.log(`  two playing ${both}; after pausing the first ${other} (the second keeps going); after pausing both ${await voices()}`);
}
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
