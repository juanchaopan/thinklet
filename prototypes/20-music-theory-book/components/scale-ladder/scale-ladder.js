/* ============================================================
   Scale ladder component. One scale drawn as a ladder: rung heights
   follow semitones, so tones and semitones are visible as distance.
   Inputs: tonic ('Eb', 'F#'), scale ('major' | 'natural minor' |
   'harmonic minor' | 'melodic minor'), from, to (degrees, default
   1..8), mode ('lecture' | 'practice'), playable, compact, caption.
   Commands: highlight, label, steps, count, mask, reveal, chord, key,
   spotlight, caption, play, stop, clear. Events (via onEvent):
   rungTap, blankTap, countStep, playStart, playEnd. Sound goes through
   the injected source, lectures only.
   Its look is scale-ladder.css; colours come from the theme constants
   (--th-<name>) set on the page or stage around the ladder.
   ============================================================ */
function ScaleLadder(host, options) {
  this.host = host;
  this.o = Object.assign({ tonic: 'C', scale: 'major', from: 1, to: 8, mode: 'lecture', playable: false, compact: false, caption: '', sound: null, onEvent: function () {} }, options);
  this.held = {};
  this.masked = { name: {}, numeral: {}, technical: {} };
  this.suffix = {};
  this.marks = [];
  this.descending = false;
  this.timers = [];
  this.tapTimers = [];
  this.voices = [];
  this.build();
}
ScaleLadder.LETTERS = 'CDEFGAB';
ScaleLadder.NATURAL = [0, 2, 4, 5, 7, 9, 11];
ScaleLadder.PATTERNS = {
  'major': [0, 2, 4, 5, 7, 9, 11],
  'natural minor': [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic minor': [0, 2, 3, 5, 7, 9, 11]
};
ScaleLadder.TECHNICAL = ['Tonic', 'Supertonic', 'Mediant', 'Subdominant', 'Dominant', 'Submediant'];
ScaleLadder.ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
ScaleLadder.ACC_WORD = { '2': ' double sharp', '1': ' sharp', '-1': ' flat', '-2': ' double flat' };
ScaleLadder.ACC_TEXT = { '2': '𝄪', '1': '♯', '-1': '♭', '-2': '𝄫' };
ScaleLadder.TAP_FADE_MS = 2000;
ScaleLadder.MOVE_MS = 600;

ScaleLadder.parseTonic = function (t) {
  var L = ScaleLadder.LETTERS.indexOf(t.charAt(0).toUpperCase());
  var rest = t.slice(1), acc = 0;
  for (var i = 0; i < rest.length; i++) { var c = rest.charAt(i); if (c === '#' || c === '♯') acc++; else if (c === 'b' || c === '♭') acc--; }
  return { L: L, acc: acc };
};

// Accidental glyphs drawn by the score library, so a sharp here is the
// same shape as a sharp on the score. Each keeps its path and where the
// staff line it was drawn against sits, for vertical alignment in text.
ScaleLadder.glyphs = function () {
  if (ScaleLadder._glyphs) return ScaleLadder._glyphs;
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:900px;visibility:hidden';
  document.body.appendChild(box);
  ABCJS.renderAbc(box, 'X:1\nL:1/4\nK:C clef=none stafflines=1\nV:1 stem=up\n^B _B =B ^^B __B|', { add_classes: true, staffwidth: 800 });
  var lb = box.querySelector('.abcjs-top-line').getBBox();
  var out = { lineY: lb.y + lb.height / 2 }, kinds = [1, -1, 0, 2, -2];
  box.querySelectorAll('.abcjs-note').forEach(function (g, i) {
    var p = [].filter.call(g.querySelectorAll('path'), function (q) { return !q.getAttribute('class'); })[0];
    if (!p) return;
    var bb = p.getBBox();
    out[kinds[i]] = { d: p.getAttribute('d'), x: bb.x, w: bb.width };
  });
  box.remove();
  ScaleLadder._glyphs = out;
  return out;
};

// A note name as HTML: the letter in the serif, the accidental as the
// library glyph scaled to the text and centred a third of an em above
// the baseline, where it sits in printed note names.
ScaleLadder.nameHtml = function (letter, acc, fontPx) {
  if (!acc) return letter;
  var G = ScaleLadder.glyphs(), g = G[acc]; if (!g) return letter + ScaleLadder.ACC_TEXT[acc];
  var s = fontPx * 0.034, band = 14;
  var w = (g.w + 1) * s, h = band * 2 * s, lift = 0.33 * fontPx - band * s;
  return letter + '<svg viewBox="' + (g.x - .5) + ' ' + (G.lineY - band) + ' ' + (g.w + 1) + ' ' + band * 2 + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" style="vertical-align:' + lift.toFixed(1) + 'px;margin-left:1px" aria-hidden="true"><path d="' + g.d + '"/></svg>';
};

ScaleLadder.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };
ScaleLadder.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
ScaleLadder.prototype.melodic = function () { return this.o.scale === 'melodic minor'; };

