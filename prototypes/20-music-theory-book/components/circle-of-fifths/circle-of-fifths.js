/* ============================================================
   Circle of fifths component. Twelve positions clockwise from C, each
   a fifth above the last: the outer ring holds the major keys, the
   inner ring their relative minors, the bezel the number of sharps or
   flats, and the hub the key signature on a short stave.
   Inputs: key ('Eb' major, 'c' minor), span (6 | 7 sharps and flats),
   clef ('treble' | 'bass' | 'alto' | 'tenor'), mode ('lecture' |
   'practice'), playable, compact, caption.
   Commands: select, highlight, show, walk, pair, sides, mask, reveal,
   label, spotlight, caption, rotate, clef, play, stop, clear.
   Events (via onEvent): keyTap, hubTap, blankTap, walkStep, playStart,
   playEnd. Sound goes through the injected source, lectures only.
   Colours are the theme constants (--th-*) set on the stage or page.
   ============================================================ */
function CircleOfFifths(host, options) {
  this.host = host;
  this.o = Object.assign({ key: 'C', span: 6, clef: 'treble', mode: 'lecture', playable: false, compact: false, caption: '', sound: null, onEvent: function () {} }, options);
  this.keys = CircleOfFifths.allKeys();
  this.held = {};
  this.trail = {};
  this.spot = null;
  this.masked = { major: false, minor: false, counts: false, signature: false, keys: {} };
  this.marks = [];
  this.rot = 0;
  this.current = this.o.key ? CircleOfFifths.parse(this.o.key) : null;
  this.newest = false;
  this.timers = [];
  this.tapTimers = [];
  this.voices = [];
  this.uid = 'tlcf' + (CircleOfFifths.count = (CircleOfFifths.count || 0) + 1);
  if (this.current) this.held[this.current] = true;
  this.build();
}
CircleOfFifths.LETTERS = 'CDEFGAB';
CircleOfFifths.NATURAL = [0, 2, 4, 5, 7, 9, 11];
CircleOfFifths.SHARP_ORDER = 'FCGDAEB';
CircleOfFifths.FLAT_ORDER = 'BEADGCF';
CircleOfFifths.ACC_TEXT = { '1': '♯', '-1': '♭' };
CircleOfFifths.ACC_WORD = { '1': ' sharp', '-1': ' flat' };
// Radii in dial units (400 across): bezel, ring borders, hub, and where labels sit.
CircleOfFifths.R = { out: 186, bezel: 164, mid: 124, hub: 86, major: 144, minor: 105, count: 175, side: 193 };
CircleOfFifths.TAP_FADE_MS = 2000;
CircleOfFifths.STEP_MS = 1100;
CircleOfFifths.SVG = 'http://www.w3.org/2000/svg';

// The key with s sharps (s > 0) or -s flats (s < 0). Each sharp moves the
// tonic up a fifth (four letters, seven semitones), each flat down a fifth
// (three letters up, five semitones up); minors start from A.
CircleOfFifths.make = function (s, mode) {
  var n = Math.abs(s), minor = mode === 'minor';
  var li = ((minor ? 5 : 0) + (s >= 0 ? 4 : 3) * n) % 7;
  var pc = ((minor ? 9 : 0) + (s >= 0 ? 7 : 5) * n) % 12;
  var acc = ((pc - CircleOfFifths.NATURAL[li]) % 12 + 18) % 12 - 6;
  var L = CircleOfFifths.LETTERS.charAt(li), letter = minor ? L.toLowerCase() : L;
  var mark = acc > 0 ? '#' : acc < 0 ? 'b' : '';
  var sym = s >= 0 ? '♯' : '♭';
  var order = s >= 0 ? CircleOfFifths.SHARP_ORDER : CircleOfFifths.FLAT_ORDER;
  return {
    id: letter + mark, mode: minor ? 'minor' : 'major', s: s, n: n, side: s > 0 ? 'sharp' : s < 0 ? 'flat' : 'none',
    letter: letter, acc: acc, pc: pc, pos: ((s % 12) + 12) % 12,
    plain: letter + (CircleOfFifths.ACC_TEXT[acc] || ''),
    name: letter + (CircleOfFifths.ACC_TEXT[acc] || '') + (minor ? ' minor' : ' major'),
    spoken: letter.toUpperCase() + (CircleOfFifths.ACC_WORD[acc] || '') + (minor ? ' minor' : ' major'),
    abc: L + mark + (minor ? 'm' : ''),
    signature: order.slice(0, n).split('').map(function (l) { return l + sym; })
  };
};
CircleOfFifths.allKeys = function () {
  var out = {};
  ['major', 'minor'].forEach(function (mode) { for (var s = -7; s <= 7; s++) { var k = CircleOfFifths.make(s, mode); out[k.id] = k; } });
  return out;
};
// 'Eb', 'E♭ major', 'c', 'C minor', 'Cm', 'f#' -> the key's id: the
// letter in upper case for a major key and in lower case for a minor one.
CircleOfFifths.parse = function (text) {
  var t = String(text).trim(), minor = null;
  var word = /\s*(major|minor)$/i.exec(t);
  if (word) { minor = word[1].toLowerCase() === 'minor'; t = t.slice(0, word.index); }
  else if (t.length > 1 && /m$/.test(t)) { minor = true; t = t.slice(0, -1); }
  var L = t.charAt(0);
  if (minor === null) minor = L !== L.toUpperCase();
  return (minor ? L.toLowerCase() : L.toUpperCase()) + t.slice(1).replace(/♯/g, '#').replace(/♭/g, 'b');
};
CircleOfFifths.countText = function (k) {
  if (!k.n) return 'no sharps or flats';
  return k.n + ' ' + (k.s > 0 ? 'sharp' : 'flat') + (k.n > 1 ? 's' : '');
};

