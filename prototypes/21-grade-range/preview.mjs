// Renders an image file onto a light background as a PNG, so images in
// formats the viewer cannot open (such as WebP) can be looked at. The page is
// written next to the image and opened as a file, because a blank page may not
// load local files.
// Usage: node preview.mjs <image> <output.png>
import { rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [input, output] = process.argv.slice(2);
const image = resolve(input);
const htmlPath = join(dirname(image), `.preview-${basename(image)}.html`);
writeFileSync(
  htmlPath,
  `<body style="margin:0;background:#f6f7fb;display:flex;align-items:center;justify-content:center;height:100vh">
     <img src="${basename(image)}" style="max-width:760px;max-height:760px" />
   </body>`,
);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 800, height: 800 } });
await tab.goto(pathToFileURL(htmlPath).href);
await tab.waitForLoadState('networkidle');
const size = await tab.evaluate(() => {
  const img = document.querySelector('img');
  return `${img.naturalWidth}x${img.naturalHeight}`;
});
console.log(size);
await tab.screenshot({ path: output });
await browser.close();
rmSync(htmlPath);
