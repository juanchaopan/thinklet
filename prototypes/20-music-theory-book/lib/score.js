/* ============================================================
   Score component. Inputs: abc, mode ('lecture' | 'practice'),
   playable, compact, caption. Commands: spotlight, highlight,
   label, slots, count, caption, play, stop, clear. Events (via
   onEvent): noteTap, blankTap, countStep, playStart, playEnd.
   Sound goes through the injected source, and only in lectures.
   ============================================================ */
function Score(host, options) {
  this.host = host;
  this.o = Object.assign({ mode: 'lecture', playable: false, compact: false, sound: null, onEvent: function () {} }, options);
  this.notes = [];
  this.timers = [];
  this.tapTimers = [];
  this.voices = [];
  this.build();
  this.render();
}
Score.SVGNS = 'http://www.w3.org/2000/svg';
Score.LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
Score.ACC = { sharp: '♯', flat: '♭', natural: '♮', dblsharp: '𝄪', dblflat: '𝄫' };
Score.ACC_EN = { sharp: 'sharp', flat: 'flat', natural: 'natural', dblsharp: 'double sharp', dblflat: 'double flat' };
Score.STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
Score.SHIFT = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
Score.TAP_REACH = 30;
Score.TAP_FADE_MS = 2000;
Score.uid = 0;

Score.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };

// Every note the score sounds goes through here, so stop() can silence
// the notes already scheduled ahead on the audio clock.
Score.prototype.note = function (midi, delay, dur, velocity) {
  var v = this.o.sound.play(midi, delay, dur, velocity);
  if (v) this.voices.push(v);
};
Score.prototype.silence = function () {
  this.voices.forEach(function (v) { v.stop(); });
  this.voices = [];
};

Score.prototype.build = function () {
  var self = this;
  this.id = 'tl-score-' + (++Score.uid);
  this.host.classList.add('tl-score');
  if (this.o.compact) this.host.classList.add('tl-compact');
  this.host.innerHTML = '';
  this.paper = document.createElement('div'); this.paper.className = 'tl-paper';
  this.box = document.createElement('div'); this.box.className = 'tl-svgbox'; this.box.id = this.id;
  this.overlay = document.createElement('div'); this.overlay.className = 'tl-overlay';
  this.playhead = document.createElement('div'); this.playhead.className = 'tl-playhead';
  this.overlay.appendChild(this.playhead);
  this.paper.appendChild(this.box); this.paper.appendChild(this.overlay);
  if (this.o.playable && this.o.mode === 'lecture') {
    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button'; this.playBtn.className = 'tl-play'; this.playBtn.setAttribute('aria-label', '播放这段谱');
    this.playBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg>';
    this.playBtn.addEventListener('click', function () { if (self.playing) self.stop(); else self.play(); });
    this.paper.appendChild(this.playBtn);
  }
  this.host.appendChild(this.paper);
  if (this.o.caption) { var c = document.createElement('p'); c.className = 'tl-caption'; c.textContent = this.o.caption; this.host.appendChild(c); }
};

// Lays the score out for the width it has, then lets the SVG fill that
// width: a full-size score is laid out narrower than the paper and scaled
// up, so on wide screens the notes are larger, and on narrow ones it wraps
// into more lines instead of shrinking. Only when a single bar with its
// clef, key, time signature and instrument names is still wider than the
// paper is the score drawn smaller, just enough to fit.
Score.prototype.render = function () {
  var self = this;
  var width = Math.max(150, this.box.clientWidth || this.host.clientWidth || 300);
  var scale = this.o.compact ? 1 : (width >= 700 ? 1.45 : 1.15);
  for (var attempt = 0; attempt < 4; attempt++) {
    this.draw(width, scale);
    var over = this.overflow();
    if (over <= 1.01) break;
    scale = scale / over;
  }
  this.svg = this.box.querySelector('svg');
  this.shortenNames();
  this.addDefs();
  this.collect();
  this.svg.setAttribute('tabindex', '0');
  this.svg.setAttribute('role', 'group');
  this.svg.setAttribute('aria-label', '乐谱：方向键换音符，回车听这个音');
  this.svg.addEventListener('pointerup', function (ev) { self.onPointer(ev); });
  this.svg.addEventListener('keydown', function (ev) { self.onKey(ev); });
  this.svg.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') self.host.classList.add('kbd-focus'); });
  this.svg.addEventListener('blur', function () { self.host.classList.remove('kbd-focus'); });
  this.svg.addEventListener('pointerdown', function () { self.host.classList.remove('kbd-focus'); });
  this.paper.addEventListener('pointerup', function (ev) { if (ev.target === self.paper) self.blankTap(); });
};

