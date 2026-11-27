// Checks the narration bar prototype at one width: layout of every bar on
// the page, then the main bar's logic driven the way a workflow and a
// child would (say, skip, go back, restart, pause, a line that fails,
// speed, mute, scenes, set, stop), the subtitle growing smoothly, and,
// with `full`, the demo lecture played through with scene jumps, a pause
// and the child's turn. Prints PASS or the list of failures.
// Usage: node narrtest.mjs <width> [full]
import { openPage } from './serve.mjs';

const [, , width = '1024', mode = ''] = process.argv;
const { page, errors, close } = await openPage('proto/c11-narration.html', width, 1000, 1);
await page.waitForSelector('body[data-ready="yes"]', { timeout: 20000 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const drain = () => page.evaluate(() => window.tlEvents.splice(0));
const sleep = (ms) => page.waitForTimeout(ms);
const HOSTS = { main: 'nb-main', long: 'g-long', pause: 'g-pause', turn: 'g-turn', fail: 'g-fail', mute: 'g-mute', rate: 'g-rate' };
const bar = (name, body) => page.evaluate(([n, f]) => new Function('b', f)(window.tlBars[n]), [name, body]);
const state = (name) => page.$eval(`#${HOSTS[name]} .pl-nb`, (e) => e.getAttribute('data-state'));
const btn = (name, act) => `#${HOSTS[name]} [data-act="${act}"]`;
const subtitle = (name) => page.$eval(`#${HOSTS[name]} .pl-nb-lines`, (box) => { const all = box.querySelectorAll('.pl-nb-line:not(.pl-nb-leave)'); return all.length ? all[all.length - 1].textContent : ''; });
const click = async (sel) => {
  await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
  const b = await (await page.$(sel)).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(60);
};
async function until(fn, ms, step = 50) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}
// Events of the main bar only; the gallery's bars emit their own.
const events = () => page.evaluate(() => window.tlEvents.filter((e) => e.from === 'main'));
const waitEvent = (pred, ms) => until(async () => (await events()).find(pred), ms);
const countEvents = async (pred) => (await events()).filter(pred).length;
// Starts a line and keeps its promise's result on the page.
const say = (name, id) => page.evaluate(([n, i]) => { window.__said = null; window.tlBars[n].say(i).then((r) => { window.__said = r; }); }, [name, id]);
const said = () => page.evaluate(() => window.__said);
const main = (act) => btn('main', act);

// ---------- layout ----------
await click('[data-cmd="clear"]');
const layout = await page.evaluate(() => {
  const out = { scroll: document.documentElement.scrollWidth - window.innerWidth, bars: [] };
  document.querySelectorAll('.pl-nb').forEach((el) => {
    const r = el.getBoundingClientRect(), host = el.parentElement.getBoundingClientRect();
    const btns = [...el.querySelectorAll('.pl-nb-btn')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
    const parts = ['.pl-nb-who', '.pl-nb-say', '.pl-nb-scene', '.pl-nb-transport', '.pl-nb-ratebox'].map((s) => el.querySelector(s)).filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
    const inside = (a) => a.left >= r.left - 0.5 && a.right <= r.right + 0.5 && a.top >= r.top - 0.5 && a.bottom <= r.bottom + 0.5;
    const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    let clash = 0;
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlap(parts[i], parts[j])) clash++;
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) if (overlap(btns[i], btns[j])) clash++;
    const lines = el.querySelector('.pl-nb-lines').getBoundingClientRect(), track = el.querySelector('.pl-nb-track').getBoundingClientRect();
    const line = el.querySelector('.pl-nb-line');
    out.bars.push({
      id: el.parentElement.id, inHost: r.left >= host.left - 0.5 && r.right <= host.right + 0.5,
      small: btns.filter((b) => b.width < 43.5 || b.height < 43.5).length, outside: [...btns, ...parts].filter((p) => !inside(p)).length, clash,
      lineOut: line ? line.scrollWidth > line.clientWidth + 1 || line.getBoundingClientRect().bottom > lines.bottom + 0.5 : false,
      trackUnder: track.top >= lines.bottom - 0.5
    });
  });
  return out;
});
ok(layout.scroll <= 0, `page scrolls sideways by ${layout.scroll}px`);
for (const b of layout.bars) {
  ok(b.inHost, `${b.id}: bar wider than its place`);
  ok(b.small === 0, `${b.id}: ${b.small} buttons smaller than 44px`);
  ok(b.outside === 0, `${b.id}: ${b.outside} parts stick out of the bar`);
  ok(b.clash === 0, `${b.id}: ${b.clash} parts overlap`);
  ok(!b.lineOut, `${b.id}: subtitle runs out of its box`);
  ok(b.trackUnder, `${b.id}: progress line not under the subtitle`);
}