// Every note the ladder sounds goes through here, so stop() can silence
// the notes already scheduled ahead on the audio clock.
ScaleLadder.prototype.note = function (midi, delay, dur, velocity) {
  var v = this.o.sound.play(midi, delay, dur, velocity);
  if (v) this.voices.push(v);
};
ScaleLadder.prototype.silence = function () {
  (this.voices || []).forEach(function (v) { v.stop(); });
  this.voices = [];
};

// The semitone pattern in force: melodic minor coming down is the natural minor.
ScaleLadder.prototype.pattern = function (descending) {
  if (this.melodic() && descending) return ScaleLadder.PATTERNS['natural minor'];
  return ScaleLadder.PATTERNS[this.o.scale] || ScaleLadder.PATTERNS.major;
};

// The tonic sits between G3 and F#4 so every degree up to the 10th stays
// inside the sampled range.
ScaleLadder.prototype.tonicMidi = function () {
  var t = ScaleLadder.parseTonic(this.o.tonic);
  var pc = ((ScaleLadder.NATURAL[t.L] + t.acc) % 12 + 12) % 12;
  var m = 48 + pc; while (m < 55) m += 12;
  return m;
};

// Everything about one degree: its letter is the tonic's letter moved up
// by the degree, its pitch comes from the pattern, and the accidental is
// whatever bridges the two.
ScaleLadder.prototype.degree = function (d, descending) {
  var t = ScaleLadder.parseTonic(this.o.tonic), pat = this.pattern(descending);
  var tonic = this.tonicMidi(), tonicNatural = tonic - t.acc;
  var k = d - 1, j = t.L + k, li = ((j % 7) + 7) % 7;
  var letterMidi = tonicNatural - ScaleLadder.NATURAL[t.L] + ScaleLadder.NATURAL[li] + 12 * Math.floor(j / 7);
  var kk = ((k % 7) + 7) % 7;
  var midi = tonic + pat[kk] + 12 * Math.floor(k / 7);
  var acc = midi - letterMidi, letter = ScaleLadder.LETTERS.charAt(li);
  var technical = kk < 6 ? ScaleLadder.TECHNICAL[kk] : (12 - pat[6] === 1 ? 'Leading note' : 'Subtonic');
  return {
    d: d, letter: letter, acc: acc, midi: midi, semis: midi - tonic,
    technical: technical, numeral: ScaleLadder.ROMAN[kk],
    spoken: letter + (ScaleLadder.ACC_WORD[acc] || ''),
    plain: letter + (ScaleLadder.ACC_TEXT[acc] || '')
  };
};

ScaleLadder.prototype.range = function () { var r = []; for (var d = this.o.from; d <= this.o.to; d++) r.push(d); return r; };

