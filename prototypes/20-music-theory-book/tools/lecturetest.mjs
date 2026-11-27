// Runs a lecture prototype from start to end as a child would: presses
// 下一幕 whenever it glows, answers each turn from a script (wrong answers
// first where the script says so), goes back a scene once with 上一幕 and
// skips one scene with 下一幕 before it ends, and tries to tick an option
// before being asked. Checks the trace: the question was read first, the
// lecture finished and showed its end card, going back replayed the scene
// before, the skip went on to the next scene, wrong attempts gave the hint
// and then the demonstration, conclusions flew to the board, an option
// could not be ticked before the question, and there were no errors. At
// every stop it checks the screen is a film frame: nothing scrolls or
// slides anywhere, the top bar fits, and every role on stage is wholly
// inside the middle of the stage; it saves a screenshot there.
// Options ruled out while they are checked cannot be ticked, so a choice
// is answered right at once; wrong attempts are tried where the child
// writes the answer.
// Usage: node lecturetest.mjs <width> <out dir> [question id] [height]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openLecture } from './lecture-serve.mjs';

const [width = '1280', out = 'shots', only, h] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const HEIGHT = Number(h) || (Number(width) < 600 ? 844 : 900);

// Each turn lists the answers tried in order; the last one is repeated.
// wrong: whether the script answers wrong first; back: at which stop to
// press 上一幕; skip: at which scene title to press 下一幕 while it is
// still running.
const SCRIPTS = {
  'q01-time-signatures': { turns: [['68'], ['78'], ['24']], wrong: false, back: 3, skip: null },
  'count-demo': { turns: [['5', '4'], ['6']], wrong: true, back: null, skip: '读题' }
};

const frame = (page) => page.evaluate(() => {
  const bad = [];
  const se = document.scrollingElement;
  if (se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1) bad.push(`page scrolls ${se.scrollWidth}x${se.scrollHeight}`);
  document.querySelectorAll('.lx-stage, .lx-stage *').forEach((e) => {
    if ((e.scrollLeft || e.scrollTop) && !e.classList.contains('tl-cs-scroll')) bad.push('scrolled: ' + (e.className.baseVal ?? e.className));
    const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && !e.classList.contains('tl-cs-scroll') && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) bad.push('scrolls inside: ' + (e.className.baseVal ?? e.className));
  });
  const top = document.querySelector('.lx-top');
  if (top.scrollWidth > top.clientWidth + 1) bad.push(`top bar too wide ${top.scrollWidth} > ${top.clientWidth}`);
  const main = document.querySelector('.lx-main').getBoundingClientRect();
  document.querySelectorAll('.lx-main .lx-role:not([hidden])').forEach((r) => {
    const b = r.getBoundingClientRect();
    if (b.top < main.top - 2 || b.bottom > main.bottom + 2 || b.left < main.left - 2 || b.right > main.right + 2) bad.push(`${r.dataset.role} outside the middle (${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)} of ${Math.round(main.left)},${Math.round(main.top)}..${Math.round(main.right)},${Math.round(main.bottom)})`);
  });
  const on = [...document.querySelectorAll('.lx-center-in .lx-role:not([hidden])')].map((r) => r.dataset.role);
  return { bad, scale: window.lxPlayer.scale, cols: window.lxPlayer.cols, on };
});

