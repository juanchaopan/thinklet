// Runs an item in the lecture prototype from start to end as a child
// would: presses 下一幕 whenever it glows, answers each turn from a script
// (wrong answers first where the script says so), goes back a scene once,
// taps a conclusion on the board once, skips one scene before it ends,
// and tries to tick an option before being asked. Checks:
// the question was read first with its text unfolded under the title and
// folded after; going back and tapping a conclusion replayed an earlier
// scene; while the child is asked (and has not answered), 下一幕 and the
// later segments cannot be pressed but going back can; the skip went on;
// wrong attempts gave a retry and then the demonstration; conclusions
// flew to the board and something folded into the board; the board has
// room and shows exactly the conclusions it holds after every press; the
// question menu and close sit together at the top right; at the end
// 下一幕 is gone and replay has come; no errors. At every stop it checks
// the screen is a film frame (nothing scrolls; every control on stage
// inside its region; in a region turned into a wheel, the one in focus)
// and saves a screenshot.
// Usage: node lecturetest.mjs <width> <out dir> [item name] [height]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openLecture } from './lecture-serve.mjs';

const [width = '1280', out = 'shots', only, h] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const HEIGHT = Number(h) || (Number(width) < 600 ? 844 : 900);

const NEXT = '[data-ctl="next"] button', PREV = '[data-ctl="prev"] button', REPLAY = '[data-ctl="replay"] button';

// Each turn lists the answers tried in order; the last one is repeated.
const SCRIPTS = {
  'time-signatures': { turns: [['68'], ['78'], ['24']], wrong: false, back: 3, tap: 5, skip: null, fold: true },
  'count-demo': { turns: [['5', '4'], ['6']], wrong: true, back: null, tap: null, skip: '读题', fold: false }
};

const frame = (page) => page.evaluate(() => {
  const bad = [];
  const se = document.scrollingElement;
  if (se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1) bad.push(`page scrolls ${se.scrollWidth}x${se.scrollHeight}`);
  document.querySelectorAll('.lx-stage, .lx-stage *').forEach((e) => {
    if (e.scrollLeft || e.scrollTop) bad.push('scrolled: ' + (e.className.baseVal ?? e.className));
    const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) bad.push('scrolls inside: ' + (e.className.baseVal ?? e.className));
  });
  const E = window.lxEngine, L = E.layout;
  let wheels = 0;
  Object.keys(L.where).forEach((name) => {
    const s = E.slots[name], r = L.where[name], reg = L.regions[r], wheel = !!(L.wheels[r] && L.wheels[r].active);
    if (wheel) wheels++;
    if (!s || getComputedStyle(s).display === 'none' || parseFloat(getComputedStyle(s).opacity) < (wheel ? .95 : .3)) return;
    const a = s.getBoundingClientRect(), b = reg.getBoundingClientRect();
    if (!a.width || !a.height) return;
    if (a.left < b.left - 3 || a.right > b.right + 3 || a.top < b.top - 3 || a.bottom > b.bottom + 3) bad.push(`${name} outside its region ${r} (${Math.round(a.left)},${Math.round(a.top)}..${Math.round(a.right)},${Math.round(a.bottom)} of ${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)})`);
  });
  const c = E.inst.board && E.inst.board.c;
  if (c) {
    if (E.slots.board.getBoundingClientRect().width < 40 || E.slots.board.getBoundingClientRect().height < 40) bad.push('the board has no room');
    const shown = [...c.view.querySelectorAll('.tl-cs-slip')].filter((e) => e.style.visibility !== 'hidden' && parseFloat(e.style.opacity || '1') > .05 && !e.classList.contains('tl-cs-landing'));
    if (shown.length !== c.order.length) bad.push(`board shows ${shown.length} of its ${c.order.length} conclusions`);
  }
  const m = E.slots.menu.getBoundingClientRect(), x = E.slots.close.getBoundingClientRect();
  if (m.left < innerWidth / 2 || x.left < m.left) bad.push('question menu and close are not together at the top right');
  const on = Object.keys(L.where).filter((n) => L.where[n] === 'main');
  const v = L.cur.v;
  return { bad, scale: L.scaleOf('main'), screen: typeof v.when === 'string' ? v.when : 'default', on, wheels };
});

