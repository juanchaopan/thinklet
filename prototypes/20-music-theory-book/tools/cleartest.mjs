// Checks that a tapped note stops being lit: by tapping blank paper, and by
// waiting for the fade. Also reports the paper heights inside each gallery
// and the sound source's state after the taps.
// Usage: node cleartest.mjs <fragment.html> [width]
import { openPage } from './serve.mjs';

const [, , file, width = '390'] = process.argv;
const { page, errors, close } = await openPage(file, width);

async function tapHead(sel) {
  const pt = await page.$eval(sel, (box) => {
    const h = box.querySelector('.abcjs-notehead'); h.scrollIntoView({ block: 'center' });
    const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(pt.x, pt.y);
}
const lit = (sel) => page.$eval(sel, (box) => box.querySelectorAll('.tl-lit').length);

const mini = '#g-clef .tl-svgbox';
await tapHead(mini);
const afterTap = await lit(mini);
const blank = await page.$eval('#g-clef .tl-paper', (p) => { const r = p.getBoundingClientRect(); return { x: r.right - 8, y: r.top + 8 }; });
await page.mouse.click(blank.x, blank.y);
const afterBlank = await lit(mini);
await tapHead(mini);
await page.waitForTimeout(2300);
const afterFade = await lit(mini);
console.log(`lit after tap ${afterTap}, after blank tap ${afterBlank}, after 2.3s ${afterFade}`);

for (const g of ['#g-clef', '#g-rare', '#g-orn', '#g-keys']) {
  const hs = await page.$$eval(`${g} .tl-paper`, (ps) => ps.map((p) => Math.round(p.getBoundingClientRect().height)));
  console.log(g, 'paper heights', [...new Set(hs)].join(','));
}
console.log(await page.$eval('#sound-state', (e) => e.textContent));
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
