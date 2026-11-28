/* ============================================================
   Sound (draws nothing). The sound effects every component shares, and
   the audio output under them: one audio context for the page, kept
   able to play on phones. A component that makes a sound needs this one
   (component.json) and calls Sound directly; an instrument such as the
   piano plays through Sound.context().

   Effects:
     tap()            the touch sound: a short, soft wooden "dup" made on
                      the spot (no sample, no pitch of the music), so a
                      press feels like pressing a real key
     pressable(el)    from now on a press on anything inside el that
                      shows the pointing hand, and is not disabled, plays
                      tap()

   The audio output: context() is the page's one audio context. It can be
   created and can decode before any gesture; it only stays suspended
   until unlock() resumes it. On iPhones Web Audio stays muted by the
   ring/silent switch until a media element is playing, and phones only
   start audio inside a gesture, so unlock() resumes the context and
   keeps a silent clip looping through an <audio> element; it runs on
   every touch, click and key press, so a start the browser refused is
   retried on the next one.

   watch(fn) is told whenever the output changes; status() says how it
   stands (engine: the context's state, media: the silent clip's).
   ============================================================ */
var Sound = (function () {
  var ctx = null, media = null, mediaStarting = false, watchers = [];
  // The touch sound: a pitch falling from TAP_HZ to TAP_TO_HZ over
  // TAP_FALL s, with a hollow overtone, rising in TAP_ATTACK s and dying
  // away by TAP_LEN s; quiet, so it never covers the narration.
  var TAP_HZ = 760, TAP_TO_HZ = 520, TAP_FALL = .06, TAP_ATTACK = .004, TAP_LEN = .16, TAP_GAIN = .14, TAP_LOWPASS = 2600;

  function report() { watchers.forEach(function (f) { f(status()); }); }

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
      if (!C) return null;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* browsers without an audio session API */ }
      ctx = new C();
      ctx.onstatechange = report;
    }
    return ctx;
  }

  function keepMediaPlaying() {
    if (!media) {
      try {
        media = new Audio(URL.createObjectURL(silentWav()));
        media.loop = true;
        media.setAttribute('playsinline', '');
        media.addEventListener('playing', report);
        media.addEventListener('pause', report);
      } catch (e) { return; }
    }
    if (!media.paused || mediaStarting) return;
    mediaStarting = true;
    var p = media.play();
    if (p && p.then) p.then(function () { mediaStarting = false; report(); }, function () { mediaStarting = false; report(); });
    else mediaStarting = false;
  }

  function unlock() {
    var c = context(); if (!c) return;
    if (c.state !== 'running') {
      var p = c.resume(); if (p && p.catch) p.catch(function () {});
      var s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0);
    }
    keepMediaPlaying();
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

  // The press is heard when the finger goes down, before the click.
  function pressable(el) {
    el.addEventListener('pointerdown', function (ev) {
      var t = ev.target;
      if (!(t instanceof Element) || t.closest('[disabled]')) return;
      if (getComputedStyle(t).cursor === 'pointer') tap();
    }, true);
  }

  function status() {
    return {
      engine: ctx ? ctx.state : '还没创建',
      media: media ? (media.paused ? '没有播放' : '播放中') : '还没创建'
    };
  }

  // Only touchend, click and keydown count as a gesture for starting
  // media on phones, so all of them are listened to.
  ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (t) {
    document.addEventListener(t, unlock, { capture: true, passive: true });
  });

  if (window.LessonComponents) LessonComponents.register('sound', {});
  return {
    context: context, unlock: unlock, tap: tap, pressable: pressable,
    watch: function (f) { watchers.push(f); f(status()); },
    status: status
  };
})();