async function runOne(qid) {
  const { page, errors, close } = await openLecture('lecture-rhythm-beats.html', width, HEIGHT);
  const fails = [];
  await page.evaluate((q) => window.lxRun(q), qid);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.lxPlayer.bar.rate(1.4));
  const script = SCRIPTS[qid];
  let stops = 0, wentBack = false, skipped = false, triedEarly = false, waitsSeen = 0, attempt = 0, turn = 0, minScale = 1, cols = 0;
  const stages = new Set();
  const tr = () => page.evaluate(() => window.lxTrace.map((x) => x.kind + '|' + x.text));
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    const t = await tr();
    if (t.some((x) => x.startsWith('done|'))) break;
    if (t.some((x) => x.startsWith('error|'))) { fails.push('trace error: ' + t.filter((x) => x.startsWith('error|')).join(' / ')); break; }
    const scenes = t.filter((x) => x.startsWith('scene|'));
    const now = scenes.length ? scenes[scenes.length - 1] : '';
    if (script.skip && !skipped && now.includes(script.skip) && !now.includes('跳过')) {
      skipped = true;
      await page.waitForTimeout(800);
      if (await page.$eval('.lx-next', (b) => b.disabled)) fails.push('下一幕 could not skip a running scene');
      else await page.click('.lx-next');
      continue;
    }
    // An option shown before the question is asked cannot be ticked.
    if (!triedEarly && now.includes('一项一项地对')) {
      triedEarly = true;
      await page.waitForTimeout(600);
      const before = (await tr()).filter((x) => x.includes('answer.given')).length;
      const inert = await page.$eval('.lx-role[data-role="answer"]', (s) => s.inert);
      await page.mouse.click(...(await page.$eval('.lx-role[data-role="answer"] [data-id]', (e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })));
      await page.waitForTimeout(200);
      const after = (await tr()).filter((x) => x.includes('answer.given')).length;
      if (!inert || after > before) fails.push('an option could be ticked before the question was asked');
      continue;
    }
    const settled = t.filter((x) => x.startsWith('act|') && (x.includes('答对了') || x.includes('，演示'))).length;
    if (settled > turn) { turn = settled; attempt = 0; }
    const waits = t.filter((x) => x.startsWith('act|等孩子')).length;
    if (waits > waitsSeen) {
      waitsSeen = waits;
      const tries = script.turns[turn] || [];
      const value = tries[Math.min(attempt, tries.length - 1)];
      attempt++;
      await page.waitForTimeout(500);
      if (!(await page.$eval('.lx-next', (b) => b.disabled))) fails.push('下一幕 was not held while the child was asked');
      const sel = (await page.$('.lx-role[data-role="answer"] [data-key]'))
        ? `.lx-role[data-role="answer"] [data-key="k:${value}"]`
        : `.lx-role[data-role="answer"] [data-id="${value}"]`;
      await page.click(sel);
      continue;
    }
    if (await page.$('.lx-next.ready')) {
      stops++;
      await page.waitForTimeout(700);
      const f = await frame(page);
      minScale = Math.min(minScale, f.scale); cols = f.cols; stages.add(f.on.join('+') || '(no centre role)');
      f.bad.forEach((b) => fails.push(`stop ${stops}: ${b}`));
      await page.screenshot({ path: join(out, `${qid}-${width}x${HEIGHT}-${String(stops).padStart(2, '0')}.png`) });
      if (script.back && !wentBack && stops === script.back) {
        wentBack = true;
        const scenesBefore = (await tr()).filter((x) => x.startsWith('scene|')).length;
        await page.click('.lx-prev');
        await page.waitForTimeout(1200);
        await page.screenshot({ path: join(out, `${qid}-${width}x${HEIGHT}-back.png`) });
        const s2 = (await tr()).filter((x) => x.startsWith('scene|'));
        if (s2.length <= scenesBefore) fails.push('上一幕 did not replay a scene');
        continue;
      }
      await page.click('.lx-next');
      await page.waitForTimeout(300);
      continue;
    }
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1400);
  const trace = await page.evaluate(() => window.lxTrace);
  await page.screenshot({ path: join(out, `${qid}-${width}x${HEIGHT}-end.png`) });
  const kinds = (k) => trace.filter((x) => x.kind === k).map((x) => x.text);
  if (!trace.some((x) => x.kind === 'done')) fails.push('lecture did not finish');
  if (await page.$eval('.lx-end', (e) => e.hidden)) fails.push('no end card');
  if (!kinds('scene')[0] || !kinds('scene')[0].includes('读题')) fails.push('the question was not read first');
  const acts = kinds('act');
  if (script.wrong) {
    if (!acts.some((a) => a.includes('第 1 次答错') && a.includes('说提示'))) fails.push('no hint after the first wrong answer');
    if (!acts.some((a) => a.includes('第 2 次答错') && a.includes('演示'))) fails.push('no demo after the second wrong answer');
  }
  if (script.back && !kinds('nav').some((n) => n.startsWith('回到上一幕'))) fails.push('上一幕 was not pressed');
  if (script.skip && !kinds('scene').some((n) => n.includes('跳过'))) fails.push('no scene was skipped');
  const flights = kinds('call').filter((c) => c.startsWith('结论从'));
  if (!flights.length) fails.push('no conclusion flew to the board');
  const end = await frame(page);
  end.bad.forEach((b) => fails.push('end: ' + b));
  console.log(`${qid} @${width}x${HEIGHT}: ${stops} stops, ${kinds('scene').length} scenes, ${kinds('say').length} lines, ${flights.length} flights, board ${cols === 2 ? 'beside' : 'on top'}, smallest scale ${Math.round(minScale * 100)}%, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('  centre stages: ' + [...stages].join(' | '));
  console.log('  scenes: ' + kinds('scene').join(' | '));
  if (errors.length) fails.push('console: ' + errors.join(' / '));
  console.log(fails.length ? '  FAIL ' + fails.join('; ') : '  PASS');
  await close();
  return fails.length === 0;
}

let ok = true;
for (const qid of Object.keys(SCRIPTS)) if (!only || only === qid) ok = (await runOne(qid)) && ok;
process.exit(ok ? 0 : 1);
