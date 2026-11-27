/* ============================================================
   Narration bar. The player's own strip along the bottom of a lecture:
   the teacher's portrait (no name), the line being said as a subtitle
   with a thin line showing how far it has played, and the child's
   buttons for this line only: pause or continue, replay this line, and
   the speed on a vertical slider. Which buttons show is set by the
   workflow file. There is no way to step to another line or scene: the
   workflow owns the steps.

   The player tells it which line to say (say returns a promise that
   settles when the line is over), when it is the child's turn (turn),
   and while the bar is paused the player waits (whenRunning).
   A line that cannot play (blocked, broken, not started in 8 seconds,
   taken away by the system) stays on screen and waits for the child to
   tap continue; it is never skipped. Muted, lines still play silently
   so the lecture keeps its pace.

   Each line is a recording played by one HTMLAudioElement, so a slower
   or faster speed keeps the pitch, and the phone's silent switch does
   not mute it. The portrait's halo follows a loudness envelope measured
   when the recordings are prepared.

   Commands: say, turn, flag, pause, resume, replay, rate, mute, set,
   stop, clear, unlock (the player calls it on the child's touches).
   Events (via onEvent): lineStart, lineEnd, lineFail, lineRetry,
   replay, pause, resume, rate.
   ============================================================ */
var NarrationBar = (function () {
  var RATE_MIN = 0.6, RATE_MAX = 1.4, RATE_STEP = 0.05, RATE_SNAP = 0.03;
  var START_TIMEOUT_MS = 8000;
  var ENV_STEP_S = 0.04;
  var INTERRUPT_CHECK_MS = 300;
  var FADE_OUT_MS = 340;
  var LINE_HEIGHT = 1.55;
  var MIN_LINES = 2;
  var SILENT = null;

  var CSS = [
    '.pl-nb{--nb-glass:rgba(24,18,44,.86);--nb-edge:rgba(255,255,255,.10);--nb-text:#fbf8f3;--nb-soft:rgba(251,248,243,.66);--nb-glow:#a98bff;--nb-btn:#6d3cf0;',
    'container-type:inline-size;position:relative;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;color:var(--nb-text)}',
    '.pl-nb-body{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;padding:12px 14px 12px 12px;border-radius:22px;background:var(--nb-glass);',
    'box-shadow:0 18px 40px -18px rgba(20,10,40,.7),inset 0 0 0 1px var(--nb-edge);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2)}',
    '.pl-nb-face{--lv:0;position:relative;width:56px;height:56px;border-radius:50%;flex:none}',
    '.pl-nb-face::before{content:"";position:absolute;inset:-6px;border-radius:50%;background:radial-gradient(circle,rgba(169,139,255,.75),rgba(169,139,255,0) 70%);opacity:calc(.15 + var(--lv) * .85);transform:scale(calc(.86 + var(--lv) * .22));transition:opacity .08s linear}',
    '.pl-nb-face img{position:relative;width:100%;height:100%;border-radius:50%;object-fit:cover;background:#3a2f5c;box-shadow:0 0 0 2px rgba(255,255,255,.22)}',
    '.pl-nb[data-state="turn"] .pl-nb-face::before{animation:pl-nb-breathe 2.4s ease-in-out infinite}',
    '@keyframes pl-nb-breathe{0%,100%{opacity:.2;transform:scale(.9)}50%{opacity:.95;transform:scale(1.08)}}',
    '.pl-nb-say{min-width:0;display:grid;gap:6px}',
    '.pl-nb-meta{display:flex;gap:8px;min-height:20px;align-items:center;flex-wrap:wrap}',
    '.pl-nb-flag,.pl-nb-mute{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;line-height:1;padding:4px 9px;border-radius:999px;background:rgba(169,139,255,.22);color:#e5dcff}',
    '.pl-nb-flag[hidden],.pl-nb-mute[hidden]{display:none}',
    '.pl-nb-flag{animation:pl-nb-pop .35s cubic-bezier(.2,1.5,.4,1) both}',
    '.pl-nb-flag[data-kind="fail"]{background:rgba(232,110,90,.25);color:#ffd9d0}',
    '.pl-nb-mute svg{width:14px;height:14px}',
    '@keyframes pl-nb-pop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}',
    '.pl-nb-lines{position:relative;overflow:hidden;transition:height .52s cubic-bezier(.6,0,.25,1)}',
    '.pl-nb-lines.pl-nb-still{transition:none}',
    '.pl-nb-line{margin:0;font-size:17px;line-height:' + LINE_HEIGHT + ';letter-spacing:.01em;text-wrap:pretty}',
    '.pl-nb-line.pl-nb-enter{animation:pl-nb-up .52s cubic-bezier(.6,0,.25,1) both}',
    '.pl-nb-line.pl-nb-leave{position:absolute;left:0;right:0;top:0;animation:pl-nb-out .34s ease-in both}',
    '@keyframes pl-nb-up{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}',
    '@keyframes pl-nb-out{to{transform:translateY(-12px);opacity:0}}',
    '.pl-nb-track{height:3px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}',
    '.pl-nb-fill{display:block;height:100%;background:var(--nb-glow);box-shadow:0 0 8px var(--nb-glow);transform-origin:left;transform:scaleX(0)}',
    '.pl-nb-ctl{display:flex;align-items:center;gap:6px}',
    '.pl-nb-btn{position:relative;display:grid;justify-items:center;align-content:center;gap:2px;min-width:48px;min-height:52px;padding:4px 6px;border:0;border-radius:14px;background:transparent;color:var(--nb-text);font:inherit;font-size:11px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.pl-nb-btn:hover{background:rgba(255,255,255,.08)}',
    '.pl-nb-btn:active{transform:scale(.95)}',
    '.pl-nb-btn:focus{outline:none}.pl-nb-btn:focus-visible{outline:2px solid var(--nb-glow);outline-offset:2px}',
    '.pl-nb-btn svg{width:22px;height:22px}',
    '.pl-nb-btn span{color:var(--nb-soft)}',
    '.pl-nb-btn[disabled]{opacity:.35;cursor:default}',
    '.pl-nb-btn .f{fill:currentColor}.pl-nb-btn .s{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}',
    '.pl-nb-main{min-width:56px}',
    '.pl-nb-disc{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#8f6bff,var(--nb-btn));box-shadow:0 8px 18px -8px var(--nb-btn),inset 0 1px 0 rgba(255,255,255,.25)}',
    '.pl-nb-main span{display:none}',
    '.pl-nb-rate b{font-size:15px;font-variant-numeric:lining-nums tabular-nums;line-height:22px;color:var(--nb-text)}',
    '.pl-nb-ratebox{position:relative}',
    '.pl-nb-pop{position:absolute;right:-4px;bottom:calc(100% + 12px);z-index:5;width:76px;padding:14px 0 12px;border-radius:18px;background:var(--nb-glass);box-shadow:0 18px 40px -14px rgba(20,10,40,.8),inset 0 0 0 1px var(--nb-edge);',
    '-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);display:grid;justify-items:center;gap:8px;animation:pl-nb-rise .32s cubic-bezier(.6,0,.25,1) both}',
    '.pl-nb-pop[hidden]{display:none}',
    '@keyframes pl-nb-rise{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}',
    '.pl-nb-pop small{font-size:11px;font-weight:700;color:var(--nb-soft)}',
    '.pl-nb-slider{position:relative;width:44px;height:168px;touch-action:none;cursor:pointer;border-radius:12px}',
    '.pl-nb-slider:focus{outline:none}.pl-nb-slider:focus-visible{outline:2px solid var(--nb-glow);outline-offset:2px}',
    '.pl-nb-rail{position:absolute;left:50%;top:10px;bottom:10px;width:6px;margin-left:-3px;border-radius:3px;background:rgba(255,255,255,.14)}',
    '.pl-nb-railfill{position:absolute;left:0;right:0;bottom:0;border-radius:3px;background:linear-gradient(0deg,#6d3cf0,#a98bff);box-shadow:0 0 8px rgba(169,139,255,.6)}',
    '.pl-nb-normal{position:absolute;left:8px;right:8px;height:2px;margin-top:-1px;border-radius:1px;background:rgba(255,255,255,.4)}',
    '.pl-nb-thumb{position:absolute;left:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#fbf8f3;box-shadow:0 3px 10px rgba(0,0,0,.4),0 0 0 4px rgba(169,139,255,.35)}',
    '.pl-nb-value{font-size:15px;font-weight:800;font-variant-numeric:lining-nums tabular-nums}',
    '@container (max-width:560px){.pl-nb-body{gap:10px;padding:10px}.pl-nb-face{width:44px;height:44px}.pl-nb-line{font-size:16px}.pl-nb-btn{min-width:44px;min-height:48px}.pl-nb-btn span{display:none}.pl-nb-disc{width:42px;height:42px}}',
    '@container (max-width:380px){.pl-nb-body{grid-template-columns:auto minmax(0,1fr);grid-template-areas:"face say" "ctl ctl"}.pl-nb-face{grid-area:face}.pl-nb-say{grid-area:say}.pl-nb-ctl{grid-area:ctl;justify-content:flex-end}}',
    '@media (prefers-reduced-motion:reduce){.pl-nb *,.pl-nb *::before{animation-duration:.01ms!important;transition-duration:.01ms!important}}'
  ].join('');

  var ICON = {
    play: '<path class="f" d="M8.5 5.6v12.8l10-6.4z"/>',
    pause: '<rect class="f" x="6.8" y="5.6" width="3.6" height="12.8" rx="1"/><rect class="f" x="13.6" y="5.6" width="3.6" height="12.8" rx="1"/>',
    replay: '<path class="s" d="M6 12.4a6.2 6.2 0 1 0 1.9-4.6"/><path class="s" d="M5.6 4.6v4.2h4.2"/>',
    muted: '<path class="f" d="M4 9.5h3l4-3.5v12l-4-3.5H4z"/><path class="s" d="M15 9.2l5 5.6M20 9.2l-5 5.6"/>'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>'; }
  function rateText(r) { return (Math.round(r * 100) / 100).toString() + '×'; }
  function clampRate(r) {
    r = Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) / RATE_STEP) * RATE_STEP;
    if (Math.abs(r - 1) < RATE_SNAP) r = 1;
    return Math.round(r * 100) / 100;
  }

  function injectStyle() {
    if (document.getElementById('pl-nb-style')) return;
    var s = document.createElement('style'); s.id = 'pl-nb-style'; s.textContent = CSS; document.head.appendChild(s);
  }

  function silentUrl() {
    if (SILENT) return SILENT;
    var n = 400, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    function s(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    SILENT = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    return SILENT;
  }

  // Loudness of a recording every ENV_STEP_S seconds, 0..1, scaled so the
  // loud parts of this line reach about 1.
  function envelope(buffer) {
    var data = buffer.getChannelData(0), step = Math.max(1, Math.round(buffer.sampleRate * ENV_STEP_S)), out = [];
    for (var i = 0; i < data.length; i += step) {
      var sum = 0, end = Math.min(data.length, i + step);
      for (var j = i; j < end; j++) sum += data[j] * data[j];
      out.push(Math.sqrt(sum / (end - i)));
    }
    var sorted = out.slice().sort(function (a, b) { return a - b; });
    var top = sorted[Math.floor(sorted.length * 0.95)] || 0;
    return out.map(function (x) { return top < 1e-4 ? 0 : Math.min(1, x / top); });
  }

  // Downloads every line's recording ({id, text, url}) and measures its
  // length and loudness, as the loading screen does before a lecture.
  function prepare(lines, onProgress) {
    var C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ctx = new C(1, 2, 44100);
    var done = 0;
    return Promise.all(lines.map(function (l) {
      return fetch(l.url).then(function (r) {
        if (!r.ok) throw new Error('narration ' + l.url + ' ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        var url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
        return new Promise(function (res, rej) { ctx.decodeAudioData(buf.slice(0), res, rej); }).then(function (ab) {
          done++; if (onProgress) onProgress(done / lines.length, '旁白 ' + done + ' / ' + lines.length);
          return { id: l.id, text: l.text, url: url, duration: ab.duration, env: envelope(ab) };
        });
      });
    }));
  }

  function Bar(host, options) {
    injectStyle();
    this.host = host;
    this.o = Object.assign({ portrait: '', controls: ['pause', 'replay', 'rate'], lines: [], rate: 1, muted: false, onEvent: function () {} }, options);
    this.lines = {};
    var self = this;
    this.o.lines.forEach(function (l) { self.lines[l.id] = l; });
    this.current = null; this.pending = null; this.last = null;
    this.active = false; this.started = false; this.failed = null; this.deferred = false;
    this.paused = false; this.turnOn = false; this.flagText = null;
    this.rateValue = clampRate(this.o.rate); this.muted = !!this.o.muted;
    this.runWaiters = [];
    this.playToken = 0; this.timer = 0; this.raf = 0; this.lv = 0; this.unlocked = false; this.currentUrl = '';
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.preservesPitch = true; this.audio.webkitPreservesPitch = true;
    this.build();
    this.bindAudio();
    this.render();
  }

  Bar.prepare = prepare;
  Bar.RATE_MIN = RATE_MIN; Bar.RATE_MAX = RATE_MAX;

  Bar.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
  Bar.prototype.has = function (c) { return this.o.controls.indexOf(c) >= 0; };

  Bar.prototype.build = function () {
    var self = this;
    var el = document.createElement('div');
    el.className = 'pl-nb';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', '老师的话');
    el.innerHTML =
      '<div class="pl-nb-body">' +
        '<div class="pl-nb-face"><img alt="老师" draggable="false"></div>' +
        '<div class="pl-nb-say">' +
          '<div class="pl-nb-meta"><span class="pl-nb-flag" hidden></span><span class="pl-nb-mute" hidden>' + svg('muted') + '静音，看字幕</span></div>' +
          '<div class="pl-nb-lines" aria-live="polite"></div>' +
          '<div class="pl-nb-track"><i class="pl-nb-fill"></i></div>' +
        '</div>' +
        '<div class="pl-nb-ctl">' +
          (this.has('replay') ? '<button type="button" class="pl-nb-btn" data-act="replay" aria-label="重听这一句">' + svg('replay') + '<span>重听</span></button>' : '') +
          (this.has('pause') ? '<button type="button" class="pl-nb-btn pl-nb-main" data-act="toggle"><i class="pl-nb-disc"></i><span></span></button>' : '') +
          (this.has('rate') ?
            '<div class="pl-nb-ratebox">' +
              '<button type="button" class="pl-nb-btn pl-nb-rate" data-act="rate" aria-haspopup="true" aria-expanded="false"><b></b><span>语速</span></button>' +
              '<div class="pl-nb-pop" hidden>' +
                '<small>快</small>' +
                '<div class="pl-nb-slider" role="slider" tabindex="0" aria-orientation="vertical" aria-label="语速" aria-valuemin="' + RATE_MIN + '" aria-valuemax="' + RATE_MAX + '">' +
                  '<i class="pl-nb-rail"><i class="pl-nb-railfill"></i></i><i class="pl-nb-normal"></i><i class="pl-nb-thumb"></i>' +
                '</div>' +
                '<small>慢</small>' +
                '<b class="pl-nb-value"></b>' +
              '</div>' +
            '</div>' : '') +
        '</div>' +
      '</div>';
    this.host.innerHTML = '';
    this.host.appendChild(el);
    this.el = el;
    var q = function (s) { return el.querySelector(s); };
    this.face = q('.pl-nb-face'); this.flagEl = q('.pl-nb-flag'); this.muteEl = q('.pl-nb-mute');
    this.linesBox = q('.pl-nb-lines'); this.fillEl = q('.pl-nb-fill');
    this.btn = {}; Array.prototype.forEach.call(el.querySelectorAll('[data-act]'), function (b) { self.btn[b.getAttribute('data-act')] = b; });
    this.pop = q('.pl-nb-pop'); this.slider = q('.pl-nb-slider'); this.rateBox = q('.pl-nb-ratebox');
    q('.pl-nb-face img').src = this.o.portrait || '';
    this.linesBox.classList.add('pl-nb-still');
    this.linesBox.style.height = this.minHeight() + 'px';

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      self.press(b.getAttribute('data-act'));
    });
    if (this.slider) this.bindSlider();
    document.addEventListener('pointerdown', function (e) { if (self.pop && !self.pop.hidden && !self.rateBox.contains(e.target)) self.openPop(false); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && self.pop && !self.pop.hidden) { self.openPop(false); self.btn.rate.focus(); } });
    if (window.ResizeObserver) {
      var w = 0;
      new ResizeObserver(function () { var nw = el.getBoundingClientRect().width; if (nw !== w) { w = nw; self.fitLines(); } }).observe(el);
    }
  };

  // The speed slider: top is faster, bottom slower; dragging, tapping the
  // rail and the arrow keys all set the speed at once, the line goes on.
  Bar.prototype.bindSlider = function () {
    var self = this, s = this.slider, dragging = false;
    function at(clientY) {
      var r = s.getBoundingClientRect(), top = r.top + 10, h = r.height - 20;
      var f = 1 - Math.min(1, Math.max(0, (clientY - top) / h));
      return RATE_MIN + f * (RATE_MAX - RATE_MIN);
    }
    s.addEventListener('pointerdown', function (e) { dragging = true; s.setPointerCapture(e.pointerId); self.chooseRate(at(e.clientY)); e.preventDefault(); });
    s.addEventListener('pointermove', function (e) { if (dragging) self.chooseRate(at(e.clientY)); });
    s.addEventListener('pointerup', function () { dragging = false; });
    s.addEventListener('pointercancel', function () { dragging = false; });
    s.addEventListener('keydown', function (e) {
      var d = { ArrowUp: RATE_STEP, ArrowRight: RATE_STEP, ArrowDown: -RATE_STEP, ArrowLeft: -RATE_STEP }[e.key];
      if (e.key === 'Home') { self.chooseRate(RATE_MIN); e.preventDefault(); return; }
      if (e.key === 'End') { self.chooseRate(RATE_MAX); e.preventDefault(); return; }
      if (d) { self.chooseRate(self.rateValue + d); e.preventDefault(); }
    });
  };

  Bar.prototype.minHeight = function () {
    return Math.ceil(parseFloat(getComputedStyle(this.linesBox).fontSize || '17') * LINE_HEIGHT * MIN_LINES);
  };
  Bar.prototype.currentLineEl = function () {
    var all = this.linesBox.querySelectorAll('.pl-nb-line:not(.pl-nb-leave)');
    return all[all.length - 1] || null;
  };
  Bar.prototype.fitLines = function () {
    var p = this.currentLineEl();
    this.linesBox.classList.add('pl-nb-still');
    this.linesBox.style.height = Math.max(this.minHeight(), p ? p.offsetHeight : 0) + 'px';
  };
  Bar.prototype.showLine = function (text, animate) {
    var box = this.linesBox, cur = this.currentLineEl();
    if (cur && cur.textContent === text) return;
    var olds = box.querySelectorAll('.pl-nb-line');
    var p = document.createElement('p');
    p.className = 'pl-nb-line';
    p.textContent = text;
    box.appendChild(p);
    var h = Math.max(this.minHeight(), p.offsetHeight);
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      box.style.height = box.getBoundingClientRect().height + 'px';
      void box.offsetHeight;
      box.classList.remove('pl-nb-still');
      box.style.height = h + 'px';
      Array.prototype.forEach.call(olds, function (o) { o.classList.remove('pl-nb-enter'); o.classList.add('pl-nb-leave'); setTimeout(function () { o.remove(); }, FADE_OUT_MS); });
      p.classList.add('pl-nb-enter');
    } else {
      Array.prototype.forEach.call(olds, function (o) { o.remove(); });
      box.classList.add('pl-nb-still');
      box.style.height = h + 'px';
    }
  };
  Bar.prototype.fill = function (f) { this.fillEl.style.transform = 'scaleX(' + Math.max(0, Math.min(1, f)).toFixed(4) + ')'; };

  Bar.prototype.bindAudio = function () {
    var self = this, a = this.audio;
    a.addEventListener('playing', function () {
      if (!self.active || a.getAttribute('src') !== self.currentUrl) return;
      self.started = true; clearTimeout(self.timer); self.render();
    });
    a.addEventListener('ended', function () {
      if (!self.active || self.failed || a.getAttribute('src') !== self.currentUrl) return;
      self.onEnded();
    });
    a.addEventListener('error', function () {
      if (!self.active || a.getAttribute('src') !== self.currentUrl) return;
      self.fail('error');
    });
    // A pause nobody asked for (a phone call, the system taking the audio
    // away) stops the line where it is, like a failed line.
    a.addEventListener('pause', function () {
      var token = self.playToken;
      setTimeout(function () {
        if (token === self.playToken && self.active && !self.paused && !self.failed && self.started && a.paused && !a.ended) self.fail('interrupted');
      }, INTERRUPT_CHECK_MS);
    });
  };

  // Plays a silent clip inside the child's touch so later lines may start
  // on their own on phones.
  Bar.prototype.unlock = function () {
    if (this.unlocked || this.active) return;
    var self = this, a = this.audio;
    this.unlocked = true;
    a.src = silentUrl();
    var p = a.play();
    if (p && p.then) p.then(function () { if (!self.active) a.pause(); }, function () { self.unlocked = false; });
  };

  Bar.prototype.kick = function () {
    var self = this, a = this.audio, token = this.playToken;
    var p = a.play();
    if (p && p.catch) p.catch(function (e) {
      if (token !== self.playToken || !self.active || self.paused || (e && e.name === 'AbortError')) return;
      self.fail(e && e.name === 'NotAllowedError' ? 'blocked' : 'error');
    });
    if (!this.started) {
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { if (token === self.playToken && self.active && !self.started && !self.paused && !self.failed) self.fail('timeout'); }, START_TIMEOUT_MS);
    }
    this.loop();
  };

  // Plays `id` from its beginning; the subtitle changes only when the
  // line is a different one.
  Bar.prototype.startLine = function (id, animate) {
    var l = this.lines[id];
    clearTimeout(this.timer);
    this.playToken++;
    this.current = id;
    this.failed = null; this.started = false; this.active = true;
    this.showLine(l ? l.text : '', animate);
    this.fill(0);
    if (!l || !l.url) { this.fail('missing'); return; }
    if (this.paused) { this.deferred = true; this.audio.pause(); this.render(); return; }
    this.deferred = false;
    var a = this.audio;
    this.currentUrl = l.url;
    if (a.getAttribute('src') !== l.url) a.src = l.url;
    try { a.currentTime = 0; } catch (e) { /* not seekable before metadata; it starts at 0 anyway */ }
    a.defaultPlaybackRate = this.rateValue; a.playbackRate = this.rateValue; a.muted = this.muted;
    this.kick();
    this.emit('lineStart', { id: id, replay: !this.pending || this.pending.id !== id });
    this.render();
  };

  Bar.prototype.halt = function () {
    clearTimeout(this.timer);
    this.playToken++;
    this.active = false; this.started = false; this.deferred = false; this.failed = null;
    this.audio.pause();
  };

  Bar.prototype.settle = function (by) {
    if (!this.pending) return;
    var p = this.pending;
    this.pending = null;
    if (by === 'end') this.emit('lineEnd', { id: p.id });
    p.resolve({ id: p.id, by: by });
  };

  Bar.prototype.onEnded = function () {
    this.fill(1);
    this.active = false; this.started = false;
    if (this.pending && this.pending.id === this.current) this.settle('end');
    this.render();
  };

  Bar.prototype.fail = function (reason) {
    if (this.failed) return;
    clearTimeout(this.timer);
    this.playToken++;
    this.failed = { id: this.current, reason: reason };
    this.audio.pause();
    this.emit('lineFail', { id: this.current, reason: reason });
    this.render();
  };

  Bar.prototype.loop = function () {
    if (this.raf) return;
    var self = this;
    var step = function () {
      self.raf = 0;
      if (!self.active) { self.lv = 0; self.face.style.setProperty('--lv', '0'); return; }
      var a = self.audio, l = self.lines[self.current];
      var d = (isFinite(a.duration) && a.duration) || (l && l.duration) || 0;
      if (d && self.started) self.fill(a.currentTime / d);
      var target = 0;
      if (!a.paused && !self.muted && l && l.env && l.env.length) target = l.env[Math.min(l.env.length - 1, Math.floor(a.currentTime / ENV_STEP_S))] || 0;
      self.lv += (target - self.lv) * 0.35;
      self.face.style.setProperty('--lv', self.lv.toFixed(3));
      self.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  };

  // ---------- the child's buttons ----------
  Bar.prototype.press = function (act) {
    if (act === 'rate') { this.openPop(this.pop.hidden); return; }
    this.openPop(false);
    if (act === 'replay') { this.replay(); this.emit('replay', { id: this.current }); return; }
    if (act === 'toggle') {
      if (this.failed) { this.emit('lineRetry', { id: this.failed.id }); this.paused = false; this.startLine(this.failed.id, false); this.wake(); return; }
      if (this.paused) { this.resume(); this.emit('resume', {}); } else { this.pause(); this.emit('pause', {}); }
    }
  };

  Bar.prototype.openPop = function (open) {
    if (!this.pop) return;
    this.pop.hidden = !open;
    this.btn.rate.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { this.render(); this.slider.focus({ preventScroll: true }); }
  };
  Bar.prototype.chooseRate = function (r) {
    var v = clampRate(r);
    if (v === this.rateValue) return;
    this.rate(v);
    this.emit('rate', { value: v });
  };

  // ---------- commands ----------
  Bar.prototype.say = function (id) {
    var self = this;
    if (this.pending) this.settle('cut');
    this.last = id;
    var done = new Promise(function (res) { self.pending = { id: id, resolve: res }; });
    this.startLine(id, true);
    return done;
  };
  // Says the current line again from its start. While the line is the one
  // the lecture is waiting for, the lecture simply waits a little longer;
  // after it ended (the child's turn, or 下一步), it is said once more and
  // nothing moves on.
  Bar.prototype.replay = function () {
    var id = this.failed ? this.failed.id : (this.current || this.last);
    if (!id) return;
    if (this.paused) { this.paused = false; this.emit('resume', {}); this.wake(); }
    this.startLine(id, false);
  };
  Bar.prototype.turn = function (on) { this.turnOn = !!on; this.render(); };
  Bar.prototype.flag = function (text) { this.flagText = text || null; this.render(); };
  Bar.prototype.pause = function () {
    if (this.paused) return;
    this.paused = true;
    if (this.active && !this.failed) this.audio.pause();
    this.render();
  };
  Bar.prototype.resume = function () {
    if (!this.paused) return;
    this.paused = false;
    if (this.active && !this.failed) { if (this.deferred) this.startLine(this.current, false); else this.kick(); }
    this.render();
    this.wake();
  };
  // Settles when the bar is neither paused nor stuck on a failed line.
  Bar.prototype.whenRunning = function () {
    var self = this;
    if (!this.paused && !this.failed) return Promise.resolve();
    return new Promise(function (res) { self.runWaiters.push(res); });
  };
  Bar.prototype.wake = function () {
    if (this.paused || this.failed) return;
    var w = this.runWaiters; this.runWaiters = [];
    w.forEach(function (f) { f(); });
  };
  Bar.prototype.rate = function (r) {
    this.rateValue = clampRate(r);
    this.audio.defaultPlaybackRate = this.rateValue; this.audio.playbackRate = this.rateValue;
    this.render();
  };
  Bar.prototype.mute = function (on) { this.muted = !!on; this.audio.muted = this.muted; this.render(); };
  // Shows a line as said, with nothing playing and nothing moving.
  Bar.prototype.set = function (s) {
    s = s || {};
    this.halt();
    this.settle('stop');
    this.current = s.line || null; this.last = this.current;
    this.turnOn = !!s.turn; this.flagText = s.flag || null;
    var l = s.line && this.lines[s.line];
    this.showLine(l ? l.text : '', false);
    this.fill(l ? 1 : 0);
    this.render(true);
  };
  Bar.prototype.stop = function () {
    this.halt();
    this.settle('stop');
    this.render();
  };
  Bar.prototype.clear = function () {
    this.stop();
    this.current = null; this.last = null; this.turnOn = false; this.flagText = null; this.paused = false;
    this.openPop(false);
    this.showLine('', false); this.fill(0);
    this.render();
    this.wake();
  };

  Bar.prototype.render = function (still) {
    var st = this.failed ? 'failed' : this.paused ? 'paused' : this.active ? 'speaking' : this.turnOn ? 'turn' : 'idle';
    this.el.setAttribute('data-state', st);
    var flag = this.failed ? ['fail', '没放出来，点 ▶ 再听'] : this.paused ? ['pause', '暂停了'] : this.flagText ? ['note', this.flagText] : this.turnOn && !this.active ? ['turn', '轮到你了'] : null;
    var f = this.flagEl;
    if (flag) {
      if (f.hidden || f.getAttribute('data-kind') !== flag[0] || f.textContent !== flag[1]) {
        f.hidden = false;
        f.setAttribute('data-kind', flag[0]);
        f.style.animation = 'none';
        if (!still) { void f.offsetWidth; f.style.animation = ''; }
      }
      f.textContent = flag[1];
    } else f.hidden = true;
    this.muteEl.hidden = !this.muted;
    var b = this.btn;
    if (b.replay) b.replay.disabled = !(this.current || this.last);
    if (b.toggle) {
      var main = this.failed || this.paused ? ['play', '继续'] : ['pause', '暂停'];
      if (b.toggle.getAttribute('data-icon') !== main[0]) {
        b.toggle.setAttribute('data-icon', main[0]);
        b.toggle.querySelector('.pl-nb-disc').innerHTML = svg(main[0]);
        b.toggle.querySelector('span').textContent = main[1];
      }
      b.toggle.setAttribute('aria-label', this.failed ? '再听这一句' : main[1]);
    }
    if (b.rate) {
      b.rate.querySelector('b').textContent = rateText(this.rateValue);
      b.rate.setAttribute('aria-label', '语速 ' + rateText(this.rateValue));
      var frac = (this.rateValue - RATE_MIN) / (RATE_MAX - RATE_MIN);
      var inner = 'calc(10px + (100% - 20px) * ';
      this.el.querySelector('.pl-nb-thumb').style.top = inner + (1 - frac).toFixed(4) + ')';
      this.el.querySelector('.pl-nb-railfill').style.height = (frac * 100).toFixed(2) + '%';
      this.el.querySelector('.pl-nb-normal').style.top = inner + (1 - (1 - RATE_MIN) / (RATE_MAX - RATE_MIN)).toFixed(4) + ')';
      this.el.querySelector('.pl-nb-value').textContent = rateText(this.rateValue);
      this.slider.setAttribute('aria-valuenow', String(this.rateValue));
      this.slider.setAttribute('aria-valuetext', rateText(this.rateValue));
    }
    if (this.active) this.loop();
  };

  return Bar;
})();
