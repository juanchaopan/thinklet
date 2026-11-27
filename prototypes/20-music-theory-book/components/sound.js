/* ============================================================
   What the player gives the component prototypes: the sound source
   that components call, and the player's own parts around it — the
   loading screen shown before a question starts, and unlocking sound
   on every touch.

   Sound source: plays MIDI pitches with sampled piano. It knows
   nothing about scores, keyboards or grids. All samples are
   downloaded and decoded by preload() before the question starts, so
   play() always schedules at once and the first notes keep their
   timing. play() before preload() has finished makes no sound.

   play() schedules a note ahead on the audio clock and returns a voice
   whose stop() silences it, whether it is sounding or still waiting
   to start. A component keeps the voices it scheduled and stops them
   when it is told to stop, so pausing a playback silences the notes
   already queued, and one component never silences another's.

   tap() is the player's touch sound: a short, soft wooden "dup" made on
   the spot (no sample, no pitch of the music), played when the child
   presses something, so a press feels like pressing a real key.

   On iPhones Web Audio stays muted by the ring/silent switch until a
   media element is playing, and phones only start audio inside a
   gesture. So unlock() resumes the audio context and keeps a silent
   clip looping through an <audio> element; a play() the browser
   refuses is retried on the next touch.
   ============================================================ */
