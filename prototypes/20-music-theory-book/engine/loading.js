/* ============================================================
   The loading screen. Before an item starts it covers the page,
   prepares everything the item needs — whatever the page adds with
   need(): the item's files, its components and what they preload, its
   narration — and then the fonts, shows how far it is, and ends with a
   "开始" button. That tap is the gesture that lets phones play sound, so
   the first sound after it plays on time; onStart() hands that tap to the
   page. It shows before any item's theme is known, so it uses the
   theme's constants where a page has set them and its own values
   otherwise.

   The fonts come last because the components' stylesheets, which declare
   their fonts, go on the page during the tasks. A browser fetches a
   declared font only when text first uses it, so a component built on
   开始 would measure its text in a fallback font; every declared face
   that covers basic Latin (or names no range) is therefore loaded
   before 开始 appears. Faces for other scripts still load as text needs
   them.
   ============================================================ */
var PlayerLoading = (function () {
  var CSS = [
    '.pl-curtain{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;',
    'background:radial-gradient(70% 60% at 18% 8%,color-mix(in srgb,var(--th-frame-glow-a,#ffc496) 60%,transparent),transparent 70%),radial-gradient(60% 55% at 88% 12%,color-mix(in srgb,var(--th-frame-glow-b,#c4b0ff) 50%,transparent),transparent 70%),radial-gradient(90% 70% at 50% 110%,color-mix(in srgb,var(--th-frame-glow-c,#ffe2be) 75%,transparent),transparent 70%),var(--th-frame,#f6efe4);',
    'transition:opacity .5s,visibility .5s;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;color:var(--th-caption,#2a2118)}',
    '.pl-curtain.pl-gone{opacity:0;visibility:hidden}',
    '.pl-box{width:min(100%,360px);display:grid;gap:16px;justify-items:center;text-align:center}',
    '.pl-title{font-size:22px;font-weight:800;margin:0}',
    '.pl-bar{width:100%;height:10px;border-radius:5px;background:color-mix(in srgb,var(--th-shade,#46301a) 12%,transparent);overflow:hidden;box-shadow:inset 0 1px 2px color-mix(in srgb,var(--th-shade,#46301a) 20%,transparent)}',
    '.pl-fill{height:100%;width:0;border-radius:5px;background:linear-gradient(90deg,var(--th-glass-accent,#a98bff),var(--th-accent,#7b4dff));box-shadow:0 0 12px color-mix(in srgb,var(--th-accent,#7b4dff) 60%,transparent);transition:width .25s ease-out}',
    '.pl-fill.pl-unknown{width:35%;animation:pl-slide 1.1s ease-in-out infinite alternate}',
    '@keyframes pl-slide{from{transform:translateX(-10%)}to{transform:translateX(200%)}}',
    '.pl-note{font-size:14px;color:var(--th-ink-soft,#6b5238);min-height:1.6em;margin:0}',
    '.pl-start{font:inherit;font-size:18px;font-weight:800;min-width:160px;min-height:56px;padding:0 28px;border:0;border-radius:999px;cursor:pointer;color:var(--th-light,#fff);',
    'background:radial-gradient(circle at 35% 30%,var(--th-glass-accent,#a98bff),var(--th-accent,#7b4dff));box-shadow:0 12px 26px -10px var(--th-accent,#7b4dff),0 0 0 4px color-mix(in srgb,var(--th-frame-glow-c,#ffe2be) 50%,transparent);animation:pl-pop .45s cubic-bezier(.2,1.6,.4,1) both}',
    '.pl-start:active{transform:scale(.96)}',
    '.pl-start:focus{outline:none}.pl-start:focus-visible{outline:3px solid var(--th-accent,#7b4dff);outline-offset:4px}',
    '@keyframes pl-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.pl-curtain,.pl-fill,.pl-start{transition-duration:.01ms;animation-duration:.01ms}.pl-fill.pl-unknown{animation:none}}'
  ].join('');
  var tasks = [], starters = [];

  // Adds something to prepare before 开始: task(progress) returns a
  // promise; progress(fraction 0..1 or null when unknown, text) reports
  // how far it is.
  function need(task) { tasks.push(task); }
  function onStart(fn) { starters.push(fn); }

  // Loads every declared face that covers basic Latin; a face that fails
  // leaves its text in the next font of its stack.
  function fonts() {
    var set = document.fonts;
    if (!set || !set.forEach) return Promise.resolve();
    var faces = [];
    set.forEach(function (f) {
      var range = String(f.unicodeRange || '');
      if (f.status === 'unloaded' && (!range || /U\+0+(-|,|$)/i.test(range) || /U\+0+-0*[0-9a-f]{2,}/i.test(range))) faces.push(f.load().catch(function () {}));
    });
    return Promise.all(faces).then(function () { return set.ready; });
  }

  function show() {
    var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    var el = document.createElement('div'); el.className = 'pl-curtain'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '正在准备');
    el.innerHTML = '<div class="pl-box"><p class="pl-title">正在准备这道题</p><div class="pl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="pl-fill pl-unknown"></div></div><p class="pl-note" aria-live="polite"></p><div class="pl-action"></div></div>';
    document.body.appendChild(el);
    var bar = el.querySelector('.pl-bar'), fill = el.querySelector('.pl-fill'), note = el.querySelector('.pl-note'), action = el.querySelector('.pl-action');
    var title = el.querySelector('.pl-title');

    function progress(f, text) {
      if (f === null || f === undefined) fill.classList.add('pl-unknown');
      else { fill.classList.remove('pl-unknown'); fill.style.width = Math.round(f * 100) + '%'; bar.setAttribute('aria-valuenow', String(Math.round(f * 100))); }
      if (text) note.textContent = text;
    }

    // The tasks share the bar equally.
    function run() {
      action.innerHTML = '';
      title.textContent = '正在准备这道题';
      progress(null, '');
      var parts = tasks.map(function () { return 0; });
      function part(i) {
        return function (f, text) {
          if (f === null || f === undefined) { if (text) note.textContent = text; return; }
          parts[i] = f / tasks.length;
          progress(parts.reduce(function (a, b) { return a + b; }, 0), text);
        };
      }
      Promise.all(tasks.map(function (t, i) { return t(part(i)); })).then(function () {
        note.textContent = '准备字体';
        return fonts();
      }).then(function () {
        progress(1, '准备好了');
        title.textContent = '准备好了';
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pl-start'; b.textContent = '开始';
        b.addEventListener('click', function () {
          el.classList.add('pl-gone');
          starters.forEach(function (fn) { fn(); });
        });
        action.appendChild(b);
        b.focus({ preventScroll: true });
      }, function (e) {
        if (window.console) console.error(e);
        title.textContent = '没有准备好';
        progress(0, '网络可能断了，请再试一次');
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pl-start'; b.textContent = '再试一次';
        b.addEventListener('click', run);
        action.appendChild(b);
      });
    }
    run();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else setTimeout(show, 0);
  return { show: show, need: need, onStart: onStart };
})();