async function runOne(name) {
  const { page, errors, close } = await openLecture('lecture.html', width, HEIGHT);
  const fails = [];
  await page.evaluate((n) => window.lxRun(n), name);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.lxEngine.bar.rate(1.4));
  const script = SCRIPTS[name];
  let stops = 0, wentBack = false, tapped = false, skipped = false, triedEarly = false, waitsSeen = 0, attempt = 0, turn = 0, minScale = 9, screen = '', titleChecked = false, gateChecked = false, wheelStops = 0;
  const stages = new Set();
  const tr = () => page.evaluate(() => window.lxTrace.map((x) => x.kind + '|' + x.text));
  const opened = () => page.$eval('.st-qt-more', (m) => !m.hidden);
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    const t = await tr();
    if (t.some((x) => x.startsWith('done|'))) break;
    if (t.some((x) => x.startsWith('error|'))) { fails.push('trace error: ' + t.filter((x) => x.startsWith('error|')).join(' / ')); break; }
    const scenes = t.filter((x) => x.startsWith('scene|'));
    const now = scenes.length ? scenes[scenes.length - 1] : '';
    if (!titleChecked && now.includes('读题') && !now.includes('跳过')) {
      titleChecked = true;
      await page.waitForTimeout(700);
      if (!(await opened())) fails.push('the question text did not unfold while the question was read');
    }
    if (script.skip && !skipped && now.includes(script.skip) && !now.includes('跳过')) {
      skipped = true;
      await page.waitForTimeout(800);
      if (await page.$eval(NEXT, (b) => b.disabled)) fails.push('下一幕 could not skip a running scene');
      else await page.click(NEXT);
      continue;
    }
    if (!triedEarly && now.includes('一项一项地对')) {
      triedEarly = true;
      await page.waitForTimeout(600);
      if (await opened()) fails.push('the question text stayed unfolded after reading');
      const before = (await tr()).filter((x) => x.includes('answer.given')).length;
      const inert = await page.$eval('[data-ctl="answer"]', (s) => s.inert);
      const at = await page.$eval('[data-ctl="answer"] [data-id]', (e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      await page.mouse.click(at[0], at[1]);
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
      if (!(await page.$eval(NEXT, (b) => b.disabled))) fails.push('下一幕 was not held while the child was asked');
      if (!gateChecked) {
        gateChecked = true;
        const segs = await page.$$eval('.st-ps-seg', (bs) => bs.map((b) => ({ cur: b.getAttribute('aria-current') === 'true', off: b.disabled })));
        const cur = segs.findIndex((s) => s.cur);
        if (segs.slice(cur + 1).some((s) => !s.off)) fails.push('a later segment could be picked while the child was asked');
        if (segs.slice(0, cur).some((s) => s.off)) fails.push('an earlier segment could not be picked while the child was asked');
        if (await page.$eval(PREV, (b) => b.disabled)) fails.push('上一幕 was held while the child was asked');
      }
      const sel = (await page.$('[data-ctl="answer"] [data-key]'))
        ? `[data-ctl="answer"] [data-key="k:${value}"]`
        : `[data-ctl="answer"] [data-id="${value}"]`;
      await page.click(sel);
      continue;
    }
    if (await page.$(NEXT + '.st-ready')) {
      stops++;
      await page.waitForTimeout(900);
      const f = await frame(page);
      minScale = Math.min(minScale, f.scale); screen = f.screen; stages.add(f.on.join('+') || '(empty)');
      if (f.wheels) wheelStops++;
      f.bad.forEach((b) => fails.push(`stop ${stops}: ${b}`));
      await page.screenshot({ path: join(out, `${name}-${width}x${HEIGHT}-${String(stops).padStart(2, '0')}.png`) });
      if (script.back && !wentBack && stops === script.back) {
        wentBack = true;
        const before = (await tr()).filter((x) => x.startsWith('scene|')).length;
        await page.click(PREV);
        await page.waitForTimeout(1200);
        if ((await tr()).filter((x) => x.startsWith('scene|')).length <= before) fails.push('上一幕 did not replay a scene');
        continue;
      }
      if (script.tap && !tapped && stops === script.tap) {
        tapped = true;
        const before = (await tr()).filter((x) => x.startsWith('scene|')).length;
        const slip = await page.evaluate(() => { const s = window.lxEngine.inst.board.c, first = s.order[0]; s.focus(first); return first; });
        await page.waitForTimeout(900);
        const at = await page.$eval(`.tl-cs-slip[data-id="${slip}"]`, (e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
        await page.mouse.click(at[0], at[1]);
        await page.waitForTimeout(1200);
        const t2 = await tr();
        if (!t2.some((x) => x.startsWith('nav|点了一项'))) fails.push('tapping a conclusion did not go to its scene');
        if (t2.filter((x) => x.startsWith('scene|')).length <= before) fails.push('tapping a conclusion did not replay its scene');
        await page.screenshot({ path: join(out, `${name}-${width}x${HEIGHT}-tap.png`) });
        continue;
      }
      await page.click(NEXT);
      await page.waitForTimeout(250);
      const g = await frame(page);
      g.bad.filter((b) => b.startsWith('board')).forEach((b) => fails.push(`after next ${stops}: ${b}`));
      continue;
    }
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1400);
  const trace = await page.evaluate(() => window.lxTrace);
  await page.screenshot({ path: join(out, `${name}-${width}x${HEIGHT}-end.png`) });
  const kinds = (k) => trace.filter((x) => x.kind === k).map((x) => x.text);
  if (!trace.some((x) => x.kind === 'done')) fails.push('lecture did not finish');
  if (await page.$eval(REPLAY, (b) => b.hidden)) fails.push('replay did not come at the end');
  if (!(await page.$eval(NEXT, (b) => b.hidden))) fails.push('下一幕 was still there after the last scene');
  if (!kinds('scene')[0] || !kinds('scene')[0].includes('读题')) fails.push('the question was not read first');
  const acts = kinds('act');
  if (script.wrong) {
    if (!acts.some((a) => a.includes('第 1 次答错') && a.includes('再答一次'))) fails.push('no retry after the first wrong answer');
    if (!acts.some((a) => a.includes('第 2 次答错') && a.includes('演示'))) fails.push('no demo after the second wrong answer');
  }
  if (script.back && !kinds('nav').some((n) => n.startsWith('回到上一幕'))) fails.push('上一幕 was not pressed');
  if (script.skip && !kinds('scene').some((n) => n.includes('跳过'))) fails.push('no scene was skipped');
  const flights = kinds('call').filter((c) => c.includes('飞过来'));
  if (!flights.length) fails.push('no conclusion flew to the board');
  const folds = kinds('call').filter((c) => c.includes('下台：飞向'));
  if (script.fold && !folds.length) fails.push('nothing folded into the board');
  const end = await frame(page);
  end.bad.forEach((b) => fails.push('end: ' + b));
  console.log(`${name} @${width}x${HEIGHT} (${screen}): ${stops} stops, ${kinds('scene').length} scenes, ${kinds('say').length} lines, ${flights.length} flights, ${folds.length} folds, ${wheelStops} stops with a wheel, smallest main scale ${Math.round(minScale * 100)}%, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('  main holds: ' + [...stages].join(' | '));
  if (errors.length) fails.push('console: ' + errors.join(' / '));
  console.log(fails.length ? '  FAIL ' + fails.join('; ') : '  PASS');
  await close();
  return fails.length === 0;
}

let ok = true;
for (const name of Object.keys(SCRIPTS)) if (!only || only === name) ok = (await runOne(name)) && ok;
process.exit(ok ? 0 : 1);