// The play button sits in the top right corner, so a playable score keeps
// its first line (tempo marking included) below the button and its staves
// clear of the button's column.
Score.prototype.draw = function (width, scale) {
  var reserved = this.playBtn ? 52 : 0;
  var layoutWidth = width / scale;
  var top = this.o.compact ? 6 : (this.playBtn ? 62 / scale : 34);
  var opts = {
    add_classes: true, responsive: 'resize', staffwidth: layoutWidth - 8 - reserved / scale,
    paddingtop: top, paddingbottom: this.o.compact ? 4 : 52, paddingleft: 2, paddingright: 2 + reserved / scale,
    format: { staffsep: this.o.compact ? 40 : 90, annotationfont: 'Cormorant Garamond 15 italic', tempofont: 'Cormorant Garamond 17 italic', voicefont: 'Cormorant Garamond 16 italic' }
  };
  if (!this.o.compact) opts.wrap = { minSpacing: 1.6, maxSpacing: 2.7, preferredMeasuresPerLine: layoutWidth < 450 ? 2 : 4 };
  this.visual = ABCJS.renderAbc(this.id, this.o.abc, opts)[0];
};

// How much wider the drawn music is than the drawing area (1 = it fits).
Score.prototype.overflow = function () {
  var svg = this.box.querySelector('svg'); if (!svg) return 1;
  var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  var w = vb.length === 4 && vb[2] ? vb[2] : svg.getBoundingClientRect().width;
  var right = 0;
  svg.querySelectorAll('.abcjs-staff, .abcjs-note, .abcjs-bar, .abcjs-tempo, .abcjs-dynamics, .abcjs-decoration').forEach(function (e) { var b = e.getBBox(); right = Math.max(right, b.x + b.width); });
  return w ? right / w : 1;
};

