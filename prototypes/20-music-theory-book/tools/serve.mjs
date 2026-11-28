// Serves a prototype page over local HTTP the way the artifact host does
// (the page is a fragment wrapped in a document) and opens it in
// Chromium. The whole prototype folder is served and the page sits at its
// own path in it (components/beat-grid/demo.html opens as
// /components/beat-grid/demo.html), so a page reaches the engine, the
// other components and the content (../../engine/registry.js,
// ../piano/component.json, ../../content/themes/...) by the same relative
// paths as when it is published. When the page shows the loading screen,
// it waits for 开始 and taps it, as a child would; `loading` reports how
// long that took and what the screen showed.
// Usage as a module: openPage(page path in the prototype folder, width,
// height, scale, { start }).
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { js: 'text/javascript', json: 'application/json', html: 'text/html; charset=utf-8', css: 'text/css', yaml: 'text/yaml; charset=utf-8', mp3: 'audio/mpeg', webp: 'image/webp', png: 'image/png' };

function resolve(path) {
  const f = normalize(join(root, path));
  return f.startsWith(root) && existsSync(f) ? f : null;
}

export async function openPage(file, width, height = 900, scale = 1, { start = true } = {}) {
  const page0 = (isAbsolute(file) ? relative(root, file) : file).replace(/\\/g, '/');
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]).slice(1);
    if (path === page0) {
      res.setHeader('content-type', TYPES.html);
      res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>' + readFileSync(join(root, page0), 'utf8') + '</body></html>');
      return;
    }
    const f = resolve(path);
    if (!f) { res.statusCode = 404; res.end(); return; }
    const body = readFileSync(f);
    res.setHeader('content-type', TYPES[f.split('.').pop()] || 'application/octet-stream');
    res.setHeader('content-length', body.length);
    res.end(body);
  }).listen(0);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: Number(width), height }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${server.address().port}/${page0}`, { waitUntil: 'networkidle' });
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