// ---------- say and end ----------
await drain();
await bar('main', 'b.scene(0, 3)');
await say('main', 's2-4');
ok(!!await waitEvent((e) => e.type === 'lineStart' && e.id === 's2-4' && e.replay === false, 1500), 'say: no lineStart');
ok(['starting', 'speaking'].includes(await state('main')), 'say: bar not speaking');
ok((await subtitle('main')).startsWith('对了'), 'say: subtitle not shown');
ok(!!await waitEvent((e) => e.type === 'lineEnd' && e.id === 's2-4' && e.by === 'end', 4000), 'say: no lineEnd at the end');
ok((await said())?.by === 'end', 'say: promise not settled with end');
ok(await state('main') === 'idle', 'say: not idle after the line');

// ---------- skip ----------
await drain();
await say('main', 's1-1');
await sleep(500);
await click(main('nextLine'));
ok((await waitEvent((e) => e.type === 'lineEnd' && e.id === 's1-1', 400))?.by === 'skip', 'skip: lineEnd not by skip');
ok((await said())?.by === 'skip', 'skip: promise not settled with skip');
ok(await bar('main', 'return b.audio.paused'), 'skip: audio still playing');
ok(await page.$eval(main('nextLine'), (e) => e.disabled), 'skip: next line enabled with nothing playing');

// ---------- back: replay the previous line, then the current one ----------
await drain();
await say('main', 's2-2');
await waitEvent((e) => e.type === 'lineEnd' && e.id === 's2-2', 4000);
await say('main', 's2-4');
await sleep(400);
await click(main('prevLine'));
ok((await waitEvent((e) => e.type === 'lineBack', 300))?.id === 's2-2', 'back: did not go to the previous line');
ok(!!await waitEvent((e) => e.type === 'lineStart' && e.id === 's2-2' && e.replay, 300), 'back: previous line not replayed');
ok(await page.$eval('#nb-main .pl-nb-flag', (e) => !e.hidden && e.textContent === '回听'), 'back: no 回听 flag');
ok(!!await until(async () => (await countEvents((e) => e.type === 'lineStart' && e.id === 's2-4' && e.replay === false)) === 2, 4500), 'back: did not come back to the current line');
ok(!!await waitEvent((e) => e.type === 'lineEnd' && e.id === 's2-4' && e.by === 'end', 3000), 'back: current line did not end');
ok((await countEvents((e) => e.type === 'lineEnd')) === 2, 'back: a replayed line sent a lineEnd');
// Back while idle says the last line again, without a lineEnd.
await drain();
await click(main('prevLine'));
ok(!!await waitEvent((e) => e.type === 'lineStart' && e.id === 's2-4' && e.replay, 300), 'back when idle: last line not said again');
await until(() => state('main').then((s) => s === 'idle'), 3000);
ok((await countEvents((e) => e.type === 'lineEnd')) === 0, 'back when idle: a replay sent lineEnd');
// Back late in a line restarts it.
await drain();
await say('main', 'long');
await sleep(2600);
await click(main('prevLine'));
ok((await waitEvent((e) => e.type === 'lineBack', 300))?.id === 'long', 'restart: did not restart the line after 2s');
ok((await bar('main', 'return b.audio.currentTime')) < 0.8, 'restart: audio not back at the start');
await click(main('nextLine'));

// ---------- pause ----------
await drain();
await say('main', 's1-1');
await sleep(600);
await click(main('toggle'));
ok(!!await waitEvent((e) => e.type === 'pause', 200), 'pause: no event');
ok(await state('main') === 'paused', 'pause: state');
const t1 = await bar('main', 'return b.audio.currentTime');
await sleep(500);
ok(Math.abs((await bar('main', 'return b.audio.currentTime')) - t1) < 0.05, 'pause: audio kept playing');
ok((await page.$eval(main('toggle'), (e) => e.getAttribute('aria-label'))) === '继续', 'pause: button not 继续');
await click(main('toggle'));
ok(!!await waitEvent((e) => e.type === 'resume', 200), 'resume: no event');
await sleep(300);
ok((await bar('main', 'return b.audio.currentTime')) > t1 + 0.1, 'resume: audio did not go on');
await click(main('nextLine'));

// ---------- the child's turn ----------
await bar('main', 'b.say("s2-3"); b.skip(); b.wait(true)');
ok(await state('main') === 'waiting', 'wait: state');
ok(await page.$eval('#nb-main .pl-nb-flag', (e) => !e.hidden && e.textContent === '轮到你了'), 'wait: no 轮到你了');
ok(await page.$eval(main('nextLine'), (e) => e.disabled), 'wait: next line enabled');
await bar('main', 'b.wait(false)');