// Columns and spacing. Rung spacing is a fixed number of pixels per
// semitone, the same for every ladder of one size, so ladders shown side
// by side line up rung for rung. A small ladder hangs its name cards over
// the rails, so it fits a third of a phone screen.
ScaleLadder.prototype.layout = function (width) {
  var c = this.o.compact, narrow = !c && width < 440;
  var L = { unit: c ? 20 : (narrow ? 24 : 28), cardH: c ? 17 : (narrow ? 20 : 24), nameSize: c ? 15 : (narrow ? 18 : 20), margin: 12, railW: 9, narrow: narrow };
  if (c) {
    L.stepsW = 30; L.numW = 0; L.techW = 0;
    L.ladW = Math.max(40, Math.min(90, width - L.stepsW));
    L.cardW = Math.min(50, L.ladW - 8);
    L.railL = L.stepsW + Math.round(L.ladW * .14);
    L.railR = L.stepsW + L.ladW - Math.round(L.ladW * .14) - L.railW;
  } else {
    L.stepsW = 44; L.numW = narrow ? 36 : 44; L.ladW = narrow ? 96 : 128;
    L.techW = Math.max(80, Math.min(170, width - L.stepsW - L.numW - L.ladW - 8));
    L.railL = L.stepsW + L.numW + 12;
    L.railR = L.stepsW + L.numW + L.ladW - 12 - L.railW;
    L.cardW = L.railR - L.railL - 12;
  }
  L.ladX = L.stepsW + L.numW;
  L.total = L.ladX + L.ladW + (L.techW ? L.techW + 8 : 0);
  L.cardX = L.ladX + L.ladW / 2;
  L.techX = L.ladX + L.ladW + 8;
  return L;
};

ScaleLadder.prototype.build = function () {
  var self = this;
  this.stop(); this.clearTap();
  var playable = this.o.playable && this.o.mode === 'lecture';
  this.host.classList.add('tl-sl');
  this.host.classList.toggle('tl-sl-compact', !!this.o.compact);
  this.host.classList.toggle('tl-sl-playable', playable);
  this.host.innerHTML = '';
  this.case = document.createElement('div'); this.case.className = 'tl-sl-case';
  this.frame = document.createElement('div'); this.frame.className = 'tl-sl-frame';
  this.case.appendChild(this.frame);
  this.host.appendChild(this.case);
  if (this.o.caption) { var cap = document.createElement('p'); cap.className = 'tl-sl-caption'; cap.textContent = this.o.caption; this.host.appendChild(cap); }

  var width = Math.max(70, (this.host.clientWidth || 300) - (this.o.compact ? 8 : 24));
  var L = this.L = this.layout(width);
  this.host.classList.toggle('tl-sl-narrow', L.narrow);
  this.frame.style.width = L.total + 'px';
  this.frame.style.setProperty('--tl-name-size', L.nameSize + 'px');
  this.rails = [L.railL, L.railR].map(function (x) {
    var r = document.createElement('div'); r.className = 'tl-sl-rail'; r.style.left = x + 'px';
    self.frame.appendChild(r); return r;
  });
  this.rungs = {};
  this.range().forEach(function (d) {
    var r = document.createElement('button'); r.type = 'button'; r.tabIndex = -1; r.className = 'tl-sl-rung'; r.dataset.degree = d;
    r.style.height = L.cardH + 'px';
    r.innerHTML = '<span class="tl-sl-num"></span><span class="tl-sl-dowel"></span><span class="tl-sl-card"></span><span class="tl-sl-tech"></span>';
    var num = r.querySelector('.tl-sl-num'), dowel = r.querySelector('.tl-sl-dowel'), card = r.querySelector('.tl-sl-card'), tech = r.querySelector('.tl-sl-tech');
    if (L.numW) { num.style.left = L.stepsW + 'px'; num.style.width = L.numW - 4 + 'px'; } else num.remove();
    dowel.style.left = L.railL + 'px'; dowel.style.width = L.railR + L.railW - L.railL + 'px';
    card.style.left = L.cardX + 'px'; card.style.width = L.cardW + 'px';
    if (L.techW) { tech.style.left = L.techX + 'px'; tech.style.width = L.techW + 'px'; } else tech.remove();
    self.frame.appendChild(r);
    self.rungs[d] = r;
  });
  this.overlay = document.createElement('div'); this.overlay.className = 'tl-sl-overlay';
  this.overlay.innerHTML = '<svg aria-hidden="true"></svg>';
  this.braces = this.overlay.querySelector('svg');
  this.frame.appendChild(this.overlay);

  if (playable) {
    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button'; this.playBtn.className = 'tl-sl-play';
    this.playBtn.addEventListener('click', function (ev) { ev.stopPropagation(); if (self.playing) self.stop(); else self.play(); });
    this.playBtn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    this.case.appendChild(this.playBtn);
    this.playIcon(false);
  } else this.playBtn = null;

  this.place(false);
  var first = this.rungs[this.o.from]; if (first) first.tabIndex = 0;
  this.case.addEventListener('pointerdown', function (ev) { self.onPointer(ev); });
  this.case.addEventListener('keydown', function (ev) { self.onKey(ev); });
  this.case.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') self.host.classList.add('kbd'); });
  this.restore();
};

