// Serves a prototype fragment and its sibling files (sound.js, piano.json)
// over local HTTP, the way the artifact host does, and opens it in Chromium.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');

const TYPES = { js: 'text/javascript', json: 'application/json', html: 'text/html; charset=utf-8' };

export async function openPage(file, width, height = 900, scale = 1) {
  const dir = dirname(file);
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/') {
      res.setHeader('content-type', TYPES.html);
      res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>' + readFileSync(file, 'utf8') + '</body></html>');
      return;
    }
    try {
      res.setHeader('content-type', TYPES[path.split('.').pop()] || 'application/octet-stream');
      res.end(readFileSync(join(dir, path.slice(1))));
    } catch { res.statusCode = 404; res.end(); }
  }).listen(0);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  return {
    page, errors,
    async close() { await browser.close(); server.close(); }
  };
}