// Exam scores name each instrument in full on the first line and by its
// short name (the ABC voice's snm) on later lines. abcjs repeats the full
// name, so later occurrences are replaced here.
Score.prototype.shortenNames = function () {
  var short = {}, re = /name="([^"]+)"[^\n]*?snm="([^"]+)"/g, m;
  while ((m = re.exec(this.o.abc))) short[m[1]] = m[2];
  var seen = {};
  this.svg.querySelectorAll('text').forEach(function (t) {
    var name = t.textContent;
    if (!short[name]) return;
    if (seen[name]) t.textContent = short[name];
    seen[name] = true;
  });
};

Score.prototype.addDefs = function () {
  var defs = document.createElementNS(Score.SVGNS, 'defs');
  defs.innerHTML = '<filter id="' + this.id + '-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<radialGradient id="tl-spot-grad" cx="50%" cy="50%" r="60%"><stop offset="0%" style="stop-color:var(--tl-glow);stop-opacity:.24"/><stop offset="70%" style="stop-color:var(--tl-glow);stop-opacity:.08"/><stop offset="100%" style="stop-color:var(--tl-glow);stop-opacity:0"/></radialGradient>';
  this.svg.insertBefore(defs, this.svg.firstChild);
};

Score.prototype.pitchInfo = function (p, key, barAcc) {
  var letter = Score.LETTERS[((p.pitch % 7) + 7) % 7];
  var slot = letter + p.pitch;
  if (barAcc && p.accidental) barAcc[slot] = p.accidental;
  var acc = p.accidental || (barAcc && barAcc[slot]) || key[letter] || null;
  var midi = 60 + 12 * Math.floor(p.pitch / 7) + Score.STEP[letter] + (acc ? Score.SHIFT[acc] : 0);
  var octave = 4 + Math.floor(p.pitch / 7);
  return { pitch: p.pitch, midi: midi, name: letter + (acc ? Score.ACC[acc] : '') + octave, en: acc ? letter + ' ' + Score.ACC_EN[acc] : letter };
};

// Every pitched note in reading order, with its elements, the heads used for
// hit testing, the drawn shapes without text (a note's group also holds its
// text annotation, which can be wider than its neighbours), its bar, pitch,
// ornament, grace notes and the key it is in.
Score.prototype.collect = function () {
  var self = this; var out = [];
  var keyOf = function (k) { var m = {}; ((k && k.accidentals) || []).forEach(function (a) { m[a.note.toUpperCase()] = a.acc; }); return m; };
  var baseKey = {}; try { baseKey = keyOf(this.visual.getKeySignature()); } catch (e) { baseKey = {}; }
  (this.visual.lines || []).forEach(function (line) {
    (line.staff || []).forEach(function (staff) {
      var key = staff.key && staff.key.accidentals ? keyOf(staff.key) : baseKey;
      (staff.voices || []).forEach(function (voice) {
        var barAcc = {};
        voice.forEach(function (el) {
          if (el.el_type === 'bar') { barAcc = {}; return; }
          if (el.el_type !== 'note' || !el.pitches || !el.abselem) return;
          var elems = (el.abselem.elemset || []).filter(function (x) { return x && x.getBBox; });
          if (!elems.length) return;
          var heads = [], shapes = [];
          elems.forEach(function (e) {
            heads = heads.concat(Array.prototype.slice.call(e.querySelectorAll('.abcjs-notehead')));
            shapes = shapes.concat(e.tagName === 'path' ? [e] : Array.prototype.slice.call(e.querySelectorAll('path')));
          });
          var m = /abcjs-mm(\d+)/.exec(elems[0].getAttribute('class') || '');
          var v = /abcjs-v(\d+)/.exec(elems[0].getAttribute('class') || '');
          var graces = (el.gracenotes || []).map(function (g) { var info = self.pitchInfo(g, key, null); info.crushed = !!g.acciaccatura; return info; });
          out.push({
            index: out.length, bar: m ? Number(m[1]) : 0, voice: v ? v[1] : '0', elems: elems,
            heads: heads.length ? heads : elems, shapes: shapes.length ? shapes : elems,
            pitches: el.pitches.map(function (p) { return self.pitchInfo(p, key, barAcc); }),
            ornament: (el.decoration || []).filter(function (d) { return /trill|turn|mordent|pralltriller/.test(d); })[0] || null,
            graces: graces, key: key, beats: el.duration || .25
          });
        });
      });
    });
  });
  this.notes = out;
};

// The diatonic neighbour of a note in its key: one letter up or down.
Score.prototype.neighbour = function (n, step) {
  var p = n.pitches[0];
  return this.pitchInfo({ pitch: p.pitch + step }, n.key, null).midi;
};

// How a note actually sounds when tapped: ornaments and grace notes are
// played out, so a child hears what the sign means.
Score.prototype.realise = function (n) {
  var main = n.pitches[0].midi; var up = this.neighbour(n, 1); var down = this.neighbour(n, -1);
  var fast = .085;
  if (n.ornament === 'trill') {
    var seq = []; for (var i = 0; i < 12; i++) seq.push([i % 2 ? up : main, fast]);
    seq.push([main, .7]); return seq;
  }
  if (n.ornament === 'turn') return [[up, .14], [main, .14], [down, .14], [main, .8]];
  if (n.ornament === 'uppermordent' || n.ornament === 'pralltriller') return [[main, fast], [up, fast], [main, .9]];
  if (n.ornament === 'lowermordent' || n.ornament === 'mordent') return [[main, fast], [down, fast], [main, .9]];
  if (n.graces.length) {
    var g = n.graces[0];
    return g.crushed ? [[g.midi, .06], [main, .9]] : [[g.midi, .45], [main, .45]];
  }
  return null;
};

Score.prototype.boxOf = function (elems) {
  var x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
  elems.forEach(function (e) { var b = e.getBBox(); x1 = Math.min(x1, b.x); x2 = Math.max(x2, b.x + b.width); y1 = Math.min(y1, b.y); y2 = Math.max(y2, b.y + b.height); });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
};

Score.prototype.staffAround = function (b) {
  var top = Infinity, bottom = -Infinity;
  this.svg.querySelectorAll('.abcjs-staff').forEach(function (s) {
    var r = s.getBBox(); if (b.cy < r.y - 60 || b.cy > r.y + r.height + 60) return;
    top = Math.min(top, r.y); bottom = Math.max(bottom, r.y + r.height);
  });
  return { top: top, bottom: bottom };
};

// Where a mark above a note goes: over the staff and over the note's own
// stem or flag, centred on its head.
Score.prototype.above = function (n, gap) {
  var head = this.boxOf(n.heads); var body = this.boxOf(n.shapes); var st = this.staffAround(head);
  return this.toPaper(head.cx, Math.min(st.top, body.y) - gap);
};

// SVG user units to pixels inside the paper, for HTML overlays.
Score.prototype.toPaper = function (x, y) {
  var pt = this.svg.createSVGPoint(); pt.x = x; pt.y = y;
  var p = pt.matrixTransform(this.svg.getScreenCTM());
  var r = this.paper.getBoundingClientRect();
  return { x: p.x - r.left, y: p.y - r.top };
};

Score.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };

