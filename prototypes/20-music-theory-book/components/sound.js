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

   On iPhones Web Audio stays muted by the ring/silent switch until a
   media element is playing, and phones only start audio inside a
   gesture. So unlock() resumes the audio context and keeps a silent
   clip looping through an <audio> element; a play() the browser
   refuses is retried on the next touch.
   ============================================================ */
var SoundSource = (function () {
  var ctx = null, buffers = {}, keys = [], preloading = null, media = null, mediaStarting = false, watchers = [];
  var state = { phase: 'idle', detail: '' };

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

  return {
    preload: preload,
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
        phase: state.phase, detail: state.detail,
        engine: ctx ? ctx.state : '还没创建',
        media: media ? (media.paused ? '没有播放' : '播放中') : '还没创建'
      };
    },
    play: function (midi, delaySec, durSec, velocity) {
      if (!ctx || state.phase !== 'ready') return;
      var s = nearestSample(midi); if (s === null) return;
      var t0 = ctx.currentTime + (delaySec || 0), dur = Math.max(.08, durSec || 1), v = velocity || .8;
      var src = ctx.createBufferSource(); src.buffer = buffers[s]; src.playbackRate.value = Math.pow(2, (midi - s) / 12);
      var g = ctx.createGain();
      g.gain.setValueAtTime(v, t0); g.gain.setValueAtTime(v, t0 + dur); g.gain.exponentialRampToValueAtTime(.001, t0 + dur + .3);
      src.connect(g); g.connect(ctx.destination); src.start(t0); src.stop(t0 + dur + .35);
    }
  };
})();

/* ============================================================
   The player's loading screen. Before a question starts it covers the
   page, downloads and prepares everything the question needs (here
   the piano samples and the fonts), shows how far it is, and ends with
   a "开始" button. That tap is the gesture that lets phones play sound,
   so the first note after it plays on time.
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

    function run() {
      action.innerHTML = '';
      title.textContent = '正在准备这道题';
      progress(null, '');
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      Promise.all([SoundSource.preload(progress), fonts]).then(function () {
        progress(1, '准备好了');
        title.textContent = '准备好了';
        var b = document.createElement('button'); b.type = 'button'; b.className = 'pl-start'; b.textContent = '开始';
        b.addEventListener('click', function () { SoundSource.unlock(); el.classList.add('pl-gone'); });
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
  return { show: show };
})();

// The player's part: unlock on every touch, click or key press. Only
// touchend, click and keydown count as a gesture for starting media on
// phones, so all of them are listened to.
['pointerup', 'touchend', 'click', 'keydown'].forEach(function (t) {
  document.addEventListener(t, SoundSource.unlock, { capture: true, passive: true });
});