// Accidental glyphs drawn by the score library, so a sharp here is the
// same shape as a sharp on the score. Each keeps its path and where the
// staff line it was drawn against sits, for vertical alignment in text.
CircleOfFifths.glyphs = function () {
  if (CircleOfFifths._glyphs) return CircleOfFifths._glyphs;
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:900px;visibility:hidden';
  document.body.appendChild(box);
  ABCJS.renderAbc(box, 'X:1\nL:1/4\nK:C clef=none stafflines=1\nV:1 stem=up\n^B _B|', { add_classes: true, staffwidth: 800 });
  var lb = box.querySelector('.abcjs-top-line').getBBox();
  var out = { lineY: lb.y + lb.height / 2 }, kinds = [1, -1];
  box.querySelectorAll('.abcjs-note').forEach(function (g, i) {
    var p = [].filter.call(g.querySelectorAll('path'), function (q) { return !q.getAttribute('class'); })[0];
    if (!p) return;
    var bb = p.getBBox();
    out[kinds[i]] = { d: p.getAttribute('d'), x: bb.x, w: bb.width };
  });
  box.remove();
  CircleOfFifths._glyphs = out;
  return out;
};

// A note name or a count as HTML: the text in the serif, the accidental
// as the library glyph scaled to the text and centred a third of an em
// above the baseline, where it sits in printed note names.
CircleOfFifths.nameHtml = function (text, acc, fontPx) {
  if (!acc) return text;
  var G = CircleOfFifths.glyphs(), g = G[acc]; if (!g) return text + CircleOfFifths.ACC_TEXT[acc];
  var s = fontPx * 0.034, band = 14;
  var w = (g.w + 1) * s, h = band * 2 * s, lift = 0.33 * fontPx - band * s;
  return text + '<svg viewBox="' + (g.x - .5) + ' ' + (G.lineY - band) + ' ' + (g.w + 1) + ' ' + band * 2 + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" style="vertical-align:' + lift.toFixed(1) + 'px;margin-left:1px" aria-hidden="true"><path d="' + g.d + '"/></svg>';
};

CircleOfFifths.polar = function (r, deg) {
  var a = deg * Math.PI / 180;
  return { x: 200 + r * Math.sin(a), y: 200 - r * Math.cos(a) };
};
CircleOfFifths.sector = function (r1, r2, a1, a2) {
  var P = CircleOfFifths.polar, p1 = P(r2, a1), p2 = P(r2, a2), p3 = P(r1, a2), p4 = P(r1, a1);
  var f = function (p) { return p.x.toFixed(2) + ' ' + p.y.toFixed(2); };
  return 'M' + f(p1) + ' A' + r2 + ' ' + r2 + ' 0 0 1 ' + f(p2) + ' L' + f(p3) + ' A' + r1 + ' ' + r1 + ' 0 0 0 ' + f(p4) + ' Z';
};

CircleOfFifths.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };
CircleOfFifths.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
CircleOfFifths.prototype.key = function (id) { return id ? this.keys[CircleOfFifths.parse(id)] || null : null; };
CircleOfFifths.prototype.onDial = function (k) { return !!k && k.n <= this.o.span; };
CircleOfFifths.prototype.relative = function (k) { return CircleOfFifths.make(k.s, k.mode === 'major' ? 'minor' : 'major'); };

// The keys drawn at one position of one ring, sharp spelling first.
CircleOfFifths.prototype.keysAt = function (ring, pos) {
  var self = this;
  return Object.keys(this.keys).map(function (id) { return self.keys[id]; })
    .filter(function (k) { return k.mode === ring && k.pos === pos && self.onDial(k); })
    .sort(function (a, b) { return b.s - a.s; });
};

// Every note the dial sounds goes through here, so stop() can silence
// the notes already scheduled ahead on the audio clock.
CircleOfFifths.prototype.note = function (midi, delay, dur, velocity) {
  var v = this.o.sound.play(midi, delay, dur, velocity);
  if (v) this.voices.push(v);
};
CircleOfFifths.prototype.silence = function () {
  (this.voices || []).forEach(function (v) { v.stop(); });
  this.voices = [];
};
// The tonic triad, rolled a little; the root sits between G3 and F#4.
CircleOfFifths.prototype.chord = function (k, delay, dur, velocity) {
  var self = this, root = 48 + k.pc;
  while (root < 55) root += 12;
  [0, k.mode === 'minor' ? 3 : 4, 7].forEach(function (iv, i) { self.note(root + iv, delay + i * .035, dur, velocity); });
};