// Puts every rung at its height for the current key and form and writes
// its names. With `animated`, rungs slide and changed names are re-inked.
ScaleLadder.prototype.place = function (animated) {
  var self = this, L = this.L;
  var info = {}, lo = Infinity, hi = -Infinity;
  this.range().forEach(function (d) { var g = self.degree(d, self.descending); info[d] = g; lo = Math.min(lo, g.semis); hi = Math.max(hi, g.semis); });
  this.info = info;
  this.span = { lo: lo, hi: hi };
  var height = 2 * L.margin + L.cardH + (hi - lo) * L.unit;
  this.frame.style.height = height + 'px';
  this.rails.forEach(function (r) { r.style.top = L.margin - 4 + 'px'; r.style.height = height - 2 * L.margin + 8 + 'px'; });
  this.range().forEach(function (d) {
    var g = info[d], r = self.rungs[d];
    r.style.top = self.yOf(d) - L.cardH / 2 + 'px';
    r.classList.toggle('tl-sl-tonic', (d - 1) % 7 === 0);
    self.write(r.querySelector('.tl-sl-card'), self.masked.name[d] ? null : '<span class="tl-sl-name">' + ScaleLadder.nameHtml(g.letter, g.acc, L.nameSize) + '</span>', animated, true);
    var num = r.querySelector('.tl-sl-num'); if (num) self.write(num, self.masked.numeral[d] ? null : g.numeral + (self.suffix[d] || ''), animated, false);
    var tech = r.querySelector('.tl-sl-tech'); if (tech) self.write(tech, self.masked.technical[d] ? null : g.technical, animated, false);
    r.setAttribute('aria-label', '第 ' + d + ' 级 ' + (self.masked.name[d] ? '音名未知' : g.spoken) + (self.masked.technical[d] ? '' : '，' + g.technical) + (self.masked.numeral[d] ? '' : '，' + g.numeral + (self.suffix[d] || '')));
  });
};

// Writes one cell. null shows the dashed question box. A cell whose
// content did not change is left alone, so only what changed is re-inked.
ScaleLadder.prototype.write = function (el, html, animated, isCard) {
  var key = html === null ? '?' : html;
  if (el._key === key) return;
  el._key = key;
  if (isCard) el.classList.toggle('tl-sl-masked', html === null);
  el.innerHTML = html === null ? '<span class="tl-sl-q">?</span>' : '<span' + (animated ? ' class="tl-sl-ink"' : '') + '>' + html + '</span>';
};

ScaleLadder.prototype.yOf = function (d) {
  var L = this.L, g = this.info[d];
  return L.margin + L.cardH / 2 + (this.span.hi - g.semis) * L.unit;
};

// Taps pick the nearest rung by height. Between the top and bottom rungs
// every tap is a rung, however wide the gap; beyond them, more than half a
// semitone of spacing past a card's edge counts as blank.
ScaleLadder.prototype.onPointer = function (ev) {
  this.host.classList.remove('kbd');
  var fr = this.frame.getBoundingClientRect(), y = ev.clientY - fr.top, x = ev.clientX - fr.left;
  var best = null, dist = Infinity, self = this, L = this.L;
  this.range().forEach(function (d) { var dd = Math.abs(self.yOf(d) - y); if (dd < dist) { dist = dd; best = d; } });
  var reach = L.unit / 2 + L.cardH / 2;
  var top = this.yOf(this.o.to) - reach, bottom = this.yOf(this.o.from) + reach;
  var inside = x >= -8 && x <= L.total + 8 && y >= top && y <= bottom;
  if (!inside) { this.blankTap(); return; }
  if (this.o.mode !== 'lecture') { ev.preventDefault(); return; }
  this.tap(best);
};