// ---------- a line that does not play ----------
await drain();
await say('main', 'broken');
ok((await waitEvent((e) => e.type === 'lineFail', 3000))?.id === 'broken', 'fail: no lineFail');
ok(await state('main') === 'failed', 'fail: state');
ok((await page.$eval(main('toggle'), (e) => e.getAttribute('aria-label'))) === '再听这一句', 'fail: button not 再听');
await sleep(400);
ok((await said()) === null, 'fail: the workflow was let go on');
await click(main('toggle'));
ok(!!await waitEvent((e) => e.type === 'lineRetry', 300), 'fail: no lineRetry');
await sleep(800);
await click(main('nextLine'));
ok((await said())?.by === 'skip', 'fail: next line did not let the workflow go on');

// ---------- speed ----------
await drain();
await click(main('rate'));
ok(await page.$eval('#nb-main .pl-nb-menu', (e) => !e.hidden), 'rate: menu did not open');
const menuBox = await page.$eval('#nb-main .pl-nb-menu', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top }; });
ok(menuBox.l >= 0 && menuBox.r <= Number(width) && menuBox.t >= 0, 'rate: menu off screen');
await click('#nb-main .pl-nb-opt[data-rate="1.25"]');
ok((await waitEvent((e) => e.type === 'rate', 200))?.value === 1.25, 'rate: no event');
ok(await page.$eval('#nb-main .pl-nb-menu', (e) => e.hidden), 'rate: menu still open');
ok((await page.$eval(main('rate'), (e) => e.textContent)).startsWith('1.25×'), 'rate: chip text');
await say('main', 's1-2');
await sleep(300);
ok((await bar('main', 'return b.audio.playbackRate')) === 1.25, 'rate: audio rate not applied');
ok(await bar('main', 'return b.audio.preservesPitch !== false'), 'rate: pitch not kept');
await click(main('rate'));
await page.mouse.click(5, 5);
await sleep(60);
ok(await page.$eval('#nb-main .pl-nb-menu', (e) => e.hidden), 'rate: tap outside did not close');
await bar('main', 'b.skip(); b.rate(1)');

// ---------- mute ----------
await drain();
await click('#mute-switch');
await say('main', 's2-4');
await sleep(200);
ok(await bar('main', 'return b.audio.muted'), 'mute: audio not muted');
ok(await page.$eval('#nb-main .pl-nb-mute', (e) => !e.hidden), 'mute: no sign');
ok(!!await waitEvent((e) => e.type === 'lineEnd' && e.id === 's2-4' && e.by === 'end', 3500), 'mute: line did not go on silently');
await click('#mute-switch');

// ---------- scenes ----------
await drain();
await bar('main', 'b.scene(0, 3)');
ok(!(await page.$eval(main('prevScene'), (e) => e.disabled)), 'scene: previous scene disabled in the first scene');
ok(!(await page.$eval(main('nextScene'), (e) => e.disabled)), 'scene: next scene disabled');
await bar('main', 'b.scene(2, 3)');
ok(await page.$eval(main('nextScene'), (e) => e.disabled), 'scene: next scene enabled in the last scene');
const shown = await page.$eval('#nb-main', (h) => [...h.querySelectorAll('.pl-nb-num, .pl-nb-where')].filter((e) => e.offsetParent).map((e) => e.textContent));
ok(shown.length === 1 && shown[0] === '3/3 幕', `scene: number shown ${JSON.stringify(shown)}`);
if (await page.$eval('#nb-main .pl-nb-dots', (e) => !!e.offsetParent)) ok((await page.$$eval('#nb-main .pl-nb-dots i', (d) => d.map((x) => x.className).join(','))) === 'pl-nb-done,pl-nb-done,pl-nb-now', 'scene: dots');
await click(main('prevScene'));
ok((await waitEvent((e) => e.type === 'prevScene', 200))?.scene === 2, 'scene: no prevScene event from the main bar with its scene');

// ---------- set: no animation ----------
await bar('main', 'b.set({ scene: [1, 3], line: "s2-3", waiting: true })');
const moving = () => page.evaluate(() => document.querySelector('#nb-main .pl-nb').getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && !(a.animationName || '').includes('breathe')).map((a) => a.animationName || a.transitionProperty));
const still = await page.evaluate(() => {
  const el = document.querySelector('#nb-main .pl-nb');
  return { lines: el.querySelectorAll('.pl-nb-line').length, anim: el.querySelectorAll('.pl-nb-enter, .pl-nb-leave').length };
});
const m0 = await moving();
ok(m0.length === 0, `set: animations running: ${m0.join(',')}`);
ok(still.lines === 1 && still.anim === 0, 'set: subtitle animated');
ok(await state('main') === 'waiting', 'set: not waiting');
await sleep(300);
const m1 = await moving();
ok(m1.length === 0, `set: animations played afterwards: ${m1.join(',')}`);