CircleOfFifths.prototype.build = function () {
  var self = this, R = CircleOfFifths.R, P = CircleOfFifths.polar;
  this.stop(); this.clearTap();
  var playable = this.o.playable && this.o.mode === 'lecture';
  this.host.classList.add('tl-cf');
  this.host.classList.toggle('tl-cf-compact', !!this.o.compact);
  this.host.innerHTML = '';
  this.case = document.createElement('div'); this.case.className = 'tl-cf-case';
  this.host.appendChild(this.case);
  var avail = Math.max(200, (this.host.clientWidth || 340) - 24);
  var W = Math.floor(Math.min(avail, this.o.compact ? 280 : 460));
  var u = this.u = W / 400;
  this.dial = document.createElement('div'); this.dial.className = 'tl-cf-dial tl-cf-still';
  this.dial.style.width = W + 'px'; this.dial.style.height = W + 'px'; this.dial.style.setProperty('--u', u.toFixed(4));
  this.case.appendChild(this.dial);
  this.spin = document.createElement('div'); this.spin.className = 'tl-cf-spin';
  this.dial.appendChild(this.spin);
  var bezel = document.createElement('div'); bezel.className = 'tl-cf-bezel';
  this.spin.appendChild(bezel);

  var svg = this.svg = document.createElementNS(CircleOfFifths.SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 400 400'); svg.setAttribute('class', 'tl-cf-svg'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><filter id="' + this.uid + '-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.5"/></filter>' +
    '<radialGradient id="' + this.uid + '-shade" cx="50%" cy="38%" r="55%"><stop offset="0" style="stop-color:var(--tl-light)" stop-opacity=".5"/><stop offset=".7" style="stop-color:var(--tl-light)" stop-opacity="0"/><stop offset="1" style="stop-color:var(--tl-ink-soft)" stop-opacity=".12"/></radialGradient></defs>';
  this.spin.appendChild(svg);
  var g = function (cls) { var e = document.createElementNS(CircleOfFifths.SVG, 'g'); e.setAttribute('class', cls); svg.appendChild(e); return e; };
  var wedgeLayer = g('tl-cf-wedges');
  this.wedges = {};
  [['major', R.mid, R.bezel], ['minor', R.hub, R.mid]].forEach(function (ring) {
    for (var pos = 0; pos < 12; pos++) {
      var p = document.createElementNS(CircleOfFifths.SVG, 'path');
      p.setAttribute('d', CircleOfFifths.sector(ring[1], ring[2], pos * 30 - 15, pos * 30 + 15));
      p.setAttribute('class', 'tl-cf-wedge tl-cf-' + ring[0]);
      wedgeLayer.appendChild(p);
      self.wedges[ring[0] + pos] = p;
    }
  });
  var shade = document.createElementNS(CircleOfFifths.SVG, 'circle');
  shade.setAttribute('cx', 200); shade.setAttribute('cy', 200); shade.setAttribute('r', R.bezel); shade.setAttribute('class', 'tl-cf-shade'); shade.setAttribute('fill', 'url(#' + this.uid + '-shade)');
  svg.appendChild(shade);
  [R.bezel, R.mid].forEach(function (r) {
    var c = document.createElementNS(CircleOfFifths.SVG, 'circle');
    c.setAttribute('cx', 200); c.setAttribute('cy', 200); c.setAttribute('r', r); c.setAttribute('class', 'tl-cf-rim');
    svg.appendChild(c);
  });
  this.haloLayer = g('tl-cf-halos');
  this.markLayer = g('tl-cf-marks');

  this.layer = document.createElement('div'); this.layer.className = 'tl-cf-labels';
  this.spin.appendChild(this.layer);
  this.uprights = [];
  this.labels = {};
  ['major', 'minor'].forEach(function (ring) {
    for (var pos = 0; pos < 12; pos++) {
      var ks = self.keysAt(ring, pos), at = P(ring === 'major' ? R.major : R.minor, pos * 30);
      var b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1;
      b.className = 'tl-cf-key tl-cf-up tl-cf-' + ring + (ks.length > 1 ? ' tl-cf-pair' : '');
      b.dataset.ring = ring; b.dataset.pos = pos;
      b.style.left = at.x / 4 + '%'; b.style.top = at.y / 4 + '%';
      ks.forEach(function (k) { var line = document.createElement('span'); line.className = 'tl-cf-line'; line.dataset.key = k.id; b.appendChild(line); });
      self.layer.appendChild(b);
      self.uprights.push(b);
      self.labels[ring + pos] = b;
    }
  });
  this.counts = {};
  for (var pos = 0; pos < 12; pos++) {
    var at = P(R.count, pos * 30), c = document.createElement('span');
    c.className = 'tl-cf-count tl-cf-up'; c.dataset.pos = pos; c.style.left = at.x / 4 + '%'; c.style.top = at.y / 4 + '%';
    this.layer.appendChild(c); this.counts[pos] = c;
  }

  this.hub = document.createElement('div'); this.hub.className = 'tl-cf-hub';
  this.hub.innerHTML = '<div class="tl-cf-stave"></div><p class="tl-cf-hubtext"></p>';
  this.dial.appendChild(this.hub);
  this.over = document.createElement('div'); this.over.className = 'tl-cf-over';
  this.dial.appendChild(this.over);

  var legend = document.createElement('div'); legend.className = 'tl-cf-legend';
  var ringIcon = function (outer) {
    return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" style="fill:var(--tl-wood-ring)"/><circle cx="10" cy="10" r="7.4" style="fill:' + (outer ? 'var(--tl-glow)' : 'var(--tl-paper-a)') + '"/><circle cx="10" cy="10" r="5.2" style="fill:' + (outer ? 'var(--tl-paper-b)' : 'var(--tl-glow)') + '"/><circle cx="10" cy="10" r="3.2" style="fill:var(--tl-ivory)"/></svg>';
  };
  legend.innerHTML = '<span>' + ringIcon(true) + 'Major keys</span><span>' + ringIcon(false) + 'relative minor keys</span>';
  this.case.appendChild(legend);
  if (this.o.caption) { var cap = document.createElement('p'); cap.className = 'tl-cf-caption'; cap.textContent = this.o.caption; this.host.appendChild(cap); }

  if (playable) {
    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button'; this.playBtn.className = 'tl-cf-play';
    this.playBtn.addEventListener('click', function (ev) { ev.stopPropagation(); if (self.playing) self.stop(); else self.play(); });
    this.playBtn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    this.case.appendChild(this.playBtn);
    this.playIcon(false);
  } else this.playBtn = null;

  this.dial.addEventListener('pointerdown', function (ev) { self.onPointer(ev); });
  this.case.addEventListener('pointerdown', function (ev) { if (!self.dial.contains(ev.target) && ev.target !== self.playBtn) self.blankTap(); });
  this.dial.addEventListener('keydown', function (ev) { self.onKey(ev); });
  this.dial.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') self.host.classList.add('kbd'); });

  this.writeLabels(false);
  this.turn(false);
  this.refresh();
  this.renderHub(false);
  this.restore();
  var cur = this.current ? this.keys[this.current] : null;
  this.labels[this.onDial(cur) ? cur.mode + cur.pos : 'major0'].tabIndex = 0;
  requestAnimationFrame(function () { requestAnimationFrame(function () { self.dial.classList.remove('tl-cf-still'); }); });
};

// Writes every name and count. A masked one shows the dashed question
// box. A cell whose content did not change is left alone, so only what
// changed is re-inked; a letter badge on it is kept.
CircleOfFifths.prototype.writeLabels = function (animated) {
  var self = this, u = this.u;
  Object.keys(this.labels).forEach(function (id) {
    var b = self.labels[id], pair = b.classList.contains('tl-cf-pair'), major = b.dataset.ring === 'major';
    var px = (major ? (pair ? 17 : 24) : (pair ? 14.5 : 19)) * u;
    var names = [];
    b.querySelectorAll('.tl-cf-line').forEach(function (line) {
      var k = self.keys[line.dataset.key];
      var hidden = self.masked[k.mode] || self.masked.keys[k.id];
      self.write(line, hidden ? null : CircleOfFifths.nameHtml(k.letter, k.acc, px), animated);
      names.push(hidden ? '调名未知' : k.spoken);
    });
    b.setAttribute('aria-label', names.join(' 或 '));
  });
  for (var pos = 0; pos < 12; pos++) {
    var parts = this.keysAt('major', pos).map(function (k) { return CircleOfFifths.nameHtml(String(k.n), k.s > 0 ? 1 : k.s < 0 ? -1 : 0, 17 * u); });
    this.write(this.counts[pos], this.masked.counts ? null : parts.join(' / '), animated);
  }
};
CircleOfFifths.prototype.write = function (el, html, animated) {
  var key = html === null ? '?' : html;
  if (el._key === key) return;
  var badge = el.querySelector(':scope > .tl-cf-badge');
  el._key = key;
  el.innerHTML = html === null ? '<span class="tl-cf-q">?</span>' : '<span' + (animated ? ' class="tl-cf-ink"' : '') + '>' + html + '</span>';
  if (badge) el.appendChild(badge);
};

// Turns the dial to its angle. Names turn back by the same angle so they
// stay upright. Counts run along the bezel and turn round in its lower
// half so they read the right way up; each takes the turn closest to the
// one it had, so none spins a full circle. With animated false the turn
// is instant (a rebuild).
CircleOfFifths.prototype.turn = function (animated) {
  var self = this;
  if (!animated) this.dial.classList.add('tl-cf-still');
  this.spin.style.transform = 'rotate(' + this.rot + 'deg)';
  this.uprights.forEach(function (e) { e.style.transform = 'translate(-50%, -50%) rotate(' + (-self.rot) + 'deg)'; });
  Object.keys(this.counts).forEach(function (pos) {
    var c = self.counts[pos], a = pos * 30 + self.rot;
    var along = 90 - ((((90 - a) % 180) + 180) % 180);
    var own = along - self.rot;
    if (c._own !== undefined) own += 360 * Math.round((c._own - own) / 360);
    c._own = own;
    c.style.transform = 'translate(-50%, -50%) rotate(' + own + 'deg)';
  });
};

// Recomputes which wedges are lit, trailed, dimmed and chosen from the
// state: held keys, the key a tap lit, the walk's trail and the spotlight.
CircleOfFifths.prototype.refresh = function () {
  var self = this, lit = {}, chosen = {};
  var ids = Object.keys(this.held);
  if (this.tapLit) ids.push(this.tapLit);
  ids.forEach(function (id) { var k = self.keys[id]; if (!self.onDial(k)) return; lit[k.mode + k.pos] = true; chosen[k.id] = true; });
  Object.keys(this.wedges).forEach(function (w) {
    var on = !!lit[w], dim = !!self.spot && !self.spot[w];
    self.wedges[w].classList.toggle('tl-lit', on);
    self.wedges[w].classList.toggle('tl-cf-trail', !on && !!self.trail[w]);
    self.wedges[w].classList.toggle('tl-dim', dim);
    self.labels[w].classList.toggle('tl-lit', on);
    self.labels[w].classList.toggle('tl-dim', dim);
  });
  for (var pos = 0; pos < 12; pos++) this.counts[pos].classList.toggle('tl-dim', !!this.spot && !this.spot['major' + pos] && !this.spot['minor' + pos]);
  this.layer.querySelectorAll('.tl-cf-line').forEach(function (line) { line.classList.toggle('tl-cf-chosen', !!chosen[line.dataset.key]); });
  this.haloLayer.innerHTML = '';
  var R = CircleOfFifths.R;
  Object.keys(lit).forEach(function (w) {
    var ring = w.indexOf('major') === 0 ? 'major' : 'minor', pos = Number(w.slice(5));
    var d = ring === 'major' ? CircleOfFifths.sector(R.mid, R.bezel, pos * 30 - 15, pos * 30 + 15) : CircleOfFifths.sector(R.hub, R.mid, pos * 30 - 15, pos * 30 + 15);
    ['tl-cf-soft', 'tl-cf-crisp'].forEach(function (cls) {
      var p = document.createElementNS(CircleOfFifths.SVG, 'path');
      p.setAttribute('d', d); p.setAttribute('class', 'tl-cf-halo ' + cls);
      if (cls === 'tl-cf-soft') p.setAttribute('filter', 'url(#' + self.uid + '-glow)');
      self.haloLayer.appendChild(p);
    });
  });
};

// Draws the key signature of the shown key on a short stave, cropped
// to the clef and room for every accidental the dial's span can need, so
// the stave keeps its size while accidentals are added. With `newest`,
// the last accidental is lit.
CircleOfFifths.prototype.renderHub = function (newest) {
  var stave = this.hub.querySelector('.tl-cf-stave'), text = this.hub.querySelector('.tl-cf-hubtext');
  var k = this.current ? this.keys[this.current] : null, u = this.u;
  this.hub.setAttribute('aria-label', this.masked.signature ? '调号未知' : k ? CircleOfFifths.countText(k) : '');
  text.textContent = this.masked.counts || this.masked.signature || !k ? '' : CircleOfFifths.countText(k);
  if (this.masked.signature) { stave.innerHTML = '<span class="tl-cf-q">?</span>'; return; }
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:400px;visibility:hidden';
  document.body.appendChild(box);
  ABCJS.renderAbc(box, 'X:1\nL:1/4\n%%stretchlast 1\nK:' + (k ? k.abc : 'C') + ' clef=' + this.o.clef + '\nx4|', { add_classes: true, staffwidth: 300, paddingleft: 0, paddingright: 0, paddingtop: 0, paddingbottom: 0 });
  var svg = box.querySelector('svg');
  var top = svg.querySelector('.abcjs-top-line').getBBox().y, clef = svg.querySelector('.abcjs-clef').getBBox();
  var w = Math.ceil(clef.x + clef.width + 9 + this.o.span * 10 + 6), h = 62;
  svg.querySelectorAll('.abcjs-bar').forEach(function (b) { b.remove(); });
  var D = 2 * CircleOfFifths.R.hub * u, textH = text.textContent ? 17 * u + 4 : 0, s = 1.25;
  while (s > .4 && Math.hypot(w * s, h * s + textH) > .86 * D) s -= .02;
  svg.setAttribute('viewBox', '0 ' + (top - 16) + ' ' + w + ' ' + h);
  svg.setAttribute('width', (w * s).toFixed(1)); svg.setAttribute('height', (h * s).toFixed(1));
  svg.removeAttribute('style'); svg.setAttribute('aria-hidden', 'true');
  if (newest) { var accs = svg.querySelectorAll('.abcjs-key-signature path'); if (accs.length) accs[accs.length - 1].setAttribute('class', 'tl-cf-new'); }
  stave.innerHTML = ''; stave.appendChild(svg);
  box.remove();
};

// Where a label sits on screen, in dial pixels, at the dial's current angle.
CircleOfFifths.prototype.labelPoint = function (k) {
  var R = CircleOfFifths.R, p = CircleOfFifths.polar(k.mode === 'major' ? R.major : R.minor, k.pos * 30 + this.rot);
  return { x: p.x * this.u, y: p.y * this.u };
};

// Taps are told apart by distance from the centre (hub, minor ring,
// major ring and bezel, outside) and by angle (which position). On a
// position with two spellings, the line nearer the tap wins.
CircleOfFifths.prototype.onPointer = function (ev) {
  this.host.classList.remove('kbd');
  var R = CircleOfFifths.R, rect = this.dial.getBoundingClientRect();
  var dx = ev.clientX - rect.left - rect.width / 2, dy = ev.clientY - rect.top - rect.height / 2;
  var r = Math.hypot(dx, dy) / this.u;
  if (r > R.out + 8) { this.blankTap(); return; }
  if (this.o.mode !== 'lecture') { ev.preventDefault(); return; }
  if (r < R.hub) { this.hubTap(); return; }
  var ring = r < R.mid ? 'minor' : 'major';
  var a = Math.atan2(dx, -dy) * 180 / Math.PI - this.rot;
  var pos = ((Math.round(a / 30) % 12) + 12) % 12;
  var lines = this.labels[ring + pos].querySelectorAll('.tl-cf-line'), best = null, dist = Infinity;
  lines.forEach(function (line) { var lr = line.getBoundingClientRect(), d = Math.abs(lr.top + lr.height / 2 - ev.clientY); if (d < dist) { dist = d; best = line; } });
  if (best) { ev.preventDefault(); this.tap(best.dataset.key); }
};

CircleOfFifths.prototype.onKey = function (ev) {
  var cur = ev.target.closest('.tl-cf-key'); if (!cur) return;
  var ring = cur.dataset.ring, pos = Number(cur.dataset.pos), next = null;
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') next = ring + (((pos + (ev.key === 'ArrowRight' ? 1 : -1)) % 12) + 12) % 12;
  else if (ev.key === 'ArrowUp') next = 'major' + pos;
  else if (ev.key === 'ArrowDown') next = 'minor' + pos;
  else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (this.o.mode === 'lecture') this.tap(cur.querySelector('.tl-cf-line').dataset.key); return; }
  else if (ev.key === 'Escape') { this.blankTap(); return; }
  if (!next) return;
  ev.preventDefault();
  cur.tabIndex = -1; this.labels[next].tabIndex = 0; this.labels[next].focus();
  if (this.o.mode === 'lecture') this.tap(this.labels[next].querySelector('.tl-cf-line').dataset.key);
};

