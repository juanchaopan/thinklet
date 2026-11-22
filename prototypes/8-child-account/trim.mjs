// Crops the transparent margin around a PNG, keeping a small even padding, so
// a generated logo fills the height it is shown at. Pixels fainter than the
// alpha threshold count as margin, so a faint glow does not hold the edges out.
// Usage: node trim.mjs <input.png> <output.png> [padding-px] [alpha-threshold 0-255]
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [input, output, padding = '8', threshold = '48'] = process.argv.slice(2);
const dataUrl = `data:image/png;base64,${readFileSync(input).toString('base64')}`;

const browser = await chromium.launch();
const tab = await browser.newPage();
const result = await tab.evaluate(
  async ({ src, pad, minAlpha }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
    let top = height, left = width, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > minAlpha) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    left = Math.max(0, left - pad);
    top = Math.max(0, top - pad);
    right = Math.min(width - 1, right + pad);
    bottom = Math.min(height - 1, bottom + pad);
    const w = right - left + 1;
    const h = bottom - top + 1;
    const out = new OffscreenCanvas(w, h);
    out.getContext('2d').drawImage(canvas, left, top, w, h, 0, 0, w, h);
    const blob = await out.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { w, h, bytes: Array.from(bytes) };
  },
  { src: dataUrl, pad: Number(padding), minAlpha: Number(threshold) },
);
await browser.close();
writeFileSync(output, Buffer.from(result.bytes));
console.log(`${result.w}x${result.h}`);