ScaleLadder.prototype.onKey = function (ev) {
  var cur = ev.target.closest('.tl-sl-rung'); if (!cur) return;
  var d = Number(cur.dataset.degree);
  if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    ev.preventDefault();
    var next = d + (ev.key === 'ArrowUp' ? 1 : -1);
    if (!this.rungs[next]) return;
    cur.tabIndex = -1; this.rungs[next].tabIndex = 0; this.rungs[next].focus();
    if (this.o.mode === 'lecture') this.tap(next);
  } else if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault(); if (this.o.mode === 'lecture') this.tap(d);
  } else if (ev.key === 'Escape') this.blankTap();
};

ScaleLadder.prototype.tap = function (d) {
  var self = this, g = this.info[d];
  this.clearTap();
  this.tapLit = d;
  this.press(d, 220);
  this.lit([d]);
  this.ripple(d);
  if (this.audible()) this.note(g.midi, 0, 1.1);
  this.emit('rungTap', { degree: d, name: g.plain, spoken: g.spoken, technical: g.technical, numeral: g.numeral, midi: g.midi, hidden: !!this.masked.name[d] });
  this.tapTimers.push(setTimeout(function () {
    self.frame.querySelectorAll('.tl-sl-bubble').forEach(function (b) { b.classList.add('out'); });
    if (!self.held[d]) self.unlit([d]);
  }, ScaleLadder.TAP_FADE_MS));
  this.tapTimers.push(setTimeout(function () { self.frame.querySelectorAll('.tl-sl-bubble.out').forEach(function (b) { b.remove(); }); }, ScaleLadder.TAP_FADE_MS + 600));
};

ScaleLadder.prototype.blankTap = function () { this.clearTap(); this.emit('blankTap', {}); };

ScaleLadder.prototype.clearTap = function () {
  (this.tapTimers || []).forEach(clearTimeout); this.tapTimers = [];
  if (this.tapLit !== undefined && this.tapLit !== null && !this.held[this.tapLit]) this.unlit([this.tapLit]);
  this.tapLit = null;
  if (this.frame) this.frame.querySelectorAll('.tl-sl-bubble').forEach(function (b) { b.remove(); });
};

ScaleLadder.prototype.press = function (d, ms) {
  var r = this.rungs[d]; if (!r) return;
  r.classList.add('tl-down');
  setTimeout(function () { r.classList.remove('tl-down'); }, ms);
};
ScaleLadder.prototype.lit = function (ds) { var self = this; ds.forEach(function (d) { if (self.rungs[d]) self.rungs[d].classList.add('tl-lit'); }); };
ScaleLadder.prototype.unlit = function (ds) { var self = this; ds.forEach(function (d) { if (self.rungs[d]) self.rungs[d].classList.remove('tl-lit'); }); };

