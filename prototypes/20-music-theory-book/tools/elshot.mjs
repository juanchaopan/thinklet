// Screenshots one element after clicking selectors, at a given width.
// Usage: node elshot.mjs <fragment.html> <out.png> <width> <element> [click ...]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');
const [, , file, out, width, el, ...clicks] = process.argv;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${readFileSync(file, 'utf8')}</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
for (const c of clicks) { await page.click(c); await page.waitForTimeout(200); }
await page.waitForTimeout(1500);
await page.locator(el).first().screenshot({ path: out });
await browser.close();
