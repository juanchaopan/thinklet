// Checks that the first notes played right after "开始" keep their timing:
// records when each sample is scheduled to start, clicks a play command
// at once, and prints the gaps between consecutive notes.
// Usage: node timetest.mjs <fragment.html> <selector to click> [width]
import { openPage } from './serve.mjs';

const [, , file, sel, width = '390'] = process.argv;
const { page, errors, close, loading } = await openPage(file, width, 900, 1, { start: false });
await page.evaluate(() => {
  window.tlStarts = [];
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when) { if (this.buffer && this.buffer.length > 1) window.tlStarts.push(when); return orig.apply(this, arguments); };
});
await page.waitForSelector('.pl-start', { timeout: 20000 });
console.log('loading screen note:', await page.$eval('.pl-note', (e) => e.textContent), 'bar', await page.$eval('.pl-fill', (e) => e.style.width));
await page.click('.pl-start');
await page.waitForTimeout(600);
await page.click(sel);
await page.waitForTimeout(400);
const starts = await page.evaluate(() => window.tlStarts.slice());
const gaps = starts.slice(1, 8).map((t, i) => (t - starts[i]).toFixed(3));
console.log(`notes scheduled ${starts.length}; first gaps ${gaps.join(' ')}`);
if (errors.length) console.log('errors:', errors.join(' | '));
void loading;
await close();
