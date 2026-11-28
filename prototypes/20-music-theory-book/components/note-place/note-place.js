/* ============================================================
   Note-placing component. Answers by writing a note on a short stave,
   as on an exam paper: a finger on the stave puts the note on the line
   or space at that height, dragging moves it, and the keys under the
   paper write an accidental in front of it or rub it out.
   The stave, its clef, key and given notes are drawn by the score
   library; the answer notes, their ledger lines and accidentals are
   drawn here with the library's own glyphs, so they look the same.
   The component does not know the answer: it reports what is written
   and what it sounds like with the key, and the workflow tells it what
   to draw right or wrong.
   Inputs: clef, key, columns ([{given: 'Eb4', id}] | [{id, under}]),
   tag, name, range ([low, high] pitches), accidentals, mode
   ('lecture' | 'practice'), sound.
   Commands: focus, write, press, count, highlight, label, caption,
   check, reveal, lock, play, set, stop, clear.
   Events (via onEvent): notePlace, accidentalPress, noteErase,
   blankTap, playStart, playEnd.
   ============================================================ */
function NotePlace(host, options) {
  var self = this;
  this.host = host;
  this.o = Object.assign({ clef: 'treble', key: 'C', columns: [{ id: 'a' }], tag: '', name: '', range: null, accidentals: NotePlace.ACCS, mode: 'practice', sound: null, onEvent: function () {} }, options);
  this.cols = this.o.columns.map(function (c, i) {
    if (c.given) return { kind: 'given', id: String(c.id || 'given' + i), pitch: NotePlace.parse(c.given) };
    return { kind: 'answer', id: String(c.id), under: c.under || '' };
  });
  this.answers = this.cols.filter(function (c) { return c.kind === 'answer'; }).map(function (c) { return c.id; });
  this.base = NotePlace.CLEF_BASE[this.o.clef] || NotePlace.CLEF_BASE.treble;
  var r = this.o.range || [];
  this.lo = r[0] ? this.posOf(NotePlace.parse(r[0])) : NotePlace.LOW_POS;
  this.hi = r[1] ? this.posOf(NotePlace.parse(r[1])) : NotePlace.HIGH_POS;
  this.values = {};
  this.answers.forEach(function (id) { self.values[id] = null; });
  this.verdict = {};
  this.revealed = {};
  this.labels = {};
  this.held = [];
  this.cap = null;
  this.counted = null;
  this.locked = false;
  this.drag = null;
  this.timers = [];
  this.voices = [];
  this.cur = this.answers[0] || null;
  host.classList.add('tl-np');
  host.addEventListener('pointerdown', function (ev) { self.onPointer(ev); });
  host.addEventListener('pointermove', function (ev) { self.onMove(ev); });
  host.addEventListener('pointerup', function (ev) { self.onUp(ev, false); });
  host.addEventListener('pointercancel', function (ev) { self.onUp(ev, true); });
  host.addEventListener('keydown', function (ev) { self.onKey(ev); });
  host.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') host.classList.add('kbd'); });
  this.build();
}
NotePlace.SVGNS = 'http://www.w3.org/2000/svg';
NotePlace.LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
NotePlace.STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
NotePlace.ACCS = ['dblflat', 'flat', 'natural', 'sharp', 'dblsharp'];
NotePlace.ALTER = { dblflat: -2, flat: -1, natural: 0, sharp: 1, dblsharp: 2 };
NotePlace.TOKEN = { dblflat: 'bb', flat: 'b', natural: 'n', sharp: '#', dblsharp: 'x' };
NotePlace.EN = { dblflat: 'double flat', flat: 'flat', natural: 'natural', sharp: 'sharp', dblsharp: 'double sharp' };
NotePlace.ABC = { dblflat: '__', flat: '_', natural: '=', sharp: '^', dblsharp: '^^' };
// Staff positions count lines and spaces from the bottom line (0) up to
// the top line (8). Each clef names the note on its bottom line, as a
// diatonic number (octave * 7 + letter).
NotePlace.CLEF_BASE = { treble: 4 * 7 + 2, bass: 2 * 7 + 4, alto: 3 * 7 + 3, tenor: 3 * 7 + 1 };
// Without a range from the question, a note may go three ledger lines
// above or below the stave, and onto the space beyond the last one.
NotePlace.LOW_POS = -7;
NotePlace.HIGH_POS = 15;
// Pixels per drawing unit of the score library the component aims for:
// a step (a line to the next space) of about ten pixels, so a finger
// lands where it means. A long key signature or many columns make it
// smaller, never below the minimum.
NotePlace.PX_PER_UNIT = 2.5;
NotePlace.MIN_PX_PER_UNIT = 1.5;
// Two columns stand at least this far apart (centre to centre), room for
// a double flat in front of a note head beside another head.
NotePlace.MIN_GAP_UNITS = 34;
NotePlace.MARGIN_UNITS = 7;
NotePlace.LEDGER_HALF = 9.5;
// A seal stands right over its note: half a head above the centre in
// drawing units, then a fixed gap in pixels, so it covers none of the
// head and none of the notes beside it at any size.
NotePlace.HEAD_RISE = 4;
NotePlace.SEAL_GAP_PX = 13;
// A letter stands this many steps above its note, clear of a seal, and
// never lower than just over the stave.
NotePlace.BADGE_STEPS = 8;
NotePlace.BADGE_MIN_POS = 11;
NotePlace.KEY_W = 48;
NotePlace.KEY_W_NARROW = 44;
NotePlace.KEY_GAP = 8;
NotePlace.PAD_INSET = 10;
NotePlace.KEY_REACH_PX = 8;
NotePlace.MOVE_MS = 520;
NotePlace.EASE = 'cubic-bezier(.6, 0, .25, 1)';
NotePlace.BUBBLE_FADE_MS = 200;
NotePlace.COUNT_GAP_MS = 450;
NotePlace.PRESS_MS = 380;
NotePlace.FLASH_MS = 600;
NotePlace.ERASE = 'erase';
NotePlace.ICON_ERASE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/></svg>';
NotePlace.SEAL_YES = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3L12.5 5"/></svg>';
NotePlace.SEAL_NO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
// Marks that draw themselves when they appear; once a state is drawn
// directly these are taken off, so nothing plays again later.
NotePlace.ENTRANCES = ['tl-np-pop', 'tl-np-write', 'tl-np-grow'];

NotePlace.esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
NotePlace.still = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
NotePlace.svg = function (tag, attrs) {
  var e = document.createElementNS(NotePlace.SVGNS, tag);
  Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  return e;
};

