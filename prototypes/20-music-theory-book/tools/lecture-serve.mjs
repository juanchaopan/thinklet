// Serves a lecture prototype from the prototype folder over local HTTP, the
// way the artifact host does (the page is a fragment wrapped in a document,
// every other file at its own path), and opens it in Chromium. When the
// loading screen shows, it waits for 开始 and taps it, as a child would.
// Usage as a module: openLecture(page file, width, height).
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { js: 'text/javascript', json: 'application/json', html: 'text/html; charset=utf-8', css: 'text/css', yaml: 'text/yaml; charset=utf-8', mp3: 'audio/mpeg', webp: 'image/webp' };

function resolve(path) {
  const f = normalize(join(root, path));
  return f.startsWith(root) && existsSync(f) ? f : null;
}

export async function openLecture(file, width, height = 900, { start = true, scale = 1 } = {}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') {
      res.setHeader('content-type', TYPES.html);
      res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>' + readFileSync(join(root, file), 'utf8') + '</body></html>');
      return;
    }
    const f = resolve(path.slice(1));
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
  await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'networkidle' });
  if (start) {
    await page.waitForSelector('.pl-start', { timeout: 30000 });
    await page.click('.pl-start');
    await page.waitForSelector('.pl-curtain.pl-gone', { state: 'attached' });
    await page.waitForTimeout(400);
  }
  return { page, errors, async close() { await browser.close(); server.close(); } };
}