var SoundSource = (function () {
  var ctx = null, buffers = {}, keys = [], preloading = null, media = null, mediaStarting = false, watchers = [];
  var state = { phase: 'idle', detail: '' };
  var sounding = 0;
  var SILENT_VOICE = { stop: function () {} };
  var RELEASE = .3, CUT = .04;
  // The touch sound: a pitch falling from TAP_HZ to TAP_TO_HZ over
  // TAP_FALL s, with a hollow overtone, rising in TAP_ATTACK s and dying
  // away by TAP_LEN s; quiet, so it never covers the narration.
  var TAP_HZ = 760, TAP_TO_HZ = 520, TAP_FALL = .06, TAP_ATTACK = .004, TAP_LEN = .16, TAP_GAIN = .14, TAP_LOWPASS = 2600;

  function report(phase, detail) {
    if (phase) state = { phase: phase, detail: detail || '' };
    watchers.forEach(function (f) { f(state); });
  }

  // One second of silence as an 8 kHz, 16-bit mono WAV.
  function silentWav() {
    var rate = 8000, n = rate, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function s(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true);
    return new Blob([buf], { type: 'audio/wav' });
  }

  // An audio context can be created and can decode before any gesture;
  // it only stays suspended until unlock() resumes it.
  function context() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) { report('failed', '这个浏览器不支持 Web Audio'); return null; }
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* browsers without an audio session API */ }
      ctx = new C();
      ctx.onstatechange = function () { report(); };
    }
    return ctx;
  }

  function keepMediaPlaying() {
    if (!media) {
      try {
        media = new Audio(URL.createObjectURL(silentWav()));
        media.loop = true;
        media.setAttribute('playsinline', '');
        media.addEventListener('playing', function () { report(); });
        media.addEventListener('pause', function () { report(); });
      } catch (e) { return; }
    }
    if (!media.paused || mediaStarting) return;
    mediaStarting = true;
    var p = media.play();
    if (p && p.then) p.then(function () { mediaStarting = false; report(); }, function () { mediaStarting = false; report(); });
    else mediaStarting = false;
  }

  // Reads a response body chunk by chunk so the loading screen can show
  // how far the download is. Without a length header (a compressed
  // response) only the bytes so far are known.
  function readWithProgress(res, onBytes) {
    var total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !res.body.getReader) return res.text().then(function (t) { onBytes(t.length, t.length); return t; });
    var reader = res.body.getReader(), chunks = [], got = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        chunks.push(r.value); got += r.value.length; onBytes(got, total);
        return pump();
      });
    }
    return pump().then(function () {
      var all = new Uint8Array(got), at = 0;
      chunks.forEach(function (c) { all.set(c, at); at += c.length; });
      return new TextDecoder().decode(all);
    });
  }

  function decodeOne(c, b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Promise(function (res, rej) { c.decodeAudioData(bytes.buffer, res, rej); });
  }

  // Downloads every sample and decodes it into an audio buffer. Progress
  // goes to onProgress(fraction 0..1 or null when unknown, text).
  // The samples sit next to the page, so a relative path works wherever
  // the page is served from.
  function preload(onProgress) {
    var tell = onProgress || function () {};
    if (preloading) { preloading.then(function () { tell(1, ''); }); return preloading; }
    var c = context();
    if (!c) return Promise.reject(new Error('no Web Audio'));
    report('loading', '下载中');
    preloading = fetch('piano.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return readWithProgress(r, function (got, total) {
        var kb = Math.round(got / 1024);
        tell(total ? .8 * got / total : null, '钢琴声音 ' + kb + (total ? ' / ' + Math.round(total / 1024) : '') + ' KB');
        report('loading', '已下载 ' + kb + ' KB');
      });
    }).then(function (text) {
      var raw = JSON.parse(text), names = Object.keys(raw), done = 0;
      return Promise.all(names.map(function (k) {
        return decodeOne(c, raw[k]).then(function (buf) {
          buffers[k] = buf; done++;
          tell(.8 + .2 * done / names.length, '准备钢琴声音 ' + done + ' / ' + names.length);
        });
      })).then(function () {
        keys = names.map(Number).sort(function (a, b) { return a - b; });
        report('ready', keys.length + ' 个采样');
      });
    }).catch(function (e) {
      preloading = null;
      report('failed', '采样没有加载出来（' + (e && e.message || e) + '）');
      throw e;
    });
    return preloading;
  }

  function nearestSample(midi) {
    var best = null, d = Infinity;
    keys.forEach(function (k) { var dd = Math.abs(k - midi); if (dd < d) { d = dd; best = k; } });
    return best;
  }

  // Schedules one note and returns its voice. stop() fades it out in a
  // few milliseconds (a hard cut clicks); a note that has not started yet
  // never sounds.
  function play(midi, delaySec, durSec, velocity) {
    if (!ctx || state.phase !== 'ready') return SILENT_VOICE;
    var s = nearestSample(midi); if (s === null) return SILENT_VOICE;
    var t0 = ctx.currentTime + (delaySec || 0), dur = Math.max(.08, durSec || 1), v = velocity || .8;
    var src = ctx.createBufferSource(); src.buffer = buffers[s]; src.playbackRate.value = Math.pow(2, (midi - s) / 12);
    var g = ctx.createGain();
    g.gain.setValueAtTime(v, t0); g.gain.setValueAtTime(v, t0 + dur); g.gain.exponentialRampToValueAtTime(.001, t0 + dur + RELEASE);
    src.connect(g); g.connect(ctx.destination); src.start(t0); src.stop(t0 + dur + RELEASE + .05);
    var ended = false;
    sounding++;
    src.onended = function () { if (!ended) { ended = true; sounding--; } g.disconnect(); };
    return {
      stop: function () {
        if (ended) return;
        var now = ctx.currentTime;
        if (now < t0) { src.stop(now); return; }
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + CUT);
        src.stop(now + CUT + .01);
      }
    };
  }

  // The touch sound, made now: a sine and a softer triangle an octave and
  // a fifth up, both falling a little in pitch, through a gentle low-pass.
  function tap() {
    var c = context();
    if (!c || c.state !== 'running') return;
    var t0 = c.currentTime + .005, out = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = TAP_LOWPASS;
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(TAP_GAIN, t0 + TAP_ATTACK);
    out.gain.exponentialRampToValueAtTime(.0008, t0 + TAP_LEN);
    out.connect(lp); lp.connect(c.destination);
    [[1, 'sine', 1], [3, 'triangle', .18]].forEach(function (p) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = p[1];
      o.frequency.setValueAtTime(TAP_HZ * p[0], t0);
      o.frequency.exponentialRampToValueAtTime(TAP_TO_HZ * p[0], t0 + TAP_FALL);
      g.gain.value = p[2];
      o.connect(g); g.connect(out);
      o.start(t0); o.stop(t0 + TAP_LEN + .02);
      o.onended = function () { g.disconnect(); };
    });
    setTimeout(function () { out.disconnect(); lp.disconnect(); }, (TAP_LEN + .1) * 1000);
  }

  return {
    preload: preload,
    play: play,
    tap: tap,
    unlock: function () {
      var c = context(); if (!c) return;
      if (c.state !== 'running') {
        var p = c.resume(); if (p && p.catch) p.catch(function () {});
        var s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0);
      }
      keepMediaPlaying();
    },
    watch: function (f) { watchers.push(f); f(state); },
    status: function () {
      return {
        phase: state.phase, detail: state.detail, voices: sounding,
        engine: ctx ? ctx.state : '还没创建',
        media: media ? (media.paused ? '没有播放' : '播放中') : '还没创建'
      };
    }
  };
})();