// A pitch as the question writes it: a letter, an accidental (bb, b, n,
// #, ## or x) and an octave, e.g. 'Eb4', 'F#3', 'C5'.
NotePlace.parse = function (s) {
  var m = /^([A-Ga-g])(bb|b|n|##|#|x)?(-?\d)$/.exec(String(s || '').trim());
  if (!m) return null;
  var acc = { bb: 'dblflat', b: 'flat', n: 'natural', '#': 'sharp', '##': 'dblsharp', x: 'dblsharp' }[m[2]] || null;
  return { letter: m[1].toUpperCase(), acc: acc, octave: Number(m[3]) };
};
NotePlace.alterToken = function (alter) { return { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': 'x' }[String(alter)] || ''; };
NotePlace.alterSign = function (alter) { return { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' }[String(alter)] || ''; };
NotePlace.alterEn = function (alter) { return { '-2': ' double flat', '-1': ' flat', '0': '', '1': ' sharp', '2': ' double sharp' }[String(alter)] || ''; };

// The glyphs the score library draws for a whole note and every
// accidental, measured once from a hidden drawing: each as a path and
// the offset that puts the note head's centre on (0, 0).
NotePlace.glyphs = function () {
  if (NotePlace._glyphs) return NotePlace._glyphs;
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:900px;visibility:hidden';
  document.body.appendChild(box);
  ABCJS.renderAbc(box, 'X:1\nL:1\nK:C clef=none stafflines=1\n__B _B =B ^B ^^B B|', { add_classes: true, staffwidth: 800 });
  var lb = box.querySelector('.abcjs-top-line').getBBox(), lineY = lb.y + lb.height / 2;
  var kinds = ['dblflat', 'flat', 'natural', 'sharp', 'dblsharp', null], out = { acc: {} };
  box.querySelectorAll('.abcjs-note').forEach(function (g, i) {
    var head = g.querySelector('.abcjs-notehead'), hb = head.getBBox(), hx = hb.x + hb.width / 2;
    if (!kinds[i]) { out.head = { d: head.getAttribute('d'), dx: -hx, dy: -lineY, w: hb.width, h: hb.height }; return; }
    var paths = [].filter.call(g.querySelectorAll('path'), function (p) { return !p.getAttribute('class'); });
    var x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    paths.forEach(function (p) { var b = p.getBBox(); x1 = Math.min(x1, b.x); x2 = Math.max(x2, b.x + b.width); y1 = Math.min(y1, b.y); y2 = Math.max(y2, b.y + b.height); });
    out.acc[kinds[i]] = { d: paths.map(function (p) { return p.getAttribute('d'); }).join(' '), dx: -hx, dy: -lineY, x: x1 - hx, y: y1 - lineY, w: x2 - x1, h: y2 - y1 };
  });
  box.remove();
  NotePlace._glyphs = out;
  return out;
};

// An accidental as inline SVG for text (a key, a caption), sized in em.
NotePlace.glyphHtml = function (kind, cls, heightEm) {
  var g = NotePlace.glyphs().acc[kind]; if (!g) return '';
  var band = 14, w = Math.max(g.w + 2, 8);
  var vb = (g.x - (w - g.w) / 2) + ' ' + (-band) + ' ' + w + ' ' + band * 2;
  var style = heightEm ? ' style="height:' + heightEm + 'em;width:' + (heightEm * w / (band * 2)).toFixed(3) + 'em;vertical-align:-.28em;margin:0 1px"' : '';
  return '<svg class="' + cls + '" viewBox="' + vb + '"' + style + ' aria-hidden="true"><path transform="translate(' + g.dx + ' ' + g.dy + ')" d="' + g.d + '"/></svg>';
};
// Text with every ♯ ♭ ♮ 𝄪 𝄫 swapped for the library's glyph.
NotePlace.inline = function (text) {
  var kinds = { '♯': 'sharp', '♭': 'flat', '♮': 'natural', '𝄪': 'dblsharp', '𝄫': 'dblflat' };
  return Array.from(String(text)).map(function (ch) { return kinds[ch] ? NotePlace.glyphHtml(kinds[ch], 'tl-np-inline', .95) : NotePlace.esc(ch); }).join('');
};

NotePlace.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
NotePlace.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };
NotePlace.prototype.known = function (list) {
  var ids = this.cols.map(function (c) { return c.id; });
  return [].concat(list === undefined || list === null ? [] : list).map(String).filter(function (k) { return ids.indexOf(k) >= 0; });
};
NotePlace.prototype.isAnswer = function (id) { return this.answers.indexOf(String(id)) >= 0; };

// Where a pitch sits on this clef, and back.
NotePlace.prototype.posOf = function (p) { return p.octave * 7 + NotePlace.LETTERS.indexOf(p.letter) - this.base; };
NotePlace.prototype.at = function (pos) {
  var d = this.base + pos, oct = Math.floor(d / 7);
  return { letter: NotePlace.LETTERS[d - oct * 7], octave: oct };
};
NotePlace.prototype.clamp = function (pos) { return Math.max(this.lo, Math.min(this.hi, pos)); };

// What a note written at this position with this accidental is: as it is
// written, and as it sounds once the key signature is applied.
NotePlace.prototype.describe = function (pos, acc) {
  var p = this.at(pos), keyAlter = this.keyAlter[p.letter] || 0;
  var alter = acc ? NotePlace.ALTER[acc] : keyAlter;
  return {
    pos: pos, accidental: acc || null,
    written: p.letter + (acc ? NotePlace.TOKEN[acc] : '') + p.octave,
    sounding: p.letter + NotePlace.alterToken(alter) + p.octave,
    name: p.letter + NotePlace.alterSign(alter) + p.octave,
    en: p.letter + NotePlace.alterEn(alter),
    midi: 12 * (p.octave + 1) + NotePlace.STEP[p.letter] + alter
  };
};
NotePlace.prototype.info = function (id) {
  var v = this.values[id]; if (!v) return null;
  return Object.assign({ id: id, index: this.answers.indexOf(id) }, this.describe(v.pos, v.acc));
};
NotePlace.prototype.givenInfo = function (c) { return this.describe(this.posOf(c.pitch), c.pitch.acc); };
// The given note an answer is measured from: the nearest one before it.
NotePlace.prototype.givenBefore = function (id) {
  var at = this.cols.map(function (c) { return c.id; }).indexOf(id);
  for (var i = at - 1; i >= 0; i--) if (this.cols[i].kind === 'given') return this.cols[i];
  return null;
};
NotePlace.prototype.startPos = function (id) { var g = this.givenBefore(id); return g ? this.clamp(this.posOf(g.pitch)) : this.clamp(4); };

// A pitch from a command, as written, with its position; a pitch that
// cannot be written within the range is ignored.
NotePlace.prototype.toValue = function (s) {
  var p = NotePlace.parse(s); if (!p) return null;
  var pos = this.posOf(p);
  if (pos < this.lo || pos > this.hi) return null;
  return { pos: pos, acc: p.acc };
};

// The score library's notation for this stave: the given notes as
// written, and a placeholder on the middle line for each answer and for
// the space beside it where the right note can be shown. The
// placeholders are measured and taken out.
NotePlace.prototype.abc = function () {
  var mid = this.at(4);
  var abcPitch = function (letter, octave, acc) {
    var s = octave >= 5 ? letter.toLowerCase() : letter;
    if (octave >= 6) s += new Array(octave - 4).join("'");
    if (octave <= 3) s += new Array(5 - octave).join(',');
    return (acc ? NotePlace.ABC[acc] : '') + s;
  };
  var tokens = [];
  this.cols.forEach(function (c) {
    if (c.kind === 'given') tokens.push(abcPitch(c.pitch.letter, c.pitch.octave, c.pitch.acc));
    else { tokens.push(abcPitch(mid.letter, mid.octave, null)); tokens.push(abcPitch(mid.letter, mid.octave, null)); }
  });
  return 'X:1\nL:1\n%%stretchlast 1\nK:' + this.o.key + ' clef=' + this.o.clef + '\n' + tokens.join(' ') + ' |]';
};

// Holds every glide and entrance while a state is drawn directly, takes
// the entrances off what is already drawn, and lets motion back in two
// frames later, when the drawing has settled.
NotePlace.prototype.hold = function () {
  var self = this;
  this.host.classList.add('tl-np-still');
  this.host.querySelectorAll('.' + NotePlace.ENTRANCES.join(', .')).forEach(function (e) { NotePlace.ENTRANCES.forEach(function (c) { e.classList.remove(c); }); });
  cancelAnimationFrame(this.release);
  this.release = requestAnimationFrame(function () { self.release = requestAnimationFrame(function () { self.host.classList.remove('tl-np-still'); }); });
};

// Redraws everything inside the host, e.g. after a change of width; what
// is written and every mark are state, so they come back.
NotePlace.prototype.build = function () {
  var self = this;
  this.stop();
  this.drag = null;
  this.host.innerHTML = '';
  this.hold();
  this.paper = document.createElement('div'); this.paper.className = 'tl-np-paper';
  if (this.o.tag) { var tag = document.createElement('div'); tag.className = 'tl-np-tag'; tag.textContent = this.o.tag; this.paper.appendChild(tag); }
  this.box = document.createElement('div'); this.box.className = 'tl-np-svgbox'; this.box.tabIndex = 0;
  this.box.setAttribute('role', 'group');
  this.drawing = document.createElement('div');
  this.box.appendChild(this.drawing);
  this.paper.appendChild(this.box);
  this.overlay = document.createElement('div'); this.overlay.className = 'tl-np-overlay';
  this.paper.appendChild(this.overlay);
  this.host.appendChild(this.paper);
  this.render();
  if (this.cols.some(function (c) { return c.under; })) {
    this.underEl = document.createElement('div'); this.underEl.className = 'tl-np-under';
    this.paper.appendChild(this.underEl);
  } else this.underEl = null;
  this.anchor = this.paper;
  if (this.o.name) {
    var nm = document.createElement('div'); nm.className = 'tl-np-name'; nm.innerHTML = NotePlace.inline(this.o.name);
    this.host.appendChild(nm);
    this.anchor = nm;
  }
  this.padWrap = document.createElement('div'); this.padWrap.className = 'tl-np-padwrap';
  this.pad = document.createElement('div'); this.pad.className = 'tl-np-pad'; this.pad.setAttribute('role', 'group'); this.pad.setAttribute('aria-label', 'Accidentals');
  this.keys = this.o.accidentals.filter(function (k) { return NotePlace.ALTER[k] !== undefined; }).map(function (k) { return { id: 'acc:' + k, acc: k }; });
  this.keys.push({ id: NotePlace.ERASE, ebony: true });
  this.keyEls = {};
  this.keys.forEach(function (k, i) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'tl-np-key' + (k.ebony ? ' tl-np-ebony' : '');
    b.dataset.key = k.id; b.tabIndex = i ? -1 : 0;
    if (k.ebony) { b.innerHTML = NotePlace.ICON_ERASE; b.setAttribute('aria-label', 'Rub out the note'); }
    else { b.innerHTML = NotePlace.glyphHtml(k.acc, 'tl-np-glyph'); b.setAttribute('aria-label', NotePlace.EN[k.acc]); }
    self.pad.appendChild(b);
    self.keyEls[k.id] = b;
  });
  this.padWrap.appendChild(this.pad);
  this.host.appendChild(this.padWrap);
  this.layer = document.createElement('div'); this.layer.className = 'tl-np-layer';
  this.host.appendChild(this.layer);
  this.room = null;
  this.padShown = null;
  this.layoutPad();
  this.placeUnder();
  this.apply(false);
  this.drawCount(false);
  this.placeCaption(false);
};

// The centres of the library's notes, in drawing units.
NotePlace.prototype.centres = function () {
  return [].map.call(this.drawing.querySelectorAll('.abcjs-note .abcjs-notehead'), function (h) { var b = h.getBBox(); return b.x + b.width / 2; });
};

// Draws the stave for the width it has. The stave aims for steps about
// ten pixels apart; when the clef, key and columns do not fit at that
// size, so that two columns would stand closer than an accidental and a
// head, it is drawn again a little smaller each time, until they fit or
// the stave reaches its smallest size. The box then keeps room above
// and below for the highest and lowest place a note may go.
NotePlace.prototype.render = function () {
  var self = this, W = Math.max(160, this.box.clientWidth || 300), N = NotePlace;
  var units = W / N.PX_PER_UNIT, most = W / N.MIN_PX_PER_UNIT, abc = this.abc();
  for (var attempt = 0; attempt < 6; attempt++) {
    this.visual = ABCJS.renderAbc(this.drawing, abc, { add_classes: true, responsive: 'resize', staffwidth: units, paddingtop: 0, paddingbottom: 0, paddingleft: 0, paddingright: 0 })[0];
    var xs = this.centres(), gap = Infinity;
    for (var i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
    if (gap >= N.MIN_GAP_UNITS || units >= most) break;
    units = Math.min(most, units + (N.MIN_GAP_UNITS - gap) * xs.length);
  }
  this.svg = this.drawing.querySelector('svg');
  this.svg.removeAttribute('tabindex');
  this.keyAlter = {};
  try { (this.visual.getKeySignature().accidentals || []).forEach(function (a) { self.keyAlter[a.note.toUpperCase()] = N.ALTER[a.acc] || 0; }); } catch (e) { this.keyAlter = {}; }
  var lines = [].slice.call(this.svg.querySelectorAll('.abcjs-staff path'));
  var lb0 = lines[0].getBBox(), lb4 = lines[lines.length - 1].getBBox();
  this.topY = lb0.y + lb0.height / 2;
  this.bottomY = lb4.y + lb4.height / 2;
  this.step = (this.bottomY - this.topY) / 8;
  this.lineH = lb0.height;
  this.staffRight = lb0.x + lb0.width;
  var extra = 0, bar = this.staffRight;
  this.svg.querySelectorAll('.abcjs-staff-extra').forEach(function (e) { var b = e.getBBox(); extra = Math.max(extra, b.x + b.width); });
  this.svg.querySelectorAll('.abcjs-bar').forEach(function (e) { bar = Math.min(bar, e.getBBox().x); });
  // Each column's centre; the placeholders go once measured.
  var notes = [].slice.call(this.svg.querySelectorAll('.abcjs-note')), k = 0;
  var head = function (g) { var b = g.querySelector('.abcjs-notehead').getBBox(); return b.x + b.width / 2; };
  this.cx = {}; this.revealX = {}; this.givenEl = {};
  this.cols.forEach(function (c) {
    if (c.kind === 'given') { self.cx[c.id] = head(notes[k]); self.givenEl[c.id] = notes[k]; k += 1; return; }
    self.cx[c.id] = head(notes[k]);
    self.revealX[c.id] = head(notes[k + 1]);
    notes[k].remove(); notes[k + 1].remove();
    k += 2;
  });
  var vb = this.svg.viewBox.baseVal, rect = this.svg.getBoundingClientRect();
  this.k = rect.width / (vb.width || rect.width);
  var top = this.yOf(this.hi) - N.MARGIN_UNITS, bottom = this.yOf(this.lo) + N.MARGIN_UNITS;
  this.box.style.paddingTop = Math.max(0, -top * this.k).toFixed(1) + 'px';
  this.box.style.paddingBottom = Math.max(0, (bottom - vb.height) * this.k).toFixed(1) + 'px';
  // Layers drawn over the library's drawing: the band under the finger
  // goes under the staff lines, the answers and marks over everything.
  this.band = N.svg('rect', { class: 'tl-np-band', x: extra + 2, width: Math.max(10, bar - extra - 4), height: this.step * 1.1, y: 0, rx: 1.5 });
  this.svg.insertBefore(this.band, this.svg.firstChild);
  this.marks = N.svg('g', { class: 'tl-np-marks' });
  this.svg.appendChild(this.marks);
  this.colEls = {};
  this.answers.forEach(function (id) {
    var g = N.svg('g', { class: 'tl-np-col tl-np-empty', 'data-id': id });
    var ledgers = N.svg('g', { class: 'tl-np-ledgers' });
    var note = self.noteShape();
    g.appendChild(ledgers); g.appendChild(note.g);
    var rev = N.svg('g', { class: 'tl-np-reveal', 'data-id': id });
    var revLedgers = N.svg('g', { class: 'tl-np-ledgers' });
    var revNote = self.noteShape();
    rev.appendChild(revLedgers); rev.appendChild(revNote.g);
    self.svg.insertBefore(g, self.marks);
    self.svg.insertBefore(rev, self.marks);
    self.colEls[id] = { g: g, ledgers: ledgers, note: note, rev: rev, revLedgers: revLedgers, revNote: revNote, drawn: null, revDrawn: null };
  });
  this.box.setAttribute('aria-label', this.o.clef + ' clef stave: up and down arrows move the note, # b n x write an accidental, backspace rubs it out');
};

// One note drawn with the library's glyphs: a head on (0, 0) and an
// accidental in front of it, moved as a whole. The accidental's glyph
// carries its own placement, so the group around it is what animates.
NotePlace.prototype.noteShape = function () {
  var G = NotePlace.glyphs();
  var g = NotePlace.svg('g', { class: 'tl-np-note' });
  var body = NotePlace.svg('g', { class: 'tl-np-body' });
  var accG = NotePlace.svg('g', { class: 'tl-np-acc' });
  var acc = NotePlace.svg('path', { d: '' });
  var head = NotePlace.svg('path', { class: 'tl-np-head', d: G.head.d, transform: 'translate(' + G.head.dx + ' ' + G.head.dy + ')' });
  accG.appendChild(acc);
  body.appendChild(accG); body.appendChild(head); g.appendChild(body);
  return { g: g, body: body, accG: accG, acc: acc, head: head, accKind: undefined };
};

NotePlace.prototype.yOf = function (pos) { return this.bottomY - pos * this.step; };
// Drawing units to pixels inside the paper, for the HTML marks.
NotePlace.prototype.toPaper = function (x, y) {
  var pt = this.svg.createSVGPoint(); pt.x = x; pt.y = y;
  var p = pt.matrixTransform(this.svg.getScreenCTM());
  var r = this.paper.getBoundingClientRect();
  return { x: p.x - r.left, y: p.y - r.top };
};
NotePlace.prototype.fromScreen = function (cx, cy) {
  var pt = this.svg.createSVGPoint(); pt.x = cx; pt.y = cy;
  return pt.matrixTransform(this.svg.getScreenCTM().inverse());
};
NotePlace.prototype.posAt = function (cy) { var p = this.fromScreen(0, cy); return this.clamp(Math.round((this.bottomY - p.y) / this.step)); };
// The answer column nearest a point across the stave.
NotePlace.prototype.colAt = function (cx) {
  var x = this.fromScreen(cx, 0).x, self = this, best = this.answers[0], d = Infinity;
  this.answers.forEach(function (id) { var e = Math.abs(self.cx[id] - x); if (e < d) { d = e; best = id; } });
  return best;
};

// Keys are all one size; they go in one row when it fits, else in rows
// of nearly equal length.
NotePlace.prototype.layoutPad = function () {
  var W = this.padWrap.clientWidth - 4 - 2 * NotePlace.PAD_INSET, G = NotePlace.KEY_GAP, n = this.keys.length;
  var kw = NotePlace.KEY_W, fit = function (w) { return Math.max(1, Math.floor((W + G) / (w + G))); };
  var max = fit(kw);
  if (max < n && fit(NotePlace.KEY_W_NARROW) >= n) { kw = NotePlace.KEY_W_NARROW; max = n; }
  var rows = Math.ceil(n / max), cols = Math.ceil(n / rows);
  this.padCols = cols;
  this.pad.style.setProperty('--kc', String(cols));
  this.pad.style.setProperty('--kw', kw + 'px');
};

NotePlace.prototype.placeUnder = function () {
  if (!this.underEl) return;
  var self = this;
  this.underEl.innerHTML = '';
  this.cols.forEach(function (c) {
    if (!c.under) return;
    var s = document.createElement('span'); s.innerHTML = NotePlace.inline(c.under);
    var p = self.toPaper(self.cx[c.id], 0), u = self.underEl.offsetLeft;
    s.style.left = (p.x - u).toFixed(1) + 'px';
    self.underEl.appendChild(s);
  });
};

// Ledger lines a note at this position needs, drawn as the library draws
// them; ones that stay are kept, new ones grow from the middle, ones no
// longer needed fade.
NotePlace.prototype.ledgers = function (g, pos, x, move) {
  var want = [], p;
  if (pos !== null && pos >= 10) for (p = 10; p <= pos; p += 2) want.push(p);
  if (pos !== null && pos <= -2) for (p = -2; p >= pos; p -= 2) want.push(p);
  var self = this, have = {};
  [].slice.call(g.children).forEach(function (e) {
    var at = Number(e.dataset.pos);
    if (e.classList.contains('tl-np-gone')) return;
    if (want.indexOf(at) < 0 || Number(e.dataset.x) !== x) {
      if (move) { e.classList.add('tl-np-gone'); setTimeout(function () { e.remove(); }, 200); } else e.remove();
    } else have[at] = true;
  });
  want.forEach(function (at) {
    if (have[at]) return;
    var r = NotePlace.svg('rect', { class: 'tl-np-ledger' + (move ? ' tl-np-grow' : ''), x: x - NotePlace.LEDGER_HALF, width: NotePlace.LEDGER_HALF * 2, y: self.yOf(at) - self.lineH / 2, height: self.lineH });
    r.dataset.pos = String(at); r.dataset.x = String(x);
    g.appendChild(r);
  });
};

// Puts a note shape at a position with an accidental: it glides there,
// the accidental is written in front of it when it changes.
NotePlace.prototype.shape = function (shape, x, pos, acc, move) {
  shape.g.style.transform = 'translate(' + x.toFixed(2) + 'px, ' + this.yOf(pos).toFixed(2) + 'px)';
  if (shape.accKind === acc) return;
  shape.accKind = acc;
  var G = NotePlace.glyphs().acc[acc];
  shape.acc.setAttribute('d', G ? G.d : '');
  if (G) shape.acc.setAttribute('transform', 'translate(' + G.dx + ' ' + G.dy + ')'); else shape.acc.removeAttribute('transform');
  shape.accG.classList.remove('tl-np-write');
  if (G && move) { void shape.accG.getBBox(); shape.accG.classList.add('tl-np-write'); }
};

// A note shape that appears now: it is put in place without gliding,
// then pops up.
NotePlace.prototype.land = function (shape, x, pos, acc) {
  shape.g.style.transition = 'none';
  this.shape(shape, x, pos, acc, false);
  void shape.g.getBoundingClientRect();
  shape.g.style.transition = '';
  shape.body.classList.remove('tl-np-pop');
  void shape.body.getBBox();
  shape.body.classList.add('tl-np-pop');
};

// Applies the state to what is drawn.
NotePlace.prototype.apply = function (animated) {
  var self = this, move = animated && !NotePlace.still();
  this.host.classList.toggle('tl-np-locked', this.locked);
  this.answers.forEach(function (id) {
    var el = self.colEls[id], v = self.values[id], x = self.cx[id];
    var dragging = self.drag && self.drag.id === id;
    var pos = dragging ? self.drag.pos : v ? v.pos : null, acc = v ? v.acc : null;
    el.g.classList.toggle('tl-np-empty', pos === null);
    el.g.classList.toggle('tl-np-dragging', !!dragging);
    if (pos !== null) {
      if (el.drawn === null && move) self.land(el.note, x, pos, acc);
      else self.shape(el.note, x, pos, acc, move);
    }
    self.ledgers(el.ledgers, pos, x, move);
    el.drawn = pos;
    var verdict = self.verdict[id];
    el.g.classList.toggle('tl-np-right', verdict === true && pos !== null);
    el.g.classList.toggle('tl-np-wrong', verdict === false && pos !== null);
    el.g.classList.toggle('tl-lit', self.held.indexOf(id) >= 0);
    var r = self.revealed[id];
    el.rev.style.display = r ? '' : 'none';
    if (r) {
      var rx = self.revealX[id];
      if (el.revDrawn === null && move) self.land(el.revNote, rx, r.pos, r.acc);
      else self.shape(el.revNote, rx, r.pos, r.acc, move);
      self.ledgers(el.revLedgers, r.pos, rx, move);
      el.revDrawn = r.pos;
    } else { self.ledgers(el.revLedgers, null, 0, false); el.revDrawn = null; }
  });
  this.cols.forEach(function (c) { if (c.kind === 'given' && self.givenEl[c.id]) self.givenEl[c.id].classList.toggle('tl-lit', self.held.indexOf(c.id) >= 0); });
  this.band.classList.toggle('on', !!this.drag);
  if (this.drag) this.band.setAttribute('y', (this.yOf(this.drag.pos) - this.step * .55).toFixed(2));
  this.marksHtml(move);
  var cv = this.cur && this.values[this.cur];
  this.keys.forEach(function (k) {
    if (k.ebony) return;
    var on = !!cv && cv.acc === k.acc;
    self.keyEls[k.id].classList.toggle('tl-np-on', on);
    self.keyEls[k.id].setAttribute('aria-pressed', String(on));
  });
  var cur = this.cur && this.info(this.cur);
  this.box.setAttribute('aria-valuetext', cur ? cur.en + ' ' + cur.written.slice(-1) : 'no note');
  this.showPad(!this.locked, move);
};

// Seals right over the answer notes, letters higher above them (never
// lower than just over the stave), and the caret under the column the
// keys act on when there are several.
NotePlace.prototype.marksHtml = function (move) {
  var self = this, N = NotePlace;
  this.answers.forEach(function (id) {
    var v = self.values[id], verdict = self.verdict[id];
    var seal = v && (verdict === true || verdict === false) ? (verdict ? 'yes' : 'no') : null;
    var key = seal ? seal + ':' + v.pos : null;
    var old = self.overlay.querySelector('.tl-np-seal[data-id="' + id + '"]');
    if (old && old.dataset.k !== key) { old.remove(); old = null; }
    if (seal && !old) {
      var s = document.createElement('span'); s.className = 'tl-np-seal tl-np-' + seal + (move ? ' tl-np-pop' : ''); s.dataset.id = id; s.dataset.k = key;
      s.innerHTML = seal === 'yes' ? N.SEAL_YES : N.SEAL_NO;
      var p = self.toPaper(self.cx[id], self.yOf(v.pos) - N.HEAD_RISE);
      s.style.left = p.x.toFixed(1) + 'px'; s.style.top = (p.y - N.SEAL_GAP_PX).toFixed(1) + 'px';
      self.overlay.appendChild(s);
    }
    var text = self.labels[id] || null, ob = self.overlay.querySelector('.tl-np-badge[data-id="' + id + '"]');
    if (ob && ob.textContent !== text) { ob.remove(); ob = null; }
    if (text) {
      if (!ob) { ob = document.createElement('span'); ob.className = 'tl-np-badge' + (move ? ' tl-np-pop' : ''); ob.dataset.id = id; ob.textContent = text; ob.setAttribute('aria-hidden', 'true'); self.overlay.appendChild(ob); }
      var at = Math.max(N.BADGE_MIN_POS, (v ? v.pos : 0) + N.BADGE_STEPS);
      var q = self.toPaper(self.cx[id], self.yOf(at));
      ob.style.left = q.x.toFixed(1) + 'px'; ob.style.top = q.y.toFixed(1) + 'px';
    }
  });
  var caret = this.overlay.querySelector('.tl-np-caret');
  var showCaret = this.answers.length > 1 && !this.locked && this.cur;
  if (!showCaret) { if (caret) caret.remove(); return; }
  if (!caret) { caret = document.createElement('span'); caret.className = 'tl-np-caret'; this.overlay.appendChild(caret); }
  var c = this.toPaper(this.cx[this.cur], this.yOf(this.lo) + 5);
  caret.style.left = c.x.toFixed(1) + 'px'; caret.style.top = c.y.toFixed(1) + 'px';
};

// The tray of keys folds away once the answer is handed in and opens
// again when it is unlocked: its height glides and its keys fade.
NotePlace.prototype.showPad = function (show, move) {
  if (this.padShown === show) return;
  var w = this.padWrap, first = this.padShown === null, self = this;
  this.padShown = show;
  w.getAnimations().forEach(function (a) { a.cancel(); });
  w.setAttribute('aria-hidden', String(!show));
  w.inert = !show;
  if (!move || first) { w.style.height = show ? '' : '0px'; w.style.visibility = show ? '' : 'hidden'; return; }
  var from = w.offsetHeight;
  w.style.height = ''; w.style.visibility = '';
  var to = show ? w.offsetHeight : 0;
  w.style.height = show ? '' : '0px';
  var a = w.animate([{ height: from + 'px', opacity: show ? 0 : 1 }, { height: to + 'px', opacity: show ? 1 : 0 }], { duration: NotePlace.MOVE_MS, easing: NotePlace.EASE });
  if (!show) a.onfinish = function () { if (!self.padShown) w.style.visibility = 'hidden'; };
};

// ---------- Sound (lectures only) ----------
NotePlace.prototype.sound = function (midi, delay, dur) {
  if (!this.audible()) return;
  var v = this.o.sound.play(midi, delay || 0, dur || .9, .8);
  if (v) this.voices.push(v);
};
NotePlace.prototype.silence = function () { (this.voices || []).forEach(function (v) { v.stop(); }); this.voices = []; };

// ---------- The child's input ----------
// Taps: a key (the nearest within a few pixels, so the gaps between keys
// count), else the stave (anywhere on it: the note goes to the nearest
// answer column, at the height of the finger), else the blank.
NotePlace.prototype.onPointer = function (ev) {
  var self = this, x = ev.clientX, y = ev.clientY;
  this.host.classList.remove('kbd');
  if (this.padShown) {
    var best = null, dist = Infinity;
    this.keys.forEach(function (k) {
      var b = self.keyEls[k.id].getBoundingClientRect();
      var d = Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
      if (d < dist) { dist = d; best = k; }
    });
    if (best && dist <= NotePlace.KEY_REACH_PX) { ev.preventDefault(); this.pressKey(best.id, ev); return; }
  }
  var r = this.box.getBoundingClientRect();
  if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
    ev.preventDefault();
    if (this.locked || !this.answers.length) return;
    this.box.focus({ preventScroll: true });
    var id = this.colAt(x), pos = this.posAt(y);
    this.stopCount();
    this.cur = id;
    this.drag = { id: id, pos: pos, pointer: ev.pointerId, moved: false };
    try { this.host.setPointerCapture(ev.pointerId); } catch (e) { /* the pointer is already gone */ }
    this.apply(true);
    return;
  }
  this.emit('blankTap', {});
};

NotePlace.prototype.onMove = function (ev) {
  if (!this.drag || ev.pointerId !== this.drag.pointer) return;
  var pos = this.posAt(ev.clientY);
  if (pos === this.drag.pos) return;
  this.drag.pos = pos; this.drag.moved = true;
  this.apply(true);
};

// The note lands where the finger lets go, keeping the accidental it
// had; a cancelled drag puts nothing down.
NotePlace.prototype.onUp = function (ev, cancelled) {
  var d = this.drag;
  if (!d || ev.pointerId !== d.pointer) return;
  this.drag = null;
  if (cancelled) { this.apply(true); return; }
  var old = this.values[d.id], first = !old;
  this.values[d.id] = { pos: d.pos, acc: old ? old.acc : null };
  this.apply(true);
  if (first) this.splash(d.id);
  this.sound(this.info(d.id).midi);
  this.emit('notePlace', Object.assign(this.info(d.id), { by: d.moved ? 'drag' : 'tap' }));
};

NotePlace.prototype.onKey = function (ev) {
  var t = ev.target, k = ev.key;
  if (t.classList.contains('tl-np-key')) {
    var i = this.keys.map(function (x) { return x.id; }).indexOf(t.dataset.key), j = null;
    if (k === 'Enter' || k === ' ') { ev.preventDefault(); this.pressKey(t.dataset.key, null); return; }
    if (k === 'ArrowRight') j = Math.min(this.keys.length - 1, i + 1);
    else if (k === 'ArrowLeft') j = Math.max(0, i - 1);
    else if (k === 'ArrowDown') j = Math.min(this.keys.length - 1, i + this.padCols);
    else if (k === 'ArrowUp') j = Math.max(0, i - this.padCols);
    else if (k === 'Escape') { this.emit('blankTap', {}); return; }
    if (j === null || j === i) return;
    ev.preventDefault();
    var next = this.keyEls[this.keys[j].id];
    t.tabIndex = -1; next.tabIndex = 0; next.focus();
    return;
  }
  if (t !== this.box || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (k === 'Escape') { this.emit('blankTap', {}); return; }
  if (this.locked || !this.cur) return;
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    ev.preventDefault();
    var v = this.values[this.cur], id = this.cur;
    var pos = v ? this.clamp(v.pos + (k === 'ArrowUp' ? 1 : -1)) : this.startPos(id);
    if (v && pos === v.pos) return;
    this.stopCount();
    this.values[id] = { pos: pos, acc: v ? v.acc : null };
    this.apply(true);
    if (!v) this.splash(id);
    this.sound(this.info(id).midi, 0, .5);
    this.emit('notePlace', Object.assign(this.info(id), { by: 'key' }));
    return;
  }
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    var at = this.answers.indexOf(this.cur), to = this.answers[k === 'ArrowRight' ? Math.min(this.answers.length - 1, at + 1) : Math.max(0, at - 1)];
    ev.preventDefault();
    if (to !== this.cur) { this.cur = to; this.apply(true); }
    return;
  }
  if (k === 'Backspace' || k === 'Delete') { ev.preventDefault(); this.pressKey(NotePlace.ERASE, null); return; }
  var acc = this.typed(k);
  if (!acc) return;
  ev.preventDefault();
  this.pressKey('acc:' + acc, null);
};

// The accidental a typed character writes: # or s a sharp, b or f a flat
// (typed again on a sharp or flat, the double one; typed again on the
// double one, it is taken away), n a natural, x a double sharp; only
// accidentals the question offers.
NotePlace.prototype.typed = function (ch) {
  var v = this.values[this.cur], now = v ? v.acc : null, offered = this.o.accidentals, want = null;
  var c = ch.toLowerCase();
  if (ch === '#' || c === 's') want = now === 'sharp' && offered.indexOf('dblsharp') >= 0 ? 'dblsharp' : now === 'dblsharp' ? 'dblsharp' : 'sharp';
  else if (c === 'b' || c === 'f') want = now === 'flat' && offered.indexOf('dblflat') >= 0 ? 'dblflat' : now === 'dblflat' ? 'dblflat' : 'flat';
  else if (c === 'n') want = 'natural';
  else if (c === 'x') want = 'dblsharp';
  return want && offered.indexOf(want) >= 0 ? want : null;
};

// A key pressed by the child. An accidental key writes that accidental
// in front of the note, or takes it away when the note already has it;
// with no note there is nothing to write on, and the column flashes. The
// ebony key rubs the note out. Locked, nothing changes.
NotePlace.prototype.pressKey = function (kid, ev) {
  if (this.locked) return;
  var el = this.keyEls[kid];
  if (el) { el.classList.add('tl-np-down'); setTimeout(function () { el.classList.remove('tl-np-down'); }, 140); }
  if (ev) this.tapRipple(ev.clientX, ev.clientY);
  var id = this.cur; if (!id) return;
  this.stopCount();
  var v = this.values[id];
  if (kid === NotePlace.ERASE) {
    if (v) { this.values[id] = null; delete this.verdict[id]; this.apply(true); } else this.reject(id);
    this.emit('noteErase', { id: id, accepted: !!v });
    return;
  }
  var acc = kid.slice(4);
  if (!v) { this.reject(id); this.emit('accidentalPress', { accidental: acc, id: id, accepted: false, note: null }); return; }
  v.acc = v.acc === acc ? null : acc;
  this.apply(true);
  this.sound(this.info(id).midi, 0, .6);
  this.emit('accidentalPress', { accidental: acc, id: id, accepted: true, note: this.info(id) });
};

// Nothing to act on: a dashed brick-red frame flashes round the column.
NotePlace.prototype.reject = function (id) {
  var x = this.cx[id], y1 = this.yOf(Math.min(this.hi, 12)) - 4, y2 = this.yOf(Math.max(this.lo, -4)) + 4;
  var r = NotePlace.svg('rect', { class: 'tl-np-flash', x: x - 15, y: y1, width: 30, height: y2 - y1, rx: 4 });
  this.marks.appendChild(r);
  setTimeout(function () { r.remove(); }, NotePlace.FLASH_MS);
};

// A ring spreading from a note that has just landed.
NotePlace.prototype.splash = function (id) {
  if (NotePlace.still()) return;
  var v = this.values[id]; if (!v) return;
  var c = NotePlace.svg('circle', { class: 'tl-np-ripple', cx: this.cx[id], cy: this.yOf(v.pos), r: 7 });
  this.marks.appendChild(c);
  setTimeout(function () { c.remove(); }, 600);
};
NotePlace.prototype.tapRipple = function (cx, cy) {
  var rect = this.host.getBoundingClientRect(), r = document.createElement('div'); r.className = 'tl-np-tap';
  r.style.left = cx - rect.left + 'px'; r.style.top = cy - rect.top + 'px';
  this.layer.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};
// A key pressed by the workflow in a lecture: it sinks and glows violet.
NotePlace.prototype.flashKey = function (kid) {
  var el = this.keyEls[kid]; if (!el || !this.padShown) return;
  el.classList.add('tl-np-down', 'tl-np-flashkey');
  setTimeout(function () { el.classList.remove('tl-np-down'); }, 180);
  setTimeout(function () { el.classList.remove('tl-np-flashkey'); }, 520);
  var b = el.getBoundingClientRect();
  this.tapRipple(b.left + b.width / 2, b.top + b.height / 2);
};

// ---------- Counting up from the given note ----------
// The count in state: from one position to another, how many steps are
// shown. A dot marks every step passed, the number stands beside the
// last; while counting, a violet note climbs from step to step.
NotePlace.prototype.drawCount = function (move) {
  var old = this.marks.querySelector('.tl-np-count'); if (old) old.remove();
  var c = this.counted; if (!c || this.cx[c.id] === undefined || !c.n) return;
  var g = NotePlace.svg('g', { class: 'tl-np-count' }), x = this.cx[c.id], dir = c.to >= c.from ? 1 : -1;
  var last = c.from + dir * (c.n - 1);
  for (var i = 0; i < c.n; i++) {
    g.appendChild(NotePlace.svg('circle', { class: 'tl-np-dot' + (move && i === c.n - 1 ? ' tl-np-pop' : ''), cx: x + 13, cy: this.yOf(c.from + dir * i), r: 1.5 }));
  }
  var t = NotePlace.svg('text', { class: 'tl-np-num' + (move ? ' tl-np-pop' : ''), x: x + 17, y: this.yOf(last) + 2.8 });
  t.textContent = String(c.n);
  g.appendChild(t);
  if (c.walking) {
    var ghost = this.noteShape();
    ghost.g.classList.add('tl-np-ghost');
    g.insertBefore(ghost.g, g.firstChild);
    ghost.g.style.transition = 'none';
    this.shape(ghost, x, move ? c.from + dir * Math.max(0, c.n - 2) : last, null, false);
    if (move) { void ghost.g.getBoundingClientRect(); ghost.g.style.transition = ''; this.shape(ghost, x, last, null, false); }
  }
  this.marks.appendChild(g);
};
NotePlace.prototype.stopCount = function () {
  if (this.counted && this.counted.walking) { this.timers.forEach(clearTimeout); this.timers = []; this.counted.walking = false; this.drawCount(false); }
};

// The caption in state, as a dark bubble under the stave pointing at its
// answer. The component first opens room under the stave, so the keys
// move down and nothing is covered; then the bubble pops up. Taken away,
// the bubble fades first and then the room closes.
NotePlace.prototype.placeCaption = function (animated) {
  var move = animated && !NotePlace.still(), N = NotePlace;
  var c = this.cap;
  var old = this.room; this.room = null;
  if (old) {
    if (move) {
      var bub = old.querySelector('.tl-np-bubble'); if (bub) bub.style.opacity = '0';
      old.animate([{ height: old.offsetHeight + 'px' }, { height: '0px' }], { duration: N.MOVE_MS, delay: N.BUBBLE_FADE_MS, easing: N.EASE, fill: 'forwards' }).onfinish = function () { old.remove(); };
    } else old.remove();
  }
  if (!c) return;
  var room = document.createElement('div'); room.className = 'tl-np-room';
  var b = document.createElement('div'); b.className = 'tl-np-bubble'; b.innerHTML = c.html;
  room.appendChild(b);
  this.host.insertBefore(room, this.anchor.nextSibling);
  var h = b.offsetHeight + 14, W = room.clientWidth, bw = b.offsetWidth;
  var rr = room.getBoundingClientRect(), pr = this.paper.getBoundingClientRect();
  var vx = this.toPaper(this.cx[c.id], 0).x + pr.left - rr.left;
  var left = Math.max(4, Math.min(W - 4 - bw, vx - bw / 2));
  b.style.left = left + 'px';
  b.style.setProperty('--ax', Math.max(12, Math.min(bw - 12, vx - left)) + 'px');
  room.style.height = h + 'px';
  this.room = room;
  if (move) {
    room.animate([{ height: '0px' }, { height: h + 'px' }], { duration: N.MOVE_MS, easing: N.EASE });
    b.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 350, delay: N.MOVE_MS * .55, easing: 'cubic-bezier(.2, 1.4, .4, 1)', fill: 'backwards' });
  }
};