// ---------- stop ----------
await drain();
await say('main', 's1-1');
await sleep(300);
await bar('main', 'b.stop()');
await sleep(50);
ok((await said())?.by === 'stop', 'stop: promise not settled with stop');
ok((await countEvents((e) => e.type === 'lineEnd')) === 0, 'stop: sent lineEnd');
ok(await bar('main', 'return b.audio.paused'), 'stop: audio still playing');

// ---------- the subtitle grows smoothly ----------
await bar('long', 'b.set({ scene: [1, 3], line: "s2-4" })');
await page.$eval('#g-long', (e) => e.scrollIntoView({ block: 'center' }));
await sleep(100);
const grow = await page.evaluate(() => new Promise((res) => {
  const b = window.tlBars.long, el = b.el;
  const hs = [];
  b.say('long');
  const t0 = performance.now();
  (function f() {
    hs.push(el.getBoundingClientRect().height);
    if (performance.now() - t0 < 800) requestAnimationFrame(f);
    else { b.stop(); res({ hs, lines: Math.round(b.currentLineEl().offsetHeight / parseFloat(getComputedStyle(b.linesBox).lineHeight)) }); }
  })();
}));
const steps = grow.hs.slice(1).map((h, i) => h - grow.hs[i]);
const growth = grow.hs[grow.hs.length - 1] - grow.hs[0];
ok(steps.every((d) => d >= -0.5), 'grow: bar height went down while growing');
ok(Math.max(...steps) < 8, `grow: bar height jumped ${Math.max(...steps).toFixed(1)}px in one frame`);
if (grow.lines > 2) ok(growth > 10, `grow: bar grew ${growth.toFixed(1)}px for ${grow.lines} lines (${grow.hs.length} frames)`);

// ---------- the gallery ----------
await page.$eval('#g-fail', (e) => e.scrollIntoView({ block: 'center' }));
ok(!!await until(() => state('fail').then((s) => s === 'failed'), 2000), 'gallery: broken line not failed');
ok(await state('pause') === 'paused', 'gallery: pause');
ok(await state('turn') === 'waiting', 'gallery: turn');

// ---------- the demo lecture ----------
if (mode === 'full') {
  await click('[data-cmd="clear"]');
  await drain();
  await click('#run-btn');
  ok(!!await waitEvent((e) => e.type === 'lineStart' && e.id === 's1-1', 2500), 'run: first line did not start');
  await click(main('nextScene'));
  ok(!!await waitEvent((e) => e.type === 'lineStart' && e.id === 's2-1', 1500), 'run: next scene did not start its first line');
  ok((await page.$$eval('#mk-items li', (l) => l.length)) === 1, 'run: next scene did not lay out the end of scene 1');
  await sleep(1500);
  await drain();
  await click(main('prevScene'));
  ok(!!await waitEvent((e) => e.type === 'lineStart' && e.id === 's1-1', 1500), 'run: previous scene did not start again');
  ok((await page.$$eval('#mk-items li', (l) => l.length)) === 0, 'run: previous scene did not clear the screen');
  // The child pauses once while a conclusion is due, and later takes their turn.
  await waitEvent((e) => e.type === 'lineStart' && e.id === 's1-2', 8000);
  await sleep(600);
  await click(main('toggle'));
  const t = await bar('main', 'return b.audio.currentTime');
  await sleep(4000);
  ok((await page.$$eval('#mk-items li', (l) => l.length)) === 0, 'run: the workflow went on while paused');
  ok(Math.abs((await bar('main', 'return b.audio.currentTime')) - t) < 0.05, 'run: the line went on while paused');
  await click(main('toggle'));
  ok(!!await until(() => state('main').then((s) => s === 'waiting'), 45000), 'run: never came to the child\'s turn');
  await sleep(1200);
  ok(!(await waitEvent((e) => e.type === 'lineStart' && e.id === 's2-4', 10)), 'run: went on without the child');
  await click('#mk-tap');
  ok(!!await waitEvent((e) => e.type === 'lineStart' && e.id === 's2-4', 2000), 'run: did not go on after the child\'s tap');
  ok(!!await until(() => page.evaluate(() => window.tlRun.done === true), 30000), 'run: did not reach the end');
  ok((await page.$$eval('#mk-items li', (l) => l.length)) === 3, 'run: not three conclusions at the end');
  const order = (await events()).filter((e) => e.type === 'lineEnd').map((e) => e.id);
  ok(order.join(',') === 's1-1,s1-2,s2-1,s2-2,s2-3,s2-4,s3-1,s3-2', `run: lines ended out of order: ${order.join(',')}`);
}

// The demo's broken line points at a missing file on purpose.
const real = errors.filter((e) => !/404/.test(e));
ok(real.length === 0, 'console errors: ' + real.join(' | '));
console.log(fails.length ? `FAIL ${width}\n- ` + fails.join('\n- ') : `PASS ${width}`);
await close();