// The note under a tap: the nearest head within reach (in drawing units) of
// the tap, on the system under the finger. Taps further away hit nothing.
Score.prototype.nearest = function (clientX, clientY) {
  var pt = this.svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
  var m = this.svg.getScreenCTM(); if (!m) return null;
  var p = pt.matrixTransform(m.inverse());
  var self = this, best = null, bestD = Infinity;
  this.notes.forEach(function (n) {
    var b = self.boxOf(n.heads); var st = self.staffAround(b);
    if (p.y < Math.min(st.top, b.y) - 36 || p.y > Math.max(st.bottom, b.y + b.h) + 36) return;
    var dx = Math.max(0, Math.abs(p.x - b.cx) - b.w / 2); var dy = Math.max(0, Math.abs(p.y - b.cy) - b.h / 2);
    if (dx > Score.TAP_REACH) return;
    var d = dx * dx + dy * dy * .25; if (d < bestD) { bestD = d; best = n; }
  });
  return best;
};

Score.prototype.onPointer = function (ev) {
  var n = this.nearest(ev.clientX, ev.clientY);
  if (!n) { this.blankTap(); return; }
  this.current = n.index; this.tap(n);
};

Score.prototype.blankTap = function () {
  this.clearTap();
  this.emit('blankTap', {});
};

Score.prototype.onKey = function (ev) {
  if (!this.notes.length) return;
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
    ev.preventDefault();
    var cur = this.current === undefined ? -1 : this.current;
    this.current = Math.min(this.notes.length - 1, Math.max(0, cur + (ev.key === 'ArrowRight' ? 1 : -1)));
    this.tap(this.notes[this.current]);
  } else if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault(); if (this.current !== undefined) this.tap(this.notes[this.current]);
  } else if (ev.key === 'Escape') {
    this.blankTap();
  }
};

// A tap lights the note, plays it (lectures only) and reports it; the light
// and any caption fade by themselves after a moment.
Score.prototype.tap = function (n) {
  var self = this;
  this.clearTap();
  this.tapLit = [n.index];
  this.lit([n.index]);
  this.ripple(n);
  if (this.audible()) {
    var seq = this.realise(n);
    if (seq) { var t = 0; seq.forEach(function (s) { self.note(s[0], t, s[1]); t += s[1]; }); }
    else n.pitches.forEach(function (p) { self.note(p.midi, 0, .9); });
  }
  this.emit('noteTap', { index: n.index, bar: n.bar + 1, name: n.pitches[0].name, en: n.pitches[0].en, ornament: n.ornament, midi: n.pitches.map(function (p) { return p.midi; }) });
  this.tapTimers.push(setTimeout(function () {
    self.overlay.querySelectorAll('.tl-bubble').forEach(function (b) { b.classList.add('out'); });
    self.unlitIndices(self.tapLit || []);
  }, Score.TAP_FADE_MS));
  this.tapTimers.push(setTimeout(function () { self.overlay.querySelectorAll('.tl-bubble.out').forEach(function (b) { b.remove(); }); }, Score.TAP_FADE_MS + 600));
};

Score.prototype.clearTap = function () {
  this.tapTimers.forEach(clearTimeout); this.tapTimers = [];
  this.unlitIndices(this.tapLit || []); this.tapLit = null;
  this.overlay.querySelectorAll('.tl-bubble').forEach(function (b) { b.remove(); });
};

Score.prototype.ripple = function (n) {
  var b = this.boxOf(n.heads);
  var c = document.createElementNS(Score.SVGNS, 'circle');
  c.setAttribute('class', 'tl-mark tl-ripple'); c.setAttribute('cx', b.cx); c.setAttribute('cy', b.cy); c.setAttribute('r', Math.max(8, b.w));
  this.svg.appendChild(c);
  setTimeout(function () { c.remove(); }, 600);
};

