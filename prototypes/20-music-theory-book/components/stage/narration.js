/* ============================================================
   Subtitle (stage theme). The band along the bottom of a lecture: the
   teacher's portrait (no name), the line being said as a subtitle with a
   progress line the child can drag to hear part of this line again, and
   the child's buttons for this line only: play and pause, and the speed
   on a vertical slider. Which buttons show is set by the workflow file.
   It never steps to another line or scene; the stage's scene buttons do.

   The play button: while the line is said it pauses; paused, it goes on;
   once the line is over (the child's turn, or waiting for the next
   scene) it says the line again from its start; on a line that could not
   play it tries again. To hear a line again from its start while it is
   being said, the child drags the progress line to its left end.

   The player tells it which line to say (say returns a promise that
   settles when the line is over), when it is the child's turn (turn),
   and while it is paused the player waits (whenRunning). Dragging the
   progress line moves within the current line only: while the line is
   still being said the lecture waits for it to end; after it ended, the
   line is heard again from there and nothing moves on. A line that
   cannot play (blocked, broken, not started in 8 seconds, taken away by
   the system) stays on screen and waits for the child to press play; it
   is never skipped. Muted, lines still play silently so the lecture
   keeps its pace.

   Each line is a recording played by one HTMLAudioElement, so a slower
   or faster speed keeps the pitch, and a phone's silent switch does not
   mute it. The portrait's halo follows a loudness envelope measured
   when the recordings are prepared.

   Inputs: buttons (pause, rate), lines [{id, text, url, duration, env}],
   portrait, rate, muted.
   Interface: narrate. Commands (methods): say, turn, flag, pause,
   resume, seek, rate, mute, set, stop, clear, unlock, whenRunning.
   Events: narrate.lineStart, narrate.lineEnd, narrate.lineFail,
   narrate.lineRetry, narrate.replay, narrate.seek, narrate.pause,
   narrate.resume, narrate.rate.
   ============================================================ */
