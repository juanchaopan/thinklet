// Runs a lecture prototype from start to end as a child would: taps 下一步
// whenever it shows, answers each turn from a script (wrong answers first
// where the script says so), taps a conclusion once to review, and checks
// the trace: the lecture finished, review came back to where it left,
// wrong attempts gave the hint and then the demonstration, and there were
// no errors. Saves a screenshot of the stage at every stop.
// Usage: node lecturetest.mjs <width> <out dir> [question id]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openLecture } from './lecture-serve.mjs';

const [width = '1280', out = 'shots', only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

// Each turn lists the answers tried in order; the last one is repeated.
const SCRIPTS = {
  'meter-demo': { turns: [['68'], ['34']], review: { atStop: 3, id: 'p0.measure' } },
  'count-demo': { turns: [['5', '4'], ['6']], review: null }
};

async function runOne(qid) {
  const { page, errors, close } = await openLecture('lecture-rhythm-beats.html', width, 900);
  const fails = [];
  await page.click(`#tabs [data-q="${qid}"]`);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.lxPlayer.bar.rate(1.4));
  const script = SCRIPTS[qid];
  let stops = 0, reviewed = false, waitsSeen = 0, attempt = 0, turn = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 360000) {
    const tr = await page.evaluate(() => window.lxTrace.map((x) => x.kind + '|' + x.text));
    if (tr.some((x) => x.startsWith('done|'))) break;
    if (tr.some((x) => x.startsWith('error|'))) { fails.push('trace error: ' + tr.filter((x) => x.startsWith('error|')).join(' / ')); break; }
    const settled = tr.filter((x) => x.startsWith('act|') && (x.includes('答对了') || x.includes('，演示'))).length;
    if (settled > turn) { turn = settled; attempt = 0; }
    const waits = tr.filter((x) => x.startsWith('act|等孩子')).length;
    if (waits > waitsSeen) {
      waitsSeen = waits;
      const tries = script.turns[turn] || [];
      const value = tries[Math.min(attempt, tries.length - 1)];
      attempt++;
      await page.waitForTimeout(500);
      const sel = (await page.$('.lx-role[data-role="answer"] [data-key]'))
        ? `.lx-role[data-role="answer"] [data-key="k:${value}"]`
        : `.lx-role[data-role="answer"] [data-id="${value}"]`;
      await page.click(sel);
      continue;
    }
    if (await page.$('.pl-next.pl-next-on')) {
      stops++;
      await page.waitForTimeout(700);
      await page.locator('#stage').screenshot({ path: join(out, `${qid}-${width}-${String(stops).padStart(2, '0')}.png`) });
      if (script.review && !reviewed && stops === script.review.atStop) {
        reviewed = true;
        await page.click(`.lx-role[data-role="stack"] [data-id="${script.review.id}"]`, { force: true });
        await page.waitForTimeout(1500);
        await page.locator('#stage').screenshot({ path: join(out, `${qid}-${width}-review.png`) });
        await page.waitForFunction(() => window.lxTrace.some((x) => x.kind === 'review' && x.text === '回到原处'), null, { timeout: 120000 });
        await page.waitForSelector('.pl-next.pl-next-on', { timeout: 10000 }).catch(() => fails.push('review did not come back to 下一步'));
        continue;
      }
      await page.click('.pl-next.pl-next-on');
      await page.waitForTimeout(300);
      continue;
    }
    await page.waitForTimeout(250);
  }
  const trace = await page.evaluate(() => window.lxTrace);
  await page.locator('#stage').screenshot({ path: join(out, `${qid}-${width}-end.png`) });
  const kinds = (k) => trace.filter((x) => x.kind === k).map((x) => x.text);
  if (!trace.some((x) => x.kind === 'done')) fails.push('lecture did not finish');
  if (qid === 'count-demo') {
    const acts = kinds('act');
    if (!acts.some((a) => a.includes('第 1 次答错') && a.includes('说提示'))) fails.push('no hint after the first wrong answer');
    if (!acts.some((a) => a.includes('第 2 次答错') && a.includes('演示'))) fails.push('no demo after the second wrong answer');
  }
  if (script.review && !kinds('review').some((r) => r === '回到原处')) fails.push('review did not return');
  console.log(`${qid} @${width}: ${stops} stops, ${kinds('scene').length} scenes, ${kinds('say').length} lines, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('  scenes: ' + kinds('scene').join(' | '));
  console.log('  acts: ' + kinds('act').join(' | '));
  if (errors.length) fails.push('console: ' + errors.join(' / '));
  console.log(fails.length ? '  FAIL ' + fails.join('; ') : '  PASS');
  await close();
  return fails.length === 0;
}

let ok = true;
for (const qid of Object.keys(SCRIPTS)) if (!only || only === qid) ok = (await runOne(qid)) && ok;
process.exit(ok ? 0 : 1);
