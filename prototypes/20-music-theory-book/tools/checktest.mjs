// Clicks the four sound-check buttons in order and prints the report box.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
const require = createRequire('C:/Users/juanc/AI Projects/thinklet/package.json');
const { chromium } = require('@playwright/test');
const [, , file] = process.argv;
const dir = dirname(file);
const server = createServer((req, res) => {
  const p = req.url === '/' ? null : join(dir, req.url.slice(1));
  if (!p) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><meta charset="utf-8"><body>' + readFileSync(file, 'utf8')); return; }
  try { res.end(readFileSync(p)); } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`);
for (const id of ['#t1', '#t2', '#t3', '#t4']) { await page.click(id); await page.waitForTimeout(900); }
console.log(await page.$eval('#report', (t) => t.value));
if (errors.length) console.log('errors:', errors.join(' | '));
await browser.close(); server.close();