var NarrationBar = (function () {
  var RATE_MIN = 0.6, RATE_MAX = 1.4, RATE_STEP = 0.05, RATE_SNAP = 0.03;
  var SEEK_KEY_S = 2;
  var START_TIMEOUT_MS = 8000;
  var ENV_STEP_S = 0.04;
  var INTERRUPT_CHECK_MS = 300;
  var FADE_OUT_MS = 340;
  var LINE_HEIGHT = 1.55;
  var MIN_LINES = 2;
  var SILENT = null;

  // The band is a grid: the portrait, the state tags, the subtitle, the
  // progress line and the buttons. On a wide band the portrait stands on
  // the left and the buttons on the right of everything; on a narrow one
  // the subtitle takes the whole width next to a smaller portrait, the
  // progress line and the buttons share the row under it, and the state
  // tags sit on the band's top edge.
  var CSS = [
    '.st-nb{container-type:inline-size;position:relative;min-width:0;flex:1 1 auto}',
    '.st-nb-body{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"face meta ctl" "face lines ctl" "face seek ctl";align-items:center;column-gap:14px;row-gap:6px;padding:12px 14px 12px 12px;border-radius:22px}',
    '.st-nb-face{grid-area:face;--lv:0;position:relative;width:56px;height:56px;border-radius:50%;flex:none}',
    '.st-nb-face::before{content:"";position:absolute;inset:-6px;border-radius:50%;background:radial-gradient(circle,rgba(169,139,255,.75),rgba(169,139,255,0) 70%);opacity:calc(.15 + var(--lv) * .85);transform:scale(calc(.86 + var(--lv) * .22));transition:opacity .08s linear}',
    '.st-nb-face img{position:relative;width:100%;height:100%;border-radius:50%;object-fit:cover;background:#3a2f5c;box-shadow:0 0 0 2px rgba(255,255,255,.22)}',
    '.st-nb[data-state="turn"] .st-nb-face::before{animation:st-nb-breathe 2.4s ease-in-out infinite}',
    '@keyframes st-nb-breathe{0%,100%{opacity:.2;transform:scale(.9)}50%{opacity:.95;transform:scale(1.08)}}',
    '.st-nb-meta{grid-area:meta;display:flex;gap:8px;min-height:20px;align-items:center;flex-wrap:wrap;min-width:0}',
    '.st-nb-flag,.st-nb-mute{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;line-height:1;padding:4px 9px;border-radius:999px;background:rgba(169,139,255,.22);color:#e5dcff}',
    '.st-nb-flag[hidden],.st-nb-mute[hidden]{display:none}',
    '.st-nb-flag{animation:st-nb-pop .35s cubic-bezier(.2,1.5,.4,1) both}',
    '.st-nb-flag[data-kind="fail"]{background:rgba(232,110,90,.25);color:#ffd9d0}',
    '.st-nb-mute svg{width:14px;height:14px}',
    '@keyframes st-nb-pop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}',
    '.st-nb-lines{grid-area:lines;position:relative;min-width:0;overflow:hidden;transition:height .52s var(--st-ease)}',
    '.st-nb-lines.st-nb-still{transition:none}',
    '.st-nb-line{margin:0;font-size:17px;line-height:' + LINE_HEIGHT + ';letter-spacing:.01em;text-wrap:pretty}',
    '.st-nb-line.st-nb-enter{animation:st-nb-up .52s var(--st-ease) both}',
    '.st-nb-line.st-nb-leave{position:absolute;left:0;right:0;top:0;animation:st-nb-out .34s ease-in both}',
    '@keyframes st-nb-up{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}',
    '@keyframes st-nb-out{to{transform:translateY(-12px);opacity:0}}',
    '.st-nb-seek{grid-area:seek;position:relative;display:flex;align-items:center;height:36px;margin:-10px 0 -10px;min-width:0;cursor:pointer;touch-action:none}',
    '.st-nb-seek:focus{outline:none}.st-nb-seek:focus-visible{outline:2px solid var(--st-glow);outline-offset:-6px;border-radius:8px}',
    '.st-nb-seek[aria-disabled="true"]{pointer-events:none;opacity:.45}',
    '.st-nb-track{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden;transition:height .2s}',
    '.st-nb-seek:hover .st-nb-track,.st-nb-seek.st-nb-drag .st-nb-track{height:6px}',
    '.st-nb-fill{display:block;height:100%;background:var(--st-glow);box-shadow:0 0 8px var(--st-glow);transform-origin:left;transform:scaleX(0)}',
    '.st-nb-knob{position:absolute;top:50%;left:0;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fbf8f3;box-shadow:0 0 0 3px rgba(169,139,255,.45),0 2px 6px rgba(0,0,0,.4);transition:transform .2s}',
    '.st-nb-seek:hover .st-nb-knob,.st-nb-seek.st-nb-drag .st-nb-knob{transform:scale(1.35)}',
    '.st-nb-ctl{grid-area:ctl;display:flex;align-items:center;gap:4px}',
    '.st-nb-ctl .st-btn{background:transparent;box-shadow:none;width:48px;height:52px;border-radius:14px}',
    '.st-nb-ctl .st-btn:hover:not([disabled]){background:rgba(255,255,255,.08)}',
    '.st-nb-ctl .st-btn .f{fill:currentColor;stroke:none}',
    '.st-nb-disc{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#8f6bff,var(--st-btn));box-shadow:0 8px 18px -8px var(--st-btn),inset 0 1px 0 rgba(255,255,255,.25)}',
    '.st-nb-rate b{font-size:15px;font-variant-numeric:lining-nums tabular-nums;line-height:22px}',
    '.st-nb-ratebox{position:relative}',
    '.st-nb-pop{position:absolute;right:-4px;bottom:calc(100% + 12px);z-index:5;width:76px;padding:12px 0 12px;border-radius:18px;display:grid;justify-items:center;gap:10px;animation:st-nb-rise .32s var(--st-ease) both}',
    '.st-nb-pop[hidden]{display:none}',
    '@keyframes st-nb-rise{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}',
    '.st-nb-slider{position:relative;width:44px;height:168px;touch-action:none;cursor:pointer;border-radius:12px}',
    '.st-nb-slider:focus{outline:none}.st-nb-slider:focus-visible{outline:2px solid var(--st-glow);outline-offset:2px}',
    '.st-nb-rail{position:absolute;left:50%;top:10px;bottom:10px;width:6px;margin-left:-3px;border-radius:3px;background:rgba(255,255,255,.14)}',
    '.st-nb-railfill{position:absolute;left:0;right:0;bottom:0;border-radius:3px;background:linear-gradient(0deg,#6d3cf0,#a98bff);box-shadow:0 0 8px rgba(169,139,255,.6)}',
    '.st-nb-normal{position:absolute;left:8px;right:8px;height:2px;margin-top:-1px;border-radius:1px;background:rgba(255,255,255,.4)}',
    '.st-nb-thumb{position:absolute;left:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#fbf8f3;box-shadow:0 3px 10px rgba(0,0,0,.4),0 0 0 4px rgba(169,139,255,.35)}',
    '.st-nb-value{font-size:15px;font-weight:800;font-variant-numeric:lining-nums tabular-nums}',
    '@container (max-width:560px){.st-nb-body{column-gap:10px;padding:10px}.st-nb-face{width:44px;height:44px}.st-nb-line{font-size:16px}.st-nb-ctl .st-btn{width:44px;height:48px}.st-nb-disc{width:42px;height:42px}}',
    '@container (max-width:400px){.st-nb-body{grid-template-areas:"face lines lines" "seek seek ctl";row-gap:0;column-gap:8px;padding:9px 8px 4px 9px;align-items:start}',
    '.st-nb-face{width:34px;height:34px;margin-top:2px}.st-nb-line{font-size:15px}',
    '.st-nb-meta{position:absolute;top:-11px;left:46px;min-height:0;pointer-events:none}',
    '.st-nb-seek{margin:0 0 0 4px;height:44px;align-self:center}.st-nb-ctl{align-self:center}.st-nb-ctl .st-btn{width:42px;height:44px}.st-nb-disc{width:38px;height:38px}}'
  ].join('');

  var ICON = {
    play: '<path class="f" d="M8.5 5.6v12.8l10-6.4z"/>',
    pause: '<rect class="f" x="6.8" y="5.6" width="3.6" height="12.8" rx="1"/><rect class="f" x="13.6" y="5.6" width="3.6" height="12.8" rx="1"/>',
    muted: '<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" fill="currentColor" stroke="none"/><path d="M15 9.2l5 5.6M20 9.2l-5 5.6" fill="none" stroke="currentColor" stroke-width="2"/>'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>'; }
  function rateText(r) { return (Math.round(r * 100) / 100).toString() + '×'; }
  function clampRate(r) {
    r = Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) / RATE_STEP) * RATE_STEP;
    if (Math.abs(r - 1) < RATE_SNAP) r = 1;
    return Math.round(r * 100) / 100;
  }
  function clamp01(f) { return Math.max(0, Math.min(1, f)); }

  function injectStyle() {
    StageTheme.inject();
    if (document.getElementById('st-nb-style')) return;
    var s = document.createElement('style'); s.id = 'st-nb-style'; s.textContent = CSS; document.head.appendChild(s);
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
    LessonComponents.Base.call(this);
    injectStyle();
    this.host = host;
    this.o = Object.assign({ portrait: '', buttons: ['pause', 'rate'], lines: [], rate: 1, muted: false }, options);
    this.lines = {};
    var self = this;
    this.o.lines.forEach(function (l) { self.lines[l.id] = l; });
    this.current = null; this.pending = null; this.last = null;
    this.active = false; this.started = false; this.failed = null; this.deferred = false;
    this.paused = false; this.turnOn = false; this.flagText = null; this.dragging = false;
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
  Bar.prototype = Object.create(LessonComponents.Base.prototype);
  Bar.prepare = prepare;
  Bar.RATE_MIN = RATE_MIN; Bar.RATE_MAX = RATE_MAX;

  Bar.prototype.fire = function (type, data) { this.emit(Object.assign({ name: 'narrate.' + type }, data || {})); };
  Bar.prototype.has = function (c) { return this.o.buttons.indexOf(c) >= 0; };

  Bar.prototype.build = function () {
    var self = this;
    this.host.classList.add('st-ui');
    var el = document.createElement('div');
    el.className = 'st-nb';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', '老师的话');
    el.innerHTML =
      '<div class="st-nb-body st-glass">' +
        '<div class="st-nb-face"><img alt="老师" draggable="false"></div>' +
        '<div class="st-nb-meta"><span class="st-nb-flag" hidden></span><span class="st-nb-mute" hidden>' + svg('muted') + '静音，看字幕</span></div>' +
        '<div class="st-nb-lines" aria-live="polite"></div>' +
        '<div class="st-nb-seek" role="slider" tabindex="0" aria-label="这一句播到哪里" aria-valuemin="0" aria-valuemax="100"><div class="st-nb-track"><i class="st-nb-fill"></i></div><i class="st-nb-knob"></i></div>' +
        '<div class="st-nb-ctl">' +
          (this.has('pause') ? '<button type="button" class="st-btn st-nb-main" data-act="toggle"><i class="st-nb-disc"></i></button>' : '') +
          (this.has('rate') ?
            '<div class="st-nb-ratebox">' +
              '<button type="button" class="st-btn st-nb-rate" data-act="rate" aria-haspopup="true" aria-expanded="false"><b></b></button>' +
              '<div class="st-nb-pop st-glass" hidden>' +
                '<div class="st-nb-slider" role="slider" tabindex="0" aria-orientation="vertical" aria-label="语速" aria-valuemin="' + RATE_MIN + '" aria-valuemax="' + RATE_MAX + '">' +
                  '<i class="st-nb-rail"><i class="st-nb-railfill"></i></i><i class="st-nb-normal"></i><i class="st-nb-thumb"></i>' +
                '</div>' +
                '<b class="st-nb-value"></b>' +
              '</div>' +
            '</div>' : '') +
        '</div>' +
      '</div>';
    this.host.appendChild(el);
    this.el = el;
    var q = function (s) { return el.querySelector(s); };
    this.face = q('.st-nb-face'); this.flagEl = q('.st-nb-flag'); this.muteEl = q('.st-nb-mute');
    this.linesBox = q('.st-nb-lines'); this.fillEl = q('.st-nb-fill'); this.seekEl = q('.st-nb-seek'); this.knobEl = q('.st-nb-knob');
    this.btn = {}; Array.prototype.forEach.call(el.querySelectorAll('[data-act]'), function (b) { self.btn[b.getAttribute('data-act')] = b; });
    this.pop = q('.st-nb-pop'); this.slider = q('.st-nb-slider'); this.rateBox = q('.st-nb-ratebox');
    q('.st-nb-face img').src = this.o.portrait || '';
    this.linesBox.classList.add('st-nb-still');
    this.linesBox.style.height = this.minHeight() + 'px';

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      self.press(b.getAttribute('data-act'));
    });
    this.bindSeek();
    if (this.slider) this.bindSlider();
    document.addEventListener('pointerdown', function (e) { if (self.pop && !self.pop.hidden && !self.rateBox.contains(e.target)) self.openPop(false); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && self.pop && !self.pop.hidden) { self.openPop(false); self.btn.rate.focus(); } });
    if (window.ResizeObserver) {
      var w = 0;
      new ResizeObserver(function () { var nw = el.getBoundingClientRect().width; if (nw !== w) { w = nw; self.fitLines(); } }).observe(el);
    }
  };

  // The progress line: pressing or dragging shows where the line will
  // play from; letting go plays it from there. Left and right arrows move
  // two seconds.
  Bar.prototype.bindSeek = function () {
    var self = this, s = this.seekEl;
    function at(clientX) { var r = self.el.querySelector('.st-nb-track').getBoundingClientRect(); return clamp01((clientX - r.left) / r.width); }
    s.addEventListener('pointerdown', function (e) {
      if (!self.line()) return;
      self.dragging = true; s.classList.add('st-nb-drag'); s.setPointerCapture(e.pointerId);
      self.fill(at(e.clientX)); e.preventDefault();
    });
    s.addEventListener('pointermove', function (e) { if (self.dragging) self.fill(at(e.clientX)); });
    s.addEventListener('pointerup', function (e) {
      if (!self.dragging) return;
      self.dragging = false; s.classList.remove('st-nb-drag');
      self.seek(at(e.clientX), true);
    });
    s.addEventListener('pointercancel', function () { self.dragging = false; s.classList.remove('st-nb-drag'); });
    s.addEventListener('keydown', function (e) {
      var d = { ArrowRight: SEEK_KEY_S, ArrowUp: SEEK_KEY_S, ArrowLeft: -SEEK_KEY_S, ArrowDown: -SEEK_KEY_S }[e.key];
      var l = self.line(); if (!d || !l) return;
      e.preventDefault();
      var now = self.active ? self.audio.currentTime : l.duration;
      self.seek((now + d) / l.duration, true);
    });
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

  Bar.prototype.line = function () { var id = this.failed ? this.failed.id : (this.current || this.last); return id ? this.lines[id] : null; };
  Bar.prototype.minHeight = function () {
    return Math.ceil(parseFloat(getComputedStyle(this.linesBox).fontSize || '17') * LINE_HEIGHT * MIN_LINES);
  };
  Bar.prototype.currentLineEl = function () {
    var all = this.linesBox.querySelectorAll('.st-nb-line:not(.st-nb-leave)');
    return all[all.length - 1] || null;
  };
  Bar.prototype.fitLines = function () {
    var p = this.currentLineEl();
    this.linesBox.classList.add('st-nb-still');
    this.linesBox.style.height = Math.max(this.minHeight(), p ? p.offsetHeight : 0) + 'px';
  };
  Bar.prototype.showLine = function (text, animate) {
    var box = this.linesBox, cur = this.currentLineEl();
    if (cur && cur.textContent === text) return;
    var olds = box.querySelectorAll('.st-nb-line');
    var p = document.createElement('p');
    p.className = 'st-nb-line';
    p.textContent = text;
    box.appendChild(p);
    var h = Math.max(this.minHeight(), p.offsetHeight);
    if (animate && !StageTheme.still()) {
      box.style.height = box.getBoundingClientRect().height + 'px';
      void box.offsetHeight;
      box.classList.remove('st-nb-still');
      box.style.height = h + 'px';
      Array.prototype.forEach.call(olds, function (o) { o.classList.remove('st-nb-enter'); o.classList.add('st-nb-leave'); setTimeout(function () { o.remove(); }, FADE_OUT_MS); });
      p.classList.add('st-nb-enter');
    } else {
      Array.prototype.forEach.call(olds, function (o) { o.remove(); });
      box.classList.add('st-nb-still');
      box.style.height = h + 'px';
    }
  };
  Bar.prototype.fill = function (f) {
    f = clamp01(f);
    this.fillEl.style.transform = 'scaleX(' + f.toFixed(4) + ')';
    this.knobEl.style.left = (f * 100).toFixed(2) + '%';
    this.seekEl.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  };

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

  // Plays `id` from `from` seconds (its beginning when not given); the
  // subtitle changes only when the line is a different one.
  Bar.prototype.startLine = function (id, animate, from) {
    var l = this.lines[id];
    clearTimeout(this.timer);
    this.playToken++;
    this.current = id;
    this.failed = null; this.started = false; this.active = true;
    this.showLine(l ? l.text : '', animate);
    this.fill(l && from ? from / l.duration : 0);
    if (!l || !l.url) { this.fail('missing'); return; }
    var a = this.audio;
    this.currentUrl = l.url;
    if (a.getAttribute('src') !== l.url) a.src = l.url;
    try { a.currentTime = from || 0; } catch (e) { /* not seekable before metadata; it starts at 0 anyway */ }
    if (this.paused) { this.deferred = true; a.pause(); this.render(); return; }
    this.deferred = false;
    a.defaultPlaybackRate = this.rateValue; a.playbackRate = this.rateValue; a.muted = this.muted;
    this.kick();
    this.fire('lineStart', { id: id, replay: !this.pending || this.pending.id !== id });
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
    if (by === 'end') this.fire('lineEnd', { id: p.id });
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
    this.fire('lineFail', { id: this.current, reason: reason });
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
      if (d && self.started && !self.dragging) self.fill(a.currentTime / d);
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
    if (act !== 'toggle') return;
    if (this.failed) { this.fire('lineRetry', { id: this.failed.id }); this.paused = false; this.startLine(this.failed.id, false); this.wake(); return; }
    if (this.paused) { this.resume(); this.fire('resume', {}); return; }
    if (this.active) { this.pause(); this.fire('pause', {}); return; }
    if (this.line()) { this.seek(0, false); this.fire('replay', { id: this.line().id }); }
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
    this.fire('rate', { value: v });
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
  // Plays the current line from a point (0..1 of its length). While it is
  // playing it jumps there; after it ended, or when it failed, it plays
  // again from there. A pause stays a pause.
  Bar.prototype.seek = function (f, byChild) {
    var l = this.line(); if (!l) return;
    var t = clamp01(f) * l.duration;
    if (t >= l.duration - 0.05) t = Math.max(0, l.duration - 0.05);
    if (this.active && !this.failed && this.current === l.id && this.audio.getAttribute('src') === l.url) {
      try { this.audio.currentTime = t; } catch (e) { /* metadata not ready; the line goes on from where it was */ }
      this.fill(t / l.duration);
    } else {
      this.startLine(l.id, false, t);
    }
    if (byChild) this.fire('seek', { id: l.id, at: Math.round(t * 100) / 100 });
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
    if (this.active && !this.failed) {
      if (this.deferred) { this.deferred = false; this.audio.defaultPlaybackRate = this.rateValue; this.audio.playbackRate = this.rateValue; this.audio.muted = this.muted; }
      this.kick();
    }
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
  Bar.prototype.getState = function () { return { line: this.current }; };
  Bar.prototype.setState = function (s) { this.set(s); };
  Bar.prototype.call = function (name) { throw new Error('narration: ' + name); };

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
    this.seekEl.setAttribute('aria-disabled', this.line() ? 'false' : 'true');
    var b = this.btn;
    if (b.toggle) {
      var speaking = this.active && !this.paused && !this.failed;
      var main = speaking ? ['pause', '暂停'] : this.failed ? ['play', '再听这一句'] : this.paused ? ['play', '继续'] : ['play', '从头再听这一句'];
      if (b.toggle.getAttribute('data-icon') !== main[0]) {
        b.toggle.setAttribute('data-icon', main[0]);
        b.toggle.querySelector('.st-nb-disc').innerHTML = svg(main[0]);
      }
      b.toggle.setAttribute('aria-label', main[1]);
      b.toggle.disabled = !speaking && !this.paused && !this.failed && !this.line();
    }
    if (b.rate) {
      b.rate.querySelector('b').textContent = rateText(this.rateValue);
      b.rate.setAttribute('aria-label', '语速 ' + rateText(this.rateValue));
      var frac = (this.rateValue - RATE_MIN) / (RATE_MAX - RATE_MIN);
      var inner = 'calc(10px + (100% - 20px) * ';
      this.el.querySelector('.st-nb-thumb').style.top = inner + (1 - frac).toFixed(4) + ')';
      this.el.querySelector('.st-nb-railfill').style.height = (frac * 100).toFixed(2) + '%';
      this.el.querySelector('.st-nb-normal').style.top = inner + (1 - (1 - RATE_MIN) / (RATE_MAX - RATE_MIN)).toFixed(4) + ')';
      this.el.querySelector('.st-nb-value').textContent = rateText(this.rateValue);
      this.slider.setAttribute('aria-valuenow', String(this.rateValue));
      this.slider.setAttribute('aria-valuetext', rateText(this.rateValue));
    }
    if (this.active) this.loop();
  };

  LessonComponents.register('narration', {
    theme: 'stage', interfaces: ['narrate'],
    create: function (host, input) { return new Bar(host, input); }
  });
  return Bar;
})();