CircleOfFifths.prototype.tap = function (id) {
  var self = this, k = this.keys[id], rel = this.relative(k);
  this.clearTap();
  this.tapLit = id;
  var label = this.labels[k.mode + k.pos];
  label.classList.add('tl-cf-down'); setTimeout(function () { label.classList.remove('tl-cf-down'); }, 200);
  this.ripple(k);
  this.current = id; this.newest = false;
  this.refresh();
  this.renderHub(false); this.hubTurn();
  if (this.audible()) this.chord(k, 0, 1.2, .55);
  this.emit('keyTap', { key: k.id, mode: k.mode, name: k.name, side: k.side, count: k.n, signature: k.signature, relative: rel.name, relativeKey: rel.id, hidden: !!(this.masked[k.mode] || this.masked.keys[k.id]) });
  this.tapTimers.push(setTimeout(function () {
    self.over.querySelectorAll('.tl-cf-bubble').forEach(function (b) { b.classList.add('out'); });
    self.tapLit = null; self.refresh();
  }, CircleOfFifths.TAP_FADE_MS));
  this.tapTimers.push(setTimeout(function () { self.over.querySelectorAll('.tl-cf-bubble.out').forEach(function (b) { b.remove(); }); }, CircleOfFifths.TAP_FADE_MS + 600));
};

