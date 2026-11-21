// Writes every prototype page to build/, compiles Tailwind over them, and
// captures PNGs per page and screen size into shots/<round>/.
//
// - A page is captured as it looks once its animations have ended; endless
//   ones (the rabbit's bobbing, a blinking caret) are held at their start.
// - A page with `frames` is captured once per listed moment instead: every
//   animation is paused and moved to that many milliseconds from its start,
//   the way the component tests hold a key frame.
// - Pages marked viewportOnly (an open dialog, menu or toast) are captured one
//   screen high, as the overlay covers exactly the screen; others in full.
//
// Each round gets its own folder, so images already opened for review are
// never overwritten.
// Usage: node render.mjs <round> [name-prefix ...]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};

const modules = ['pages-home', 'pages-onboarding', 'pages-family', 'pages-misc'];
const pages = [];
for (const name of modules) {
  pages.push(...(await import(`./src/${name}.mjs`)).default);
}

const [round, ...filters] = process.argv.slice(2);
if (!round) throw new Error('Name the round, for example: node render.mjs r5 home');
const selected = filters.length ? pages.filter((p) => filters.some((f) => p.name.startsWith(f))) : pages;
const outDir = `shots/${round}`;

rmSync('build', { recursive: true, force: true });
mkdirSync('build', { recursive: true });
mkdirSync(outDir, { recursive: true });
for (const p of pages) writeFileSync(`build/${p.name}.html`, p.html);

// The CLI's own entry file runs under the current Node.js, so no shell or
// platform-specific launcher is involved.
execFileSync(
  process.execPath,
  ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'src/theme.css', '-o', 'build/styles.css'],
  { stdio: 'inherit' },
);

const settle = () =>
  document.getAnimations().forEach((a) => {
    if (a.effect.getComputedTiming().endTime === Infinity) {
      a.pause();
      a.currentTime = 0;
    } else {
      a.finish();
    }
  });

const holdAt = (time) =>
  document.getAnimations().forEach((a) => {
    a.pause();
    a.currentTime = time;
  });

const browser = await chromium.launch();
for (const p of selected) {
  for (const [size, viewport] of Object.entries(VIEWPORTS)) {
    const moments = p.frames ?? [null];
    for (const moment of moments) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'zh-CN' });
      const tab = await context.newPage();
      await tab.goto(new URL(`build/${p.name}.html`, import.meta.url).href);
      await tab.waitForLoadState('networkidle');
      if (moment === null) await tab.evaluate(settle);
      else await tab.evaluate(holdAt, moment);
      const suffix = moment === null ? '' : `--${String(moment).padStart(4, '0')}ms`;
      await tab.screenshot({ path: `${outDir}/${p.name}--${size}${suffix}.png`, fullPage: !p.viewportOnly });
      await context.close();
    }
  }
  console.log(`rendered ${p.name}`);
}
await browser.close();
