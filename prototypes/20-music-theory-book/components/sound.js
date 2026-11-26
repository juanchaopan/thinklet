/* ============================================================
   Sound source: plays MIDI pitches with sampled piano. It knows
   nothing about scores or keyboards; anything that wants a sound
   calls play(). The player calls unlock() on every touch, because
   phones only start audio inside a gesture.

   On iPhones Web Audio stays muted by the ring/silent switch until
   a media element is playing. So unlock() also keeps a silent clip
   looping through an <audio> element; a play() the browser refuses
   is retried on the next touch.
   ============================================================ */
var SoundSource = (function () {
  var ctx = null, raw = null, buffers = {}, loading = null, media = null, mediaStarting = false, watchers = [];
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

  function context() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) { report('failed', '这个浏览器不支持 Web Audio'); return null; }
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* browsers without an audio session API */ }
      ctx = new C();
      ctx.onstatechange = function () { report(); };
    }
    if (ctx.state !== 'running') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
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

  // The samples sit next to the page, so a relative path works wherever the page is served from.
  function load() {
    if (!loading) {
      report('loading');
      loading = fetch('piano.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { raw = j; report('ready', Object.keys(j).length + ' 个采样'); })
        .catch(function (e) { raw = {}; report('failed', '采样没有加载出来（' + (e && e.message || e) + '）'); });
    }
    return loading;
  }

  function decode(midi) {
    if (buffers[midi]) return buffers[midi];
    var bin = atob(raw[midi]); var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    buffers[midi] = new Promise(function (res, rej) { ctx.decodeAudioData(bytes.buffer, res, rej); });
    buffers[midi].catch(function () { report('failed', '采样解码失败'); });
    return buffers[midi];
  }

  function nearestSample(midi) {
    var best = null, d = Infinity;
    Object.keys(raw || {}).forEach(function (k) { var dd = Math.abs(k - midi); if (dd < d) { d = dd; best = Number(k); } });
    return best;
  }

  return {
    unlock: function () {
      if (!context()) return;
      keepMediaPlaying();
      if (ctx.state !== 'running') { var s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); }
      load();
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
      var c = context(); if (!c) return;
      var at = c.currentTime + (delaySec || 0);
      load().then(function () {
        var s = nearestSample(midi); if (s === null) return;
        decode(s).then(function (buf) {
          var src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = Math.pow(2, (midi - s) / 12);
          var g = c.createGain(); var t0 = Math.max(at, c.currentTime); var dur = Math.max(.08, durSec || 1);
          var v = velocity || .8;
          g.gain.setValueAtTime(v, t0); g.gain.setValueAtTime(v, t0 + dur); g.gain.exponentialRampToValueAtTime(.001, t0 + dur + .3);
          src.connect(g); g.connect(c.destination); src.start(t0); src.stop(t0 + dur + .35);
        });
      });
    }
  };
})();

// The player's part: unlock on every touch, click or key press. Only
// touchend, click and keydown count as a gesture for starting media on
// phones, so all of them are listened to.
['pointerup', 'touchend', 'click', 'keydown'].forEach(function (t) {
  document.addEventListener(t, SoundSource.unlock, { capture: true, passive: true });
});