CircleOfFifths.prototype.hubTap = function () {
  this.clearTap();
  var k = this.current ? this.keys[this.current] : null;
  if (k && this.audible() && !this.masked.signature) { this.silence(); this.chord(k, 0, 1.2, .55); }
  this.hubTurn();
  this.emit('hubTap', { key: k ? k.id : null, name: k ? k.name : null, hidden: !!this.masked.signature });
};
CircleOfFifths.prototype.hubTurn = function () {
  var hub = this.hub; hub.classList.remove('tl-cf-turn'); void hub.offsetWidth; hub.classList.add('tl-cf-turn');
};

CircleOfFifths.prototype.blankTap = function () { this.clearTap(); this.emit('blankTap', {}); };

CircleOfFifths.prototype.clearTap = function () {
  (this.tapTimers || []).forEach(clearTimeout); this.tapTimers = [];
  if (this.tapLit) { this.tapLit = null; this.refresh(); }
  if (this.over) this.over.querySelectorAll('.tl-cf-bubble').forEach(function (b) { b.remove(); });
};

CircleOfFifths.prototype.ripple = function (k) {
  var p = this.labelPoint(k), r = document.createElement('div'); r.className = 'tl-cf-ripple';
  r.style.left = p.x + 'px'; r.style.top = p.y + 'px';
  this.over.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

// Marks the workflow asked for survive a rebuild (a resize redraws the dial).
CircleOfFifths.prototype.restore = function () {
  var self = this, keep = this.marks;
  this.marks = [];
  keep.forEach(function (mk) { self[mk[0]].apply(self, mk[1]); });
};
CircleOfFifths.prototype.remember = function (name, args) { this.forget(name); this.marks.push([name, args]); };
CircleOfFifths.prototype.forget = function (name) { this.marks = this.marks.filter(function (mk) { return mk[0] !== name; }); };

CircleOfFifths.prototype.select = function (id) {
  var k = this.key(id); if (!k) return;
  this.held = {}; this.held[k.id] = true;
  this.current = k.id; this.newest = false;
  this.refresh(); this.renderHub(false); this.hubTurn();
};
CircleOfFifths.prototype.highlight = function (ids) {
  var self = this; this.held = {};
  (ids || []).forEach(function (id) { var k = self.key(id); if (k) self.held[k.id] = true; });
  this.refresh();
};
CircleOfFifths.prototype.show = function (id) {
  var k = this.key(id); this.current = k ? k.id : null; this.newest = false;
  this.renderHub(false); this.hubTurn();
};

// Walks round the circle from a key, one fifth a step: clockwise adds a
// sharp (or takes away a flat), anticlockwise adds a flat. Each step
// lights the key, keeps a trail behind it, shows its signature with the
// accidental just added lit, and sounds its tonic triad. With `follow`
// the dial turns so the key reached sits at the top.
CircleOfFifths.prototype.walk = function (from, opts, onEnd) {
  var self = this; opts = opts || {};
  this.stop(); this.clearTap();
  var k0 = this.key(from || 'C'); if (!k0) return;
  var dir = opts.direction === 'flat' ? -1 : 1, span = this.o.span;
  var most = dir > 0 ? span - k0.s : span + k0.s;
  var steps = Math.max(0, Math.min(opts.steps === undefined ? most : opts.steps, most));
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var every = reduce ? 500 : CircleOfFifths.STEP_MS;
  this.trail = {};
  for (var i = 0; i <= steps; i++) (function (i) {
    var k = CircleOfFifths.make(k0.s + dir * i, k0.mode), prev = i ? CircleOfFifths.make(k0.s + dir * (i - 1), k0.mode) : null;
    var added = prev && k.n > prev.n ? k.signature[k.n - 1] : null;
    var removed = prev && k.n < prev.n ? prev.signature[prev.n - 1] : null;
    if (self.audible()) self.chord(k, i * every / 1000, .9, .5);
    self.timers.push(setTimeout(function () {
      self.held = {}; self.held[k.id] = true;
      self.trail[k.mode + k.pos] = true;
      self.current = k.id; self.newest = !!added;
      if (opts.follow) self.rotate(k.id);
      self.refresh(); self.renderHub(!!added); self.hubTurn();
      var label = self.labels[k.mode + k.pos];
      label.classList.add('tl-cf-down'); setTimeout(function () { label.classList.remove('tl-cf-down'); }, 220);
      self.emit('walkStep', { n: i, steps: steps, key: k.id, name: k.name, side: k.side, count: k.n, added: added, removed: removed });
    }, i * every));
  })(i);
  this.timers.push(setTimeout(function () { self.voices = []; if (onEnd) onEnd(); }, steps * every + 1300));
};

// Frames a key together with its relative major or minor: the two wedges
// of one position, which share a key signature.
CircleOfFifths.prototype.pair = function (id) {
  var k = this.key(id); if (!this.onDial(k)) return;
  var R = CircleOfFifths.R, rel = this.relative(k);
  this.markLayer.querySelectorAll('.tl-cf-outline').forEach(function (e) { e.remove(); });
  this.remember('pair', [id]);
  var p = document.createElementNS(CircleOfFifths.SVG, 'path');
  p.setAttribute('d', CircleOfFifths.sector(R.hub + 2, R.bezel - 2, k.pos * 30 - 14, k.pos * 30 + 14));
  p.setAttribute('class', 'tl-cf-outline tl-cf-mark');
  this.markLayer.appendChild(p);
  this.held = {}; this.held[k.id] = true; this.held[rel.id] = true;
  this.current = k.id; this.newest = false;
  this.refresh(); this.renderHub(false); this.hubTurn();
};

// Two arrows along the rim from C to the bottom: clockwise is the sharp
// side, anticlockwise the flat side, each with a tag near its end.
CircleOfFifths.prototype.sides = function () {
  var self = this, R = CircleOfFifths.R, P = CircleOfFifths.polar, r = R.side;
  this.clearSides();
  this.remember('sides', []);
  [[1, 'sharp keys'], [-1, 'flat keys']].forEach(function (side, i) {
    var sgn = side[0], end = sgn * 166;
    var p1 = P(r, sgn * 10), p2 = P(r, end);
    var arc = document.createElementNS(CircleOfFifths.SVG, 'path');
    arc.setAttribute('d', 'M' + p1.x.toFixed(2) + ' ' + p1.y.toFixed(2) + ' A' + r + ' ' + r + ' 0 0 ' + (sgn > 0 ? 1 : 0) + ' ' + p2.x.toFixed(2) + ' ' + p2.y.toFixed(2));
    arc.setAttribute('class', 'tl-cf-side tl-cf-mark tl-cf-sides');
    self.markLayer.appendChild(arc);
    arc.style.setProperty('--len', Math.ceil(arc.getTotalLength()) + 'px');
    arc.style.animationDelay = i * 150 + 'ms';
    // The arrowhead points along the arc, the way it is drawn.
    var t = end * Math.PI / 180, dx = Math.cos(t) * sgn, dy = Math.sin(t) * sgn, nx = -dy, ny = dx;
    var pt = function (along, across) { return (p2.x + dx * along + nx * across).toFixed(2) + ' ' + (p2.y + dy * along + ny * across).toFixed(2); };
    var head = document.createElementNS(CircleOfFifths.SVG, 'path');
    head.setAttribute('d', 'M' + pt(5, 0) + ' L' + pt(-6, 6) + ' L' + pt(-6, -6) + ' Z');
    head.setAttribute('class', 'tl-cf-arrow tl-cf-mark tl-cf-sides');
    self.markLayer.appendChild(head);
    var at = P(r + 2, sgn * 135), tag = document.createElement('span');
    tag.className = 'tl-cf-tag tl-cf-up tl-cf-mark tl-cf-sides';
    tag.innerHTML = CircleOfFifths.nameHtml('', sgn, 15 * Math.max(self.u, .8)) + ' ' + side[1];
    tag.style.left = at.x / 4 + '%'; tag.style.top = at.y / 4 + '%';
    tag.style.transform = 'translate(-50%, -50%) rotate(' + (-self.rot) + 'deg)';
    self.layer.appendChild(tag); self.uprights.push(tag);
  });
};
CircleOfFifths.prototype.clearSides = function () {
  var self = this;
  this.host.querySelectorAll('.tl-cf-sides').forEach(function (e) { e.remove(); });
  this.uprights = (this.uprights || []).filter(function (e) { return self.layer.contains(e); });
  this.forget('sides');
};

// What can be hidden: 'major' or 'minor' (a ring of names), 'counts' (the
// bezel and the hub's count), 'signature' (the hub's stave), or a list of keys.
CircleOfFifths.prototype.setMask = function (what, on) {
  var self = this;
  [].concat(what).forEach(function (w) {
    if (w === 'major' || w === 'minor' || w === 'counts' || w === 'signature') self.masked[w] = on;
    else { var k = self.key(w); if (k) { if (on) self.masked.keys[k.id] = true; else delete self.masked.keys[k.id]; } }
  });
};
CircleOfFifths.prototype.mask = function (what) { this.setMask(what, true); this.writeLabels(false); this.renderHub(this.newest); };
CircleOfFifths.prototype.reveal = function (what) {
  if (what === undefined) this.masked = { major: false, minor: false, counts: false, signature: false, keys: {} };
  else this.setMask(what, false);
  this.writeLabels(true); this.renderHub(this.newest); this.hubTurn();
};

CircleOfFifths.prototype.label = function (map) {
  var self = this;
  this.remember('label', [map]);
  this.layer.querySelectorAll('.tl-cf-badge').forEach(function (e) { e.remove(); });
  Object.keys(map).forEach(function (id, i) {
    var k = self.key(id); if (!self.onDial(k)) return;
    var line = self.layer.querySelector('.tl-cf-line[data-key="' + k.id + '"]'); if (!line) return;
    var b = document.createElement('span'); b.className = 'tl-cf-badge tl-cf-mark'; b.textContent = map[id];
    b.style.animationDelay = i * 80 + 'ms';
    line.appendChild(b);
  });
};

CircleOfFifths.prototype.spotlight = function (ids) {
  var self = this;
  this.forget('spotlight');
  this.spot = null;
  if (ids && ids.length) {
    this.remember('spotlight', [ids]);
    this.spot = {};
    ids.forEach(function (id) { var k = self.key(id); if (k) self.spot[k.mode + k.pos] = true; });
  }
  this.refresh();
};

CircleOfFifths.prototype.caption = function (id, html) {
  var k = this.key(id);
  this.over.querySelectorAll('.tl-cf-bubble').forEach(function (e) { e.remove(); });
  if (!this.onDial(k)) return;
  var p = this.labelPoint(k), half = (k.mode === 'major' ? 15 : 12) * this.u + 6, W = this.dial.offsetWidth;
  var b = document.createElement('div'); b.innerHTML = html;
  var below = p.y < W / 2;
  b.className = 'tl-cf-bubble ' + (below ? 'tl-cf-below' : 'tl-cf-above');
  this.over.appendChild(b);
  var bw = b.offsetWidth, bh = b.offsetHeight;
  var lo = -this.dial.offsetLeft + 6, hi = this.case.clientWidth - this.dial.offsetLeft - 6 - bw;
  var left = Math.max(lo, Math.min(hi, p.x - bw / 2));
  b.style.left = left + 'px';
  b.style.top = (below ? p.y + half + 4 : p.y - half - 4 - bh) + 'px';
  b.style.setProperty('--ax', Math.max(12, Math.min(bw - 12, p.x - left)) + 'px');
};

// Turns the dial so a key sits at the top, the shorter way round.
CircleOfFifths.prototype.rotate = function (id) {
  var k = this.key(id), target = k ? -k.pos * 30 : 0;
  var delta = ((target - this.rot) % 360 + 540) % 360 - 180;
  this.rot += delta;
  this.over.querySelectorAll('.tl-cf-bubble').forEach(function (b) { b.remove(); });
  this.turn(true);
};

CircleOfFifths.prototype.clef = function (name) { this.o.clef = name; this.renderHub(this.newest); this.hubTurn(); };

// Walks from C (a for a minor key) to the selected key, the way its
// accidentals are added; with C itself selected it walks the sharp side.
CircleOfFifths.prototype.play = function () {
  var self = this; this.stop();
  if (!this.audible()) return;
  var k = this.current ? this.keys[this.current] : null;
  var mode = k ? k.mode : 'major', target = this.onDial(k) ? k : null;
  var opts = !target || target.s === 0 ? { direction: 'sharp' } : { direction: target.s > 0 ? 'sharp' : 'flat', steps: target.n };
  this.walk(CircleOfFifths.make(0, mode).id, opts, function () { self.playing = false; self.playIcon(false); self.emit('playEnd', {}); });
  this.playing = true; this.playIcon(true);
  this.emit('playStart', {});
};

CircleOfFifths.prototype.playIcon = function (playing) {
  if (!this.playBtn) return;
  this.playBtn.innerHTML = playing ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h4v12H5zM11 4h4v12h-4z"/></svg>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg>';
  this.playBtn.setAttribute('aria-label', playing ? '停止' : '播放');
};

CircleOfFifths.prototype.clearTimers = function () { (this.timers || []).forEach(clearTimeout); this.timers = []; };

// Stops a walk or a playback: timers are cleared and every note still
// queued or sounding is silenced. What the walk lit so far stays.
CircleOfFifths.prototype.stop = function () {
  this.clearTimers(); this.silence(); this.playing = false; this.playIcon(false);
};

CircleOfFifths.prototype.clear = function () {
  this.stop(); this.clearTap(); this.clearSides();
  this.marks = []; this.held = {}; this.trail = {}; this.spot = null; this.newest = false;
  this.masked = { major: false, minor: false, counts: false, signature: false, keys: {} };
  this.host.querySelectorAll('.tl-cf-mark').forEach(function (e) { e.remove(); });
  this.writeLabels(true); this.refresh(); this.renderHub(false);
};