ScaleLadder.prototype.ripple = function (d) {
  var r = document.createElement('div'); r.className = 'tl-sl-ripple';
  r.style.left = this.L.cardX + 'px'; r.style.top = this.yOf(d) + 'px';
  this.overlay.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

// Marks the workflow asked for survive a rebuild (a resize re-lays the
// columns); after a change of key, drawn marks are redrawn at the new heights.
ScaleLadder.prototype.restore = function () {
  var self = this, keep = this.marks;
  this.marks = [];
  this.lit(Object.keys(this.held).map(Number));
  keep.forEach(function (mk) { self[mk[0]].apply(self, mk[1]); });
};
ScaleLadder.prototype.remember = function (name, args) { this.marks.push([name, args]); };
ScaleLadder.prototype.forget = function (name) { this.marks = this.marks.filter(function (mk) { return mk[0] !== name; }); };

ScaleLadder.prototype.highlight = function (ds) {
  this.unlit(Object.keys(this.held).map(Number));
  var held = {}; ds.forEach(function (d) { held[d] = true; }); this.held = held;
  this.lit(ds);
};

ScaleLadder.prototype.label = function (map) {
  var self = this, L = this.L;
  this.remember('label', [map]);
  Object.keys(map).forEach(function (d, i) {
    var r = self.rungs[d]; if (!r) return;
    var old = r.querySelector('.tl-sl-badge'); if (old) old.remove();
    var b = document.createElement('span'); b.className = 'tl-sl-badge tl-sl-mark'; b.textContent = map[d];
    b.style.left = L.cardX - L.cardW / 2 + 'px'; b.style.animationDelay = i * 80 + 'ms';
    r.appendChild(b);
  });
};

// Brackets between neighbouring rungs in the left column, each marked
// with the distance: T, S, or T+S for the augmented second. The left
// column holds one kind of mark at a time, so this replaces chord tags.
ScaleLadder.prototype.steps = function () {
  var self = this, L = this.L, ds = this.range();
  this.clearChord(); this.clearSteps();
  this.remember('steps', []);
  var MARK = { 1: 'S', 2: 'T', 3: 'T+S' };
  for (var i = 1; i < ds.length; i++) (function (a, b, k) {
    var ya = self.yOf(a), yb = self.yOf(b), semis = self.info[b].semis - self.info[a].semis;
    var x = L.stepsW - 4, delay = k * 90;
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M' + (x + 3) + ' ' + (ya - 2) + ' H ' + x + ' V ' + (yb + 2) + ' H ' + (x + 3));
    p.setAttribute('class', 'tl-sl-brace tl-sl-mark');
    self.braces.appendChild(p);
    p.style.setProperty('--len', Math.ceil(p.getTotalLength()) + 'px');
    p.style.animationDelay = delay + 'ms';
    var tag = document.createElement('div'); tag.className = 'tl-sl-step tl-sl-mark'; tag.textContent = MARK[semis] || String(semis);
    tag.style.left = (x - 2) / 2 + 'px'; tag.style.top = (ya + yb) / 2 + 'px'; tag.style.animationDelay = delay + 200 + 'ms';
    self.overlay.appendChild(tag);
  })(ds[i - 1], ds[i], i - 1);
};
ScaleLadder.prototype.clearSteps = function () {
  this.overlay.querySelectorAll('.tl-sl-step').forEach(function (e) { e.remove(); });
  this.braces.innerHTML = '';
  this.forget('steps');
};

// Counts degrees from one rung to another, the first rung being 1, as
// intervals are counted. Each rung on the way lights, sounds and keeps
// its number just outside the right rail; the first and last stay lit.
ScaleLadder.prototype.count = function (from, to) {
  var self = this, L = this.L; this.stop();
  this.frame.querySelectorAll('.tl-sl-count').forEach(function (e) { e.remove(); });
  var dir = to >= from ? 1 : -1, total = Math.abs(to - from) + 1;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.highlight([]);
  for (var n = 1; n <= total; n++) (function (n) {
    self.timers.push(setTimeout(function () {
      var d = from + dir * (n - 1), g = self.info[d];
      self.unlit(self.range().filter(function (k) { return !self.held[k]; }));
      self.lit([d]); self.press(d, 160);
      if (self.audible()) self.note(g.midi, 0, .5, .65);
      var c = document.createElement('span'); c.className = 'tl-sl-count tl-sl-mark'; c.textContent = String(n);
      c.style.left = L.railR + L.railW + 10 + 'px';
      self.rungs[d].appendChild(c);
      self.emit('countStep', { n: n, degree: d, total: total });
      if (n === total) self.highlight([from, to]);
    }, (n - 1) * (reduce ? 150 : 520)));
  })(n);
};

ScaleLadder.prototype.mask = function (part, ds) { var self = this; (ds || this.range()).forEach(function (d) { self.masked[part][d] = true; }); this.place(false); };
ScaleLadder.prototype.reveal = function (part, ds) {
  var self = this; (ds || this.range()).forEach(function (d) { delete self.masked[part][d]; });
  this.place(true);
};

// The triad on a degree: root, 3rd and 5th light and get tags in the left
// column. A chord note above the drawn range is shown on the same note an
// octave lower. An inversion adds b or c to the numeral and fills and
// underlines the bass note's tag. It sounds broken, then together.
ScaleLadder.prototype.chord = function (degree, opts) {
  var self = this, inv = (opts && opts.inversion) || 0, L = this.L;
  this.clearChord(); this.clearSteps();
  this.remember('chord', [degree, opts]);
  var tones = [degree, degree + 2, degree + 4].map(function (t) {
    while (t > self.o.to) t -= 7;
    return t >= self.o.from ? t : null;
  });
  var names = ['root', '3rd', '5th'];
  tones.forEach(function (t, i) {
    if (t === null || !self.rungs[t]) return;
    var tag = document.createElement('span'); tag.className = 'tl-sl-tag tl-sl-chord tl-sl-mark' + (inv && i === inv ? ' tl-sl-bass' : '');
    tag.textContent = names[i];
    tag.style.right = (L.total - L.stepsW + 4) + 'px'; tag.style.animationDelay = i * 120 + 'ms';
    self.rungs[t].appendChild(tag);
  });
  if (tones[0] !== null) { this.suffix[tones[0]] = ['', 'b', 'c'][inv]; this.place(true); }
  this.highlight(tones.filter(function (t) { return t !== null; }));
  if (this.audible()) {
    this.stop();
    var voicing = [0, 2, 4].map(function (s) { return self.degree(degree + s, false).midi; });
    for (var k = 0; k < inv; k++) voicing.push(voicing.shift() + 12);
    voicing.forEach(function (m, i) { self.note(m, i * .35, .5, .65); });
    voicing.forEach(function (m) { self.note(m, 1.2, 1.4, .5); });
  }
};
ScaleLadder.prototype.clearChord = function () {
  this.frame.querySelectorAll('.tl-sl-chord').forEach(function (e) { e.remove(); });
  var had = Object.keys(this.suffix).some(function (d) { return this.suffix[d]; }, this);
  this.suffix = {};
  this.forget('chord');
  if (had) this.place(false);
};

// Changes the key or the form. Rungs slide to their new heights and the
// names that changed are written again; marks drawn in the left column
// and the spotlight follow once the rungs have settled.
ScaleLadder.prototype.key = function (k) {
  if (k.tonic) this.o.tonic = k.tonic;
  if (k.scale) this.o.scale = k.scale;
  this.descending = false;
  this.move();
};
ScaleLadder.prototype.setDescending = function (on) {
  if (this.descending === on) return;
  this.descending = on; this.move();
};
ScaleLadder.prototype.move = function () {
  var self = this;
  this.clearTap();
  var redraw = this.marks.filter(function (mk) { return mk[0] === 'steps' || mk[0] === 'spotlight'; });
  this.overlay.querySelectorAll('.tl-sl-step, .tl-sl-spot').forEach(function (e) { e.remove(); });
  this.braces.innerHTML = '';
  this.place(true);
  clearTimeout(this.moveTimer);
  this.moveTimer = setTimeout(function () {
    redraw.forEach(function (mk) { self.forget(mk[0]); self[mk[0]].apply(self, mk[1]); });
  }, ScaleLadder.MOVE_MS);
};

ScaleLadder.prototype.spotlight = function (ds) {
  var self = this;
  this.overlay.querySelectorAll('.tl-sl-spot').forEach(function (s) { s.remove(); });
  this.forget('spotlight');
  this.range().forEach(function (d) { self.rungs[d].classList.remove('tl-dim'); });
  if (!ds || !ds.length) return;
  this.remember('spotlight', [ds]);
  this.range().forEach(function (d) { if (ds.indexOf(d) < 0) self.rungs[d].classList.add('tl-dim'); });
  var ys = ds.map(function (d) { return self.yOf(d); }), L = this.L;
  var s = document.createElement('div'); s.className = 'tl-sl-spot';
  var top = Math.min.apply(null, ys) - L.cardH * 1.4, bottom = Math.max.apply(null, ys) + L.cardH * 1.4;
  s.style.left = L.ladX - 20 + 'px'; s.style.width = L.ladW + 40 + 'px'; s.style.top = top + 'px'; s.style.height = bottom - top + 'px';
  this.overlay.appendChild(s);
  requestAnimationFrame(function () { requestAnimationFrame(function () { s.classList.add('on'); }); });
};

ScaleLadder.prototype.caption = function (d, html) {
  this.frame.querySelectorAll('.tl-sl-bubble').forEach(function (e) { e.remove(); });
  if (!this.rungs[d]) return;
  var L = this.L, b = document.createElement('div'); b.className = 'tl-sl-bubble'; b.innerHTML = html;
  var x = L.cardX + L.cardW / 2 + 14;
  b.style.left = x + 'px'; b.style.top = this.yOf(d) + 'px';
  this.frame.appendChild(b);
  var over = b.getBoundingClientRect().right - this.case.getBoundingClientRect().right + 6;
  if (over > 0) b.style.left = Math.max(-this.frame.offsetLeft + 6, x - over) + 'px';
};

// Plays the scale. Melodic minor goes up raised and comes down natural:
// the 6th and 7th rungs slide between the two halves, and the sound waits
// for them.
ScaleLadder.prototype.play = function (opts) {
  var self = this; this.stop();
  if (!this.audible()) return;
  var dir = (opts && opts.direction) || (this.melodic() ? 'updown' : 'up');
  var up = this.range(), down = up.slice().reverse(), step = .42, t = 0;
  var gap = ScaleLadder.MOVE_MS / 1000;
  var shownDescending = this.descending;
  this.playing = true; this.playIcon(true);
  this.emit('playStart', {});
  function half(list, descending) {
    if (self.melodic() && shownDescending !== descending) {
      self.timers.push(setTimeout(function () { self.setDescending(descending); }, t * 1000));
      shownDescending = descending;
      t += gap;
    }
    list.forEach(function (d, i) {
      var g = self.degree(d, descending), last = i === list.length - 1;
      var dur = last ? .9 : step;
      self.note(g.midi, t, dur * .95, .75);
      self.timers.push(setTimeout(function () {
        self.press(d, Math.max(120, dur * 1000 - 60)); self.lit([d]);
        self.timers.push(setTimeout(function () { if (!self.held[d]) self.unlit([d]); }, Math.max(120, dur * 1000 - 40)));
      }, t * 1000));
      t += dur;
    });
  }
  if (dir === 'up' || dir === 'updown') half(up, false);
  if (dir === 'down' || dir === 'updown') half(dir === 'updown' ? down.slice(1) : down, true);
  this.timers.push(setTimeout(function () { self.voices = []; self.stop(); self.emit('playEnd', {}); }, t * 1000 + 150));
};

ScaleLadder.prototype.playIcon = function (playing) {
  if (!this.playBtn) return;
  this.playBtn.innerHTML = playing ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h4v12H5zM11 4h4v12h-4z"/></svg>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg>';
  this.playBtn.setAttribute('aria-label', playing ? '停止' : '播放');
};

ScaleLadder.prototype.clearTimers = function () { (this.timers || []).forEach(clearTimeout); this.timers = []; };

// Stops a playback, a count or a chord: timers are cleared and every
// note still queued or sounding is silenced.
ScaleLadder.prototype.stop = function () {
  this.clearTimers(); this.silence(); this.playing = false; this.playIcon(false);
  if (!this.rungs) return;
  var self = this;
  this.range().forEach(function (d) { self.rungs[d].classList.remove('tl-down'); if (!self.held[d] && d !== self.tapLit) self.rungs[d].classList.remove('tl-lit'); });
};

ScaleLadder.prototype.clear = function () {
  this.stop(); this.clearTap(); this.spotlight(null); this.clearChord(); this.clearSteps();
  this.marks = []; this.held = {};
  this.masked = { name: {}, numeral: {}, technical: {} };
  var self = this;
  this.range().forEach(function (d) { self.rungs[d].classList.remove('tl-lit'); });
  this.frame.querySelectorAll('.tl-sl-mark').forEach(function (e) { e.remove(); });
  this.place(true);
};