Score.prototype.lit = function (indices) {
  var self = this;
  indices.forEach(function (i) { var n = self.notes[i]; if (!n) return; n.elems.forEach(function (e) { e.classList.add('tl-lit'); e.setAttribute('filter', 'url(#' + self.id + '-glow)'); }); });
};
Score.prototype.unlitIndices = function (indices) {
  var self = this; var held = this.held || {};
  indices.forEach(function (i) { var n = self.notes[i]; if (!n || held[i]) return; n.elems.forEach(function (e) { e.classList.remove('tl-lit'); e.removeAttribute('filter'); }); });
};
Score.prototype.unlitAll = function () {
  this.svg.querySelectorAll('.tl-lit').forEach(function (e) { e.classList.remove('tl-lit'); e.removeAttribute('filter'); });
};

// Notes the workflow asked to keep lit stay lit after a tap fades.
Score.prototype.highlight = function (indices) {
  var self = this; this.held = {};
  this.unlitAll(); indices.forEach(function (i) { self.held[i] = true; }); this.lit(indices);
};

Score.prototype.notesOfBar = function (bar) { return this.notes.filter(function (n) { return n.bar === bar - 1; }); };

Score.prototype.spotlight = function (bar) {
  this.svg.querySelectorAll('.tl-spot').forEach(function (s) { s.remove(); });
  this.svg.querySelectorAll('.tl-dim').forEach(function (e) { e.classList.remove('tl-dim'); });
  if (!bar) { this.highlight([]); return; }
  var inBar = this.notesOfBar(bar);
  if (!inBar.length) return;
  var keep = new Set(); inBar.forEach(function (n) { n.elems.forEach(function (e) { keep.add(e); }); });
  this.notes.forEach(function (n) { n.elems.forEach(function (e) { if (!keep.has(e)) e.classList.add('tl-dim'); }); });
  var b = this.boxOf(inBar.reduce(function (a, n) { return a.concat(n.shapes); }, []));
  var st = this.staffAround(b);
  var top = Math.min(b.y, st.top) - 22, bottom = Math.max(b.y + b.h, st.bottom) + 22;
  var e = document.createElementNS(Score.SVGNS, 'ellipse');
  e.setAttribute('class', 'tl-mark tl-spot'); e.setAttribute('cx', b.cx); e.setAttribute('cy', (top + bottom) / 2);
  e.setAttribute('rx', b.w / 2 + 40); e.setAttribute('ry', (bottom - top) / 2 + 10);
  this.svg.insertBefore(e, this.svg.querySelector('defs').nextSibling);
  requestAnimationFrame(function () { requestAnimationFrame(function () { e.classList.add('on'); }); });
  this.highlight(inBar.map(function (n) { return n.index; }));
};

Score.prototype.label = function (index, text) {
  var n = this.notes[index]; if (!n) return;
  var p = this.above(n, 18);
  var d = document.createElement('div'); d.className = 'tl-badge'; d.textContent = text;
  d.style.left = p.x + 'px'; d.style.top = p.y + 'px'; d.style.animationDelay = (index % 5) * 60 + 'ms';
  this.overlay.appendChild(d);
};

Score.prototype.caption = function (index, html) {
  this.overlay.querySelectorAll('.tl-bubble').forEach(function (e) { e.remove(); });
  var n = this.notes[index]; if (!n) return;
  var p = this.above(n, 4);
  var d = document.createElement('div'); d.className = 'tl-bubble'; d.innerHTML = html;
  d.style.left = Math.max(70, Math.min(this.paper.clientWidth - 70, p.x)) + 'px'; d.style.top = p.y + 'px';
  this.overlay.appendChild(d);
};

// Returns where each answer box sits, so an answering component can own it.
Score.prototype.slots = function (indices) {
  var self = this; var places = [];
  indices.forEach(function (i, k) {
    var n = self.notes[i]; if (!n) return;
    var b = self.boxOf(n.heads); var st = self.staffAround(b); var body = self.boxOf(n.shapes);
    var y = Math.max(st.bottom, body.y + body.h) + 14;
    var r = document.createElementNS(Score.SVGNS, 'rect');
    r.setAttribute('class', 'tl-mark tl-slot'); r.setAttribute('x', b.cx - 16); r.setAttribute('y', y);
    r.setAttribute('width', 32); r.setAttribute('height', 32); r.setAttribute('rx', 8); r.style.animationDelay = k * 70 + 'ms';
    self.svg.appendChild(r);
    places.push(self.toPaper(b.cx, y + 16));
  });
  return places;
};

