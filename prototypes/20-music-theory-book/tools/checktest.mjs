// Opens the check pages of the two components that draw nothing, the way
// they are published, and runs their tests in order: the piano's
// (components/piano/demo.html: load the samples, play C–E–G, stop a long
// run of notes) and the sound's (components/sound/demo.html: a Web Audio
// beep, a media beep, presses on a pad made pressable, counted by the
// oscillators the press sound starts, two per press). Prints each page's
// report box and fails when a step reports a failure.
// Usage: node checktest.mjs
import { openPage } from './serve.mjs';

let ok = true;

{
  const { page, errors, close } = await openPage('components/piano/demo.html', 700);
  await page.click('#t1');
  await page.waitForFunction(() => window.Piano && Piano.status().phase === 'ready', null, { timeout: 20000 });
  await page.waitForTimeout(200);
  await page.click('#t2'); await page.waitForTimeout(900);
  await page.click('#t3'); await page.waitForTimeout(1600);
  const report = await page.$eval('#report', (t) => t.value);
  console.log('--- piano\n' + report);
  const bad = await page.$$eval('.res.bad', (els) => els.map((e) => e.id + ' ' + e.textContent));
  if (bad.length || errors.length || !/r3: .*剩 0 个/.test(report)) { ok = false; console.log('FAIL', bad.join(' | '), errors.join(' | ')); }
  await close();
}

{
  const { page, errors, close } = await openPage('components/sound/demo.html', 700);
  await page.waitForFunction(() => !!window.Sound);
  await page.click('#t1'); await page.waitForTimeout(600);
  await page.click('#t2'); await page.waitForTimeout(600);
  await page.evaluate(() => { const c = Sound.context(), make = c.createOscillator.bind(c); window.__osc = 0; c.createOscillator = function () { window.__osc++; return make(); }; });
  const pads = await page.$$('#pad button');
  for (const b of pads) await b.click({ force: true });
  await page.waitForTimeout(200);
  const presses = (await page.evaluate(() => window.__osc)) / 2;
  const report = await page.$eval('#report', (t) => t.value);
  console.log('--- sound\n' + report + `\npress sounds: ${presses} for ${pads.length - 1} pressable pads and 1 disabled`);
  const bad = await page.$$eval('.res.bad', (els) => els.map((e) => e.id + ' ' + e.textContent));
  if (presses !== pads.length - 1 || bad.length || errors.length) { ok = false; console.log('FAIL', bad.join(' | '), errors.join(' | ')); }
  await close();
}

console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