// ---------- Commands ----------
// Makes an answer the one the keys act on.
NotePlace.prototype.focus = function (id) { if (!this.isAnswer(id)) return; this.cur = String(id); this.apply(true); };
// Writes these notes for the child (a demonstration, or the answer given
// back when a question is opened again); null rubs one out.
NotePlace.prototype.write = function (map) {
  var self = this, landed = [];
  Object.keys(map || {}).forEach(function (id) {
    if (!self.isAnswer(id)) return;
    var v = map[id] === null ? null : self.toValue(map[id]);
    if (map[id] !== null && !v) return;
    if (v && !self.values[id]) landed.push(id);
    self.values[id] = v;
  });
  this.stopCount();
  this.apply(true);
  landed.forEach(function (id) { self.splash(id); self.sound(self.info(id).midi); });
};
// Presses an accidental key for the child, as a lecture shows it: the key
// glows, and a moment later the accidental is written (null takes the
// note's accidental off, pressing its key again).
NotePlace.prototype.press = function (id, acc) {
  var self = this; if (!this.isAnswer(id)) return;
  id = String(id);
  var v = this.values[id], kind = acc && NotePlace.ALTER[acc] !== undefined ? acc : null;
  if (!v) return;
  this.cur = id; this.apply(true);
  this.flashKey('acc:' + (kind || v.acc));
  this.timers.push(setTimeout(function () {
    var now = self.values[id]; if (!now) return;
    now.acc = kind;
    self.apply(true);
    self.sound(self.info(id).midi, 0, .9);
  }, NotePlace.PRESS_MS));
};
// Counts up (or down) from the given note to a pitch, one line or space
// at a time; in a lecture each step sounds, with the key signature. With
// no pitch, the count is taken away.
NotePlace.prototype.count = function (id, to, opts) {
  var self = this; opts = opts || {};
  this.stop();
  if (!this.isAnswer(id) || to === null || to === undefined) { this.counted = null; this.drawCount(false); return; }
  id = String(id);
  var end = this.toValue(to); if (!end) return;
  var from = opts.from ? this.toValue(opts.from) : null;
  var start = from ? from.pos : this.startPos(id), n = Math.abs(end.pos - start) + 1, dir = end.pos >= start ? 1 : -1;
  var gap = opts.gapMs || NotePlace.COUNT_GAP_MS;
  this.counted = { id: id, from: start, to: end.pos, n: 0, walking: true };
  for (var i = 1; i <= n; i++) (function (i) {
    self.timers.push(setTimeout(function () {
      self.counted.n = i;
      self.counted.walking = true;
      self.drawCount(true);
      self.sound(self.describe(start + dir * (i - 1), null).midi, 0, .45);
      if (i === n) self.timers.push(setTimeout(function () { self.counted.walking = false; self.drawCount(false); }, gap));
    }, gap * (i - 1)));
  })(i);
};
NotePlace.prototype.highlight = function (list) { this.held = this.known(list); this.apply(true); };
NotePlace.prototype.label = function (map) {
  var self = this; this.labels = {};
  Object.keys(map || {}).forEach(function (k) { if (self.isAnswer(k)) self.labels[k] = String(map[k]); });
  this.apply(true);
};
// Right or wrong, as the workflow judged it from the question file: a map
// from answer to true or false; null takes a verdict away.
NotePlace.prototype.check = function (map) {
  var self = this;
  Object.keys(map || {}).forEach(function (k) {
    if (!self.isAnswer(k)) return;
    if (map[k] === true || map[k] === false) self.verdict[k] = map[k]; else delete self.verdict[k];
  });
  this.apply(true);
};
// Shows the right note beside an answer, in violet; null takes it away.
NotePlace.prototype.reveal = function (map) {
  var self = this;
  Object.keys(map || {}).forEach(function (k) {
    if (!self.isAnswer(k)) return;
    var v = map[k] === null ? null : self.toValue(map[k]);
    if (v) self.revealed[k] = v; else delete self.revealed[k];
  });
  this.apply(true);
};
NotePlace.prototype.lock = function (on) { this.locked = on !== false; this.drag = null; this.stop(); this.apply(true); };
// Shows a caption under an answer; with no answer, takes it away.
NotePlace.prototype.caption = function (id, html) {
  this.cap = id !== null && id !== undefined && this.isAnswer(id) ? { id: String(id), html: html } : null;
  this.placeCaption(true);
};
// Plays the given note, then the answer, then both together (lectures).
NotePlace.prototype.play = function (id) {
  var self = this; if (!this.isAnswer(id) || !this.audible()) return;
  id = String(id);
  var a = this.info(id), g = this.givenBefore(id), gi = g ? this.givenInfo(g) : null, t = 0;
  if (!a) return;
  this.silence();
  this.emit('playStart', { id: id });
  if (gi) { this.sound(gi.midi, 0, .8); t = .9; }
  this.sound(a.midi, t, .8);
  if (gi) { this.sound(gi.midi, t + 1, 1.4); this.sound(a.midi, t + 1, 1.4); }
  this.timers.push(setTimeout(function () { self.emit('playEnd', { id: id }); }, (gi ? t + 2.4 : .9) * 1000));
};

