// Draws the sample books' covers: one solid colour per book, no text, as
// covers/<id>/cover.png at 600×800, the 3:4 shape every cover is shown in.
// Books with no colour have no cover yet and get no file, so the pages show
// the default cover for them.
// Usage: node covers.mjs
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import { BOOKS } from './src/sample-books.mjs';

rmSync('covers', { recursive: true, force: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 1 });
for (const { id, cover } of BOOKS) {
  if (!cover) continue;
  mkdirSync(`covers/${id}`, { recursive: true });
  await tab.setContent(`<body style="margin:0;width:600px;height:800px;background:${cover}"></body>`);
  await tab.screenshot({ path: `covers/${id}/cover.png` });
  console.log(`cover ${id}`);
}
await browser.close();