Score.prototype.count = function (indices) {
  var self = this; this.clearTimers();
  var list = indices || this.notes.map(function (n) { return n.index; });
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  list.forEach(function (idx, k) {
    self.timers.push(setTimeout(function () {
      var n = self.notes[idx]; self.unlitAll(); self.lit([idx]);
      if (self.audible()) n.pitches.forEach(function (p) { self.note(p.midi, 0, .5, .6); });
      var p = self.above(n, 14);
      var d = document.createElement('div'); d.className = 'tl-count'; d.textContent = String(k + 1);
      d.style.left = p.x + 'px'; d.style.top = p.y + 'px'; self.overlay.appendChild(d);
      self.emit('countStep', { n: k + 1, index: idx });
      if (k === list.length - 1) self.timers.push(setTimeout(function () { self.unlitAll(); }, 900));
    }, k * (reduce ? 150 : 650)));
  });
};

Score.prototype.clearTimers = function () { this.timers.forEach(clearTimeout); this.timers = []; };

// Plays the notes (all, or one bar) in time; a glowing playhead walks over
// the system and each note lights as it sounds.
Score.prototype.play = function (bar) {
  var self = this; this.stop();
  if (!this.audible()) return;
  var list = bar ? this.notesOfBar(bar) : this.notes;
  if (!list.length) return;
  var secPerWhole = 4 * 60 / 84;
  var voices = {};
  list.forEach(function (n) { (voices[n.voice] = voices[n.voice] || []).push(n); });
  var schedule = [];
  Object.keys(voices).forEach(function (v) {
    var t = 0;
    voices[v].forEach(function (n) { var dur = n.beats * secPerWhole; schedule.push({ n: n, t: t, dur: dur, lead: v === '0' }); t += dur; });
  });
  var end = schedule.reduce(function (m, s) { return Math.max(m, s.t + s.dur); }, 0);
  this.playing = true;
  if (this.playBtn) this.playBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h4v12H5zM11 4h4v12h-4z"/></svg>';
  this.emit('playStart', { bar: bar || null });
  schedule.forEach(function (s) {
    s.n.pitches.forEach(function (p) { self.note(p.midi, s.t, s.dur, .75); });
    self.timers.push(setTimeout(function () {
      self.lit([s.n.index]);
      self.timers.push(setTimeout(function () { self.unlitIndices([s.n.index]); }, Math.max(120, s.dur * 1000 - 40)));
      if (s.lead) {
        var b = self.boxOf(s.n.heads);
        var sys = self.systemAround(b);
        var p1 = self.toPaper(b.cx, sys.top - 10); var p2 = self.toPaper(b.cx, sys.bottom + 10);
        self.playhead.style.left = p1.x + 'px'; self.playhead.style.top = p1.y + 'px'; self.playhead.style.height = (p2.y - p1.y) + 'px';
        self.playhead.classList.add('on');
      }
    }, s.t * 1000));
  });
  this.timers.push(setTimeout(function () { self.voices = []; self.stop(); self.emit('playEnd', {}); }, end * 1000 + 200));
};

// The whole system (all staves played together) that holds a box, so the
// playhead spans the violin and both piano staves.
Score.prototype.systemAround = function (b) {
  var staves = Array.prototype.map.call(this.svg.querySelectorAll('.abcjs-staff'), function (s) { return s.getBBox(); });
  staves.sort(function (a, c) { return a.y - c.y; });
  var groups = []; var cur = null;
  staves.forEach(function (r) {
    if (cur && r.y - cur.bottom < 70) { cur.bottom = Math.max(cur.bottom, r.y + r.height); }
    else { cur = { top: r.y, bottom: r.y + r.height }; groups.push(cur); }
  });
  var found = groups.find(function (g) { return b.cy >= g.top - 60 && b.cy <= g.bottom + 60; });
  return found || { top: b.y, bottom: b.y + b.h };
};

// Stops a playback or a count: timers are cleared and every note still
// queued or sounding is silenced.
Score.prototype.stop = function () {
  this.clearTimers();
  this.silence();
  this.playing = false; this.playhead.classList.remove('on');
  if (this.playBtn) this.playBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg>';
  var held = this.held || {};
  this.unlitIndices(this.notes.map(function (n) { return n.index; }).filter(function (i) { return !held[i]; }));
};

Score.prototype.clear = function () {
  this.stop(); this.clearTap(); this.spotlight(null); this.held = {}; this.unlitAll();
  this.svg.querySelectorAll('.tl-mark').forEach(function (m) { m.remove(); });
  this.overlay.querySelectorAll('.tl-badge, .tl-count, .tl-bubble').forEach(function (m) { m.remove(); });
};

