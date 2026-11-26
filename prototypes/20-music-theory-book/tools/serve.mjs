// Serves a prototype fragment and its sibling files (sound.js, piano.json)
// over local HTTP, the way the artifact host does, and opens it in
// Chromium. When the page shows the player's loading screen, it waits for
// the "开始" button and taps it, as a child would; `loading` reports how
// long that took and what the screen showed.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');

const TYPES = { js: 'text/javascript', json: 'application/json', html: 'text/html; charset=utf-8' };

export async function openPage(file, width, height = 900, scale = 1, { start = true } = {}) {
  const dir = dirname(file);
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/') {
      res.setHeader('content-type', TYPES.html);
      res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>' + readFileSync(file, 'utf8') + '</body></html>');
      return;
    }
    try {
      const body = readFileSync(join(dir, path.slice(1)));
      res.setHeader('content-type', TYPES[path.split('.').pop()] || 'application/octet-stream');
      res.setHeader('content-length', body.length);
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'networkidle' });
  let loading = null;
  if (start && await page.$('.pl-curtain')) {
    await page.waitForSelector('.pl-start', { timeout: 20000 });
    loading = { ms: Date.now() - t0, note: await page.$eval('.pl-note', (e) => e.textContent), bar: await page.$eval('.pl-fill', (e) => e.style.width) };
    await page.click('.pl-start');
    await page.waitForSelector('.pl-curtain.pl-gone', { state: 'attached' });
    await page.waitForTimeout(550);
  }
  await page.waitForTimeout(300);
  return {
    page, errors, loading,
    async close() { await browser.close(); server.close(); }
  };
}
