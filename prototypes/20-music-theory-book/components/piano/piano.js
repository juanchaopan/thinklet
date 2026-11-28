/* ============================================================
   Piano (draws nothing). Plays MIDI pitches with sampled piano through
   the sound component's audio output; it knows nothing about scores,
   keyboards or grids. A component whose notes sound needs this one
   (component.json) and is handed it as the thing its notes play on.

   Its samples are its own: 21 piano notes from C2 to C7 in piano.json
   beside this script (base64 MP3, packed by the prototype's
   tools/pack-samples.mjs), found from where this script is served.
   preload(progress) downloads and decodes all of them before an item
   starts, so play() always schedules at once and the first notes keep
   their timing; play() before preload() has finished makes no sound.

   play(midi, delaySec, durSec, velocity) schedules a note ahead on the
   audio clock and returns a voice whose stop() silences it, whether it
   is sounding or still waiting to start. A component keeps the voices it
   scheduled and stops them when it is told to stop, so pausing a
   playback silences the notes already queued, and one component never
   silences another's.

   watch(fn) is told whenever it changes; status() says how it stands:
   phase (idle, loading, ready, failed), detail, voices sounding, and the
   sound component's output.
   ============================================================ */
var Piano = (function () {
  var SCRIPT = document.currentScript && document.currentScript.src;
  var SAMPLES_URL = SCRIPT ? new URL('piano.json', SCRIPT).href : 'piano.json';
  var buffers = {}, keys = [], preloading = null, watchers = [], sounding = 0;
  var state = { phase: 'idle', detail: '' };
  var SILENT_VOICE = { stop: function () {} };
  var RELEASE = .3, CUT = .04;

  function status() {
    var out = Sound.status();
    return { phase: state.phase, detail: state.detail, voices: sounding, engine: out.engine, media: out.media };
  }
  function report(phase, detail) {
    if (phase) state = { phase: phase, detail: detail || '' };
    watchers.forEach(function (f) { f(status()); });
  }
  Sound.watch(function () { report(); });

  // Reads a response body chunk by chunk so a loading screen can show how
  // far the download is. Without a length header (a compressed response)
  // only the bytes so far are known.
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
  // goes to progress(fraction 0..1 or null when unknown, text).
  function preload(progress) {
    var tell = progress || function () {};
    if (preloading) { preloading.then(function () { tell(1, ''); }); return preloading; }
    var c = Sound.context();
    if (!c) { report('failed', '这个浏览器不支持 Web Audio'); return Promise.reject(new Error('no Web Audio')); }
    report('loading', '下载中');
    preloading = fetch(SAMPLES_URL).then(function (r) {
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
    var ctx = Sound.context();
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

  if (window.LessonComponents) LessonComponents.register('piano', { preload: preload });
  return {
    preload: preload, play: play, status: status,
    watch: function (f) { watchers.push(f); f(status()); }
  };
})();