// Shows exactly this state with nothing moving, the way the component
// stood at the end of an act; used when the player steps back or forward
// or a question is opened again. Anything left out is cleared.
NotePlace.prototype.set = function (s) {
  var self = this; s = s || {};
  this.stop();
  this.drag = null;
  this.answers.forEach(function (id) { self.values[id] = null; });
  Object.keys(s.notes || {}).forEach(function (id) { if (self.isAnswer(id)) self.values[id] = self.toValue(s.notes[id]); });
  this.verdict = {}; Object.keys(s.checks || {}).forEach(function (id) { if (self.isAnswer(id) && (s.checks[id] === true || s.checks[id] === false)) self.verdict[id] = s.checks[id]; });
  this.revealed = {}; Object.keys(s.reveal || {}).forEach(function (id) { var v = self.isAnswer(id) && self.toValue(s.reveal[id]); if (v) self.revealed[id] = v; });
  this.labels = {}; Object.keys(s.labels || {}).forEach(function (id) { if (self.isAnswer(id)) self.labels[id] = String(s.labels[id]); });
  this.held = this.known(s.highlight);
  this.locked = !!s.locked;
  this.cur = this.isAnswer(s.focus) ? String(s.focus) : this.answers[0] || null;
  this.cap = s.caption && this.isAnswer(s.caption.id) ? { id: String(s.caption.id), html: s.caption.html } : null;
  this.counted = null;
  if (s.count && this.isAnswer(s.count.id)) {
    var end = this.toValue(s.count.to), from = s.count.from ? this.toValue(s.count.from) : null;
    if (end) { var st = from ? from.pos : this.startPos(String(s.count.id)); this.counted = { id: String(s.count.id), from: st, to: end.pos, n: Math.abs(end.pos - st) + 1, walking: false }; }
  }
  this.hold();
  this.apply(false);
  this.drawCount(false);
  this.placeCaption(false);
};

// Stops whatever the workflow set going: a count, a key press, a playing
// interval; what is written stays.
NotePlace.prototype.stop = function () {
  (this.timers || []).forEach(clearTimeout); this.timers = [];
  if (this.counted && this.counted.walking) { this.counted.walking = false; if (this.marks) this.drawCount(false); }
  this.silence();
};

NotePlace.prototype.clear = function () { this.set({}); };