/* ============================================================
   The player's loading screen. Before a question starts it covers the
   page, downloads and prepares everything the question needs (the
   piano samples, the fonts, and whatever the page adds with need(),
   such as the question's files and narration), shows how far it is, and
   ends with a "开始" button. That tap is the gesture that lets phones
   play sound, so the first note and the first line after it play on
   time; onStart() hands that tap to the page.
   ============================================================ */
var PlayerLoading = (function () {
  var CSS = [
    '.pl-curtain{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;',
    'background:radial-gradient(70% 60% at 18% 8%,rgba(255,196,150,.6),transparent 70%),radial-gradient(60% 55% at 88% 12%,rgba(196,176,255,.5),transparent 70%),radial-gradient(90% 70% at 50% 110%,rgba(255,226,190,.75),transparent 70%),#f6efe4;',
    'transition:opacity .5s,visibility .5s;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;color:#2a2118}',
    '.pl-curtain.pl-gone{opacity:0;visibility:hidden}',
    '.pl-box{width:min(100%,360px);display:grid;gap:16px;justify-items:center;text-align:center}',
    '.pl-title{font-size:22px;font-weight:800;margin:0}',
    '.pl-bar{width:100%;height:10px;border-radius:5px;background:rgba(90,52,16,.12);overflow:hidden;box-shadow:inset 0 1px 2px rgba(60,36,12,.2)}',
    '.pl-fill{height:100%;width:0;border-radius:5px;background:linear-gradient(90deg,#a98bff,#7b4dff);box-shadow:0 0 12px rgba(123,77,255,.6);transition:width .25s ease-out}',
    '.pl-fill.pl-unknown{width:35%;animation:pl-slide 1.1s ease-in-out infinite alternate}',
    '@keyframes pl-slide{from{transform:translateX(-10%)}to{transform:translateX(200%)}}',
    '.pl-note{font-size:14px;color:#6a5a48;min-height:1.6em;margin:0}',
    '.pl-start{font:inherit;font-size:18px;font-weight:800;min-width:160px;min-height:56px;padding:0 28px;border:0;border-radius:999px;cursor:pointer;color:#fff;',
    'background:radial-gradient(circle at 35% 30%,#a98bff,#7b4dff);box-shadow:0 12px 26px -10px #7b4dff,0 0 0 4px rgba(255,230,200,.5);animation:pl-pop .45s cubic-bezier(.2,1.6,.4,1) both}',
    '.pl-start:active{transform:scale(.96)}',
    '.pl-start:focus{outline:none}.pl-start:focus-visible{outline:3px solid #7b4dff;outline-offset:4px}',
    '@keyframes pl-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.pl-curtain,.pl-fill,.pl-start{transition-duration:.01ms;animation-duration:.01ms}.pl-fill.pl-unknown{animation:none}}'
  ].join('');
  var PIANO_SHARE = .7;
  var tasks = [], starters = [];

  // Adds something to prepare before 开始: task(progress) returns a
  // promise; progress(fraction 0..1, text) reports how far it is.
  function need(task) { tasks.push(task); }
  function onStart(fn) { starters.push(fn); }

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

    // The piano takes most of the bar; the page's own tasks share the rest.
    function run() {
      action.innerHTML = '';
      title.textContent = '正在准备这道题';
      progress(null, '');
      var parts = [0].concat(tasks.map(function () { return 0; }));
      var share = tasks.length ? PIANO_SHARE : 1;
      function part(i, weight) {
        return function (f, text) {
          if (f === null || f === undefined) { if (text) note.textContent = text; return; }
          parts[i] = f * weight;
          progress(parts.reduce(function (a, b) { return a + b; }, 0), text);
        };
      }
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      var jobs = [SoundSource.preload(part(0, share)), fonts].concat(tasks.map(function (t, i) { return t(part(i + 1, (1 - share) / tasks.length)); }));
      Promise.all(jobs).then(function () {
        progress(1, '准备好了');
        title.textContent = '准备好了';
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pl-start'; b.textContent = '开始';
        b.addEventListener('click', function () {
          SoundSource.unlock();
          SoundSource.tap();
          el.classList.add('pl-gone');
          starters.forEach(function (fn) { fn(); });
        });
        action.appendChild(b);
        b.focus({ preventScroll: true });
      }, function () {
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

// The player's part: unlock on every touch, click or key press. Only
// touchend, click and keydown count as a gesture for starting media on
// phones, so all of them are listened to.
['pointerup', 'touchend', 'click', 'keydown'].forEach(function (t) {
  document.addEventListener(t, SoundSource.unlock, { capture: true, passive: true });
});
