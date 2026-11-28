/* ============================================================
   Choice component. Answers by ticking, as on an exam paper: either a
   set of options, each a paper tile with a tick box (one or several may
   be picked), or a row of boxes under a score, each ticked or crossed.
   The child's marks are drawn in ink; what the workflow lights or
   confirms is in the accent, what is wrong in the wrong colour with a
   dashed edge and a cross, an option ruled out has a rule through it.
   Every colour is a theme constant the stylesheet reads; the script
   draws no colour of its own.
   The component does not know the answer: the workflow tells it what
   to draw right or wrong.

   Options stand in a grid of up to MAX_ROW in a row. Given a view
   (fitView({width, height}), the most room it may take) that the grid
   is too tall for, the options stand in one row instead, inside a
   window as wide as the choice: the option in question (captioned,
   else spotlit, else lit, else picked, else the first) stands in the
   middle, the ones beside it fade toward the window's edges, and the
   row slides to another option when the workflow points at it, when
   the child drags or swipes it, or when the keyboard moves to it. A tap
   on a partly seen option picks it and brings it to the middle. With
   no view, or one the grid fits, the grid comes back. A row of boxes
   under a score spans the score and is not changed by a view.

   Inputs: shape ('list' | 'marks'), tag, prompt (parts), options
   ([{id, parts: [{text} | {term} | {abc}], name}]), pick, boxes,
   mode ('lecture' | 'practice'), tempo.
   Commands: select, strike, highlight, spotlight, label, caption,
   check, lock, place, set, play, stop, clear, fitView.
   Events (via onEvent): optionTap, boxTap, blankTap.
   Sound goes through the injected source, lectures only.
   ============================================================ */
function Choice(host, options) {
  var self = this;
  this.host = host;
  this.o = Object.assign({ shape: 'list', tag: '', prompt: null, options: [], pick: 1, boxes: 0, mode: 'practice', tempo: 96, sound: null, onEvent: function () {} }, options);
  this.selected = [];
  this.values = [];
  for (var i = 0; i < this.o.boxes; i++) this.values.push(null);
  this.struck = {};
  this.verdict = {};
  this.labels = {};
  this.held = [];
  this.spot = null;
  this.cap = null;
  this.locked = false;
  this.xs = null;
  this.timers = [];
  this.voices = [];
  this.view = null;
  this.row = false;
  this.at = null;
  this.shift = 0;
  this.press = null;
  host.classList.add('tl-ch', 'tl-ch-is-' + this.o.shape);
  host.addEventListener('pointerdown', function (ev) { self.onPointer(ev); });
  host.addEventListener('pointermove', function (ev) { self.onMove(ev); });
  host.addEventListener('pointerup', function (ev) { self.onUp(ev); });
  host.addEventListener('pointercancel', function () { self.onCancel(); });
  host.addEventListener('keydown', function (ev) { self.onKey(ev); });
  host.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') host.classList.add('kbd'); });
  this.build();
}
Choice.MOVE_MS = 520;
Choice.EASE = 'cubic-bezier(.6, 0, .25, 1)';
Choice.BUBBLE_FADE_MS = 200;
Choice.GAP = 12;
Choice.MAX_ROW = 4;
// A tap between two targets goes to the nearer one; further than this
// from every target it is a tap on the blank.
Choice.REACH_PX = 8;
Choice.MARK_REACH_PX = 30;
// In one row an option takes at most this share of the window, so the
// ones beside it show; and at least this many pixels.
Choice.ROW_SHARE = .72;
Choice.ROW_MIN_PX = 120;
// A press that moves this far sideways drags the row instead of tapping.
Choice.DRAG_PX = 6;
Choice.STAFF_SCALE = .8;
Choice.LETTERS = 'CDEFGAB';
Choice.STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
Choice.SHIFT = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
// The child's marks, drawn like a pen stroke inside a 36-unit box.
Choice.TICK_INK = ['M7.5 19.5C10 21.2 12.3 23.8 14.2 27C18.2 18.6 23 12.2 30 6.2'];
Choice.CROSS_INK = ['M9.5 9.2C15 14.8 20.6 20.8 26.8 27', 'M27 9C21 14.8 15.2 20.8 9.2 27.2'];
Choice.SEAL_YES = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3L12.5 5"/></svg>';
Choice.SEAL_NO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
Choice.WORDS = { tick: 'ticked', cross: 'crossed' };
// Marks that draw themselves when they appear; once a state is drawn
// directly these are taken off, so nothing plays again later.
Choice.ENTRANCES = ['tl-ch-draw', 'tl-ch-pop'];

Choice.esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
Choice.still = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; };

// Accidental glyphs drawn by the score library, so a flat in an option is
// the same shape as a flat on the score.
Choice.glyphs = function () {
  if (Choice._glyphs) return Choice._glyphs;
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:900px;visibility:hidden';
  document.body.appendChild(box);
  ABCJS.renderAbc(box, 'X:1\nL:1/4\nK:C clef=none stafflines=1\nV:1 stem=up\n^B _B =B|', { add_classes: true, staffwidth: 800 });
  var lb = box.querySelector('.abcjs-top-line').getBBox();
  var out = { lineY: lb.y + lb.height / 2 }, kinds = [1, -1, 0];
  box.querySelectorAll('.abcjs-note').forEach(function (g, i) {
    var p = [].filter.call(g.querySelectorAll('path'), function (q) { return !q.getAttribute('class'); })[0];
    if (!p) return;
    var bb = p.getBBox();
    out[kinds[i]] = { d: p.getAttribute('d'), x: bb.x, w: bb.width };
  });
  box.remove();
  Choice._glyphs = out;
  return out;
};

// Text as HTML in the serif, every ♯ ♭ ♮ swapped for the library glyph,
// sized in em so it follows the text around it.
Choice.inline = function (text) {
  var G = Choice.glyphs(), s = 0.034, band = 14;
  return String(text).split(/([♯♭♮])/).map(function (part) {
    var acc = part === '♯' ? 1 : part === '♭' ? -1 : part === '♮' ? 0 : null;
    if (acc === null) return Choice.esc(part);
    var g = G[acc]; if (!g) return part;
    return '<svg class="tl-ch-acc" viewBox="' + (g.x - .5) + ' ' + (G.lineY - band) + ' ' + (g.w + 1) + ' ' + band * 2 + '" style="width:' + ((g.w + 1) * s).toFixed(3) + 'em;height:' + (band * 2 * s).toFixed(3) + 'em;vertical-align:' + (0.33 - band * s).toFixed(3) + 'em;margin:0 1px" aria-hidden="true"><path d="' + g.d + '"/></svg>';
  }).join('');
};

// A part's ABC as a whole tune: header lines from the part with
// defaults, K: last, then the music.
Choice.tune = function (abc) {
  var head = [], body = [], key = 'K:C';
  String(abc).split('\n').forEach(function (line) {
    if (/^K:/.test(line)) key = line;
    else if (/^[A-Za-z]:/.test(line)) head.push(line);
    else body.push(line);
  });
  if (!head.some(function (l) { return /^L:/.test(l); })) head.push('L:1/4');
  return 'X:1\n' + head.join('\n') + '\n' + key + '\n' + body.join('\n');
};

// Parts of the stem as HTML: text and terms in the serif.
Choice.partsHtml = function (parts) {
  return [].concat(parts || []).map(function (p) {
    return p.term ? '<span class="tl-ch-term">' + Choice.inline(p.term) + '</span>' : Choice.inline(p.text || '');
  }).join('');
};

// An option (or the stem) in words, for screen readers and for events.
Choice.words = function (opt) {
  if (opt.name) return opt.name;
  return (opt.parts || []).map(function (p) { return p.abc ? '♪' : p.text || p.term || ''; }).join(opt.joined ? '' : ' ');
};

Choice.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };
Choice.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
Choice.prototype.isList = function () { return this.o.shape === 'list'; };
Choice.prototype.ids = function () { return this.o.options.map(function (op) { return op.id; }); };
// Marks are kept per key: an option's id, or a box's index.
Choice.prototype.keyFor = function (k) { return this.isList() ? String(k) : Number(k); };
Choice.prototype.known = function (list) {
  var self = this, ids = this.isList() ? this.ids() : this.values.map(function (v, i) { return i; });
  return [].concat(list === undefined || list === null ? [] : list).map(function (k) { return self.keyFor(k); }).filter(function (k) { return ids.indexOf(k) >= 0; });
};
Choice.prototype.targets = function () { return this.isList() ? this.tiles : this.marks; };
Choice.prototype.keyOf = function (el) { return this.isList() ? el.dataset.id : Number(el.dataset.index); };
Choice.prototype.elOf = function (key) {
  var list = this.targets();
  for (var i = 0; i < list.length; i++) if (this.keyOf(list[i]) === key) return list[i];
  return null;
};
Choice.prototype.option = function (id) {
  for (var i = 0; i < this.o.options.length; i++) if (this.o.options[i].id === id) return this.o.options[i];
  return { parts: [] };
};

Choice.prototype.note = function (midi, delay, dur, velocity) {
  var v = this.o.sound.play(midi, delay, dur, velocity);
  if (v) this.voices.push(v);
};
Choice.prototype.silence = function () {
  (this.voices || []).forEach(function (v) { v.stop(); });
  this.voices = [];
};

// Holds every glide and entrance while a state is drawn directly, takes
// the entrances off what is already drawn, and lets motion back in two
// frames later, when the drawing has settled.
Choice.prototype.hold = function () {
  var self = this;
  this.host.classList.add('tl-ch-still');
  this.host.querySelectorAll('.' + Choice.ENTRANCES.join(', .')).forEach(function (e) { Choice.ENTRANCES.forEach(function (c) { e.classList.remove(c); }); });
  cancelAnimationFrame(this.release);
  this.release = requestAnimationFrame(function () { self.release = requestAnimationFrame(function () { self.host.classList.remove('tl-ch-still'); }); });
};

// Redraws everything inside the host, e.g. after a change of width or
// mode; the selection, every mark and the view are state, so they come
// back.
Choice.prototype.build = function () {
  var self = this;
  this.stop();
  this.host.innerHTML = '';
  this.hold();
  this.inked = {}; this.sealed = {}; this.badged = {}; this.staffs = {};
  this.row = false; this.host.classList.remove('tl-ch-row');
  if (this.o.prompt) {
    var stem = document.createElement('div'); stem.className = 'tl-ch-stem';
    stem.innerHTML = (this.o.tag ? '<span class="tl-ch-tag">' + Choice.esc(this.o.tag) + '</span>' : '') + '<span class="tl-ch-ask">' + Choice.partsHtml(this.o.prompt) + '</span>';
    this.host.appendChild(stem);
  }
  var ask = this.o.prompt ? Choice.words({ parts: [].concat(this.o.prompt), joined: true }) : '';
  if (this.isList()) {
    this.win = document.createElement('div'); this.win.className = 'tl-ch-window';
    this.grid = document.createElement('div'); this.grid.className = 'tl-ch-opts';
    this.grid.setAttribute('role', this.o.pick > 1 ? 'group' : 'radiogroup');
    if (ask) this.grid.setAttribute('aria-label', ask);
    this.win.appendChild(this.grid);
    this.host.appendChild(this.win);
    this.tiles = this.o.options.map(function (op) { var t = self.tile(op); self.grid.appendChild(t); return t; });
    this.evenStaves();
    this.layout();
  } else {
    this.strip = document.createElement('div'); this.strip.className = 'tl-ch-strip'; this.strip.setAttribute('role', 'group');
    if (ask) this.strip.setAttribute('aria-label', ask);
    this.host.appendChild(this.strip);
    this.marks = this.values.map(function (v, i) {
      var m = document.createElement('div'); m.className = 'tl-ch-mark'; m.dataset.index = String(i); m.setAttribute('role', 'button');
      m.innerHTML = '<span class="tl-ch-box" aria-hidden="true"><svg viewBox="0 0 36 36"></svg></span>';
      self.strip.appendChild(m);
      return m;
    });
    this.placeMarks();
  }
  this.targets().forEach(function (el, i) { el.tabIndex = i ? -1 : 0; });
  this.over = document.createElement('div'); this.over.className = 'tl-ch-over';
  this.host.appendChild(this.over);
  this.room = null;
  this.apply(false);
  this.placeCaption(false);
  this.relayout();
};

// One option as a paper tile: its tick box, then its parts.
Choice.prototype.tile = function (op) {
  var self = this, el = document.createElement('div');
  el.className = 'tl-ch-opt';
  el.dataset.id = op.id;
  el.setAttribute('role', this.o.pick > 1 ? 'checkbox' : 'radio');
  el.innerHTML = '<span class="tl-ch-box" aria-hidden="true"><svg viewBox="0 0 36 36"></svg></span><div class="tl-ch-body"></div>';
  var body = el.querySelector('.tl-ch-body');
  this.staffs[op.id] = [];
  (op.parts || []).forEach(function (p) {
    if (p.abc) { self.drawStaff(op.id, p.abc, body); return; }
    var s = document.createElement('span');
    s.className = p.term ? 'tl-ch-term' : 'tl-ch-text';
    s.innerHTML = Choice.inline(p.term || p.text || '');
    body.appendChild(s);
  });
  var strike = document.createElement('span'); strike.className = 'tl-ch-strike'; strike.setAttribute('aria-hidden', 'true');
  body.appendChild(strike);
  return el;
};

// Staves in one choice are drawn at one scale and one length, so the
// options can be compared side by side; a choice with staves stands its
// options up, stave on top and box under it.
Choice.prototype.evenStaves = function () {
  var self = this, all = [];
  Object.keys(this.staffs).forEach(function (id) { all = all.concat(self.staffs[id]); });
  this.host.classList.toggle('tl-ch-tall', all.length > 0);
  if (!all.length) return;
  var w = Math.max.apply(null, all.map(function (st) { return st.w; }));
  all.forEach(function (st) {
    st.svg.setAttribute('viewBox', '0 ' + st.y0 + ' ' + w + ' ' + st.h);
    st.svg.style.width = (w * Choice.STAFF_SCALE).toFixed(1) + 'px';
  });
};

// How many options go in a row: all of them when each fits at its own
// natural width (up to MAX_ROW), else two, else one. Every tile in a
// choice is the same width and the same height, whichever row it is in.
Choice.prototype.layout = function () {
  var self = this, n = this.tiles.length, W = this.grid.clientWidth, G = Choice.GAP;
  var natural = 0;
  this.tiles.forEach(function (t) {
    var copy = t.cloneNode(true); copy.classList.add('tl-ch-probe');
    self.grid.appendChild(copy);
    natural = Math.max(natural, Math.ceil(copy.getBoundingClientRect().width));
    copy.remove();
  });
  this.natural = natural;
  var tries = (n <= Choice.MAX_ROW ? [n] : []).concat([2, 1]).filter(function (c) { return c <= n; });
  var cols = 1;
  for (var i = 0; i < tries.length; i++) { if (tries[i] * natural + (tries[i] - 1) * G <= W) { cols = tries[i]; break; } }
  this.cols = cols;
  this.grid.style.setProperty('--cols', String(cols));
  this.evenHeights();
};
Choice.prototype.evenHeights = function () {
  this.tiles.forEach(function (t) { t.style.minHeight = ''; });
  var tall = Math.max.apply(null, this.tiles.map(function (t) { return t.offsetHeight; }).concat([0]));
  this.tiles.forEach(function (t) { t.style.minHeight = tall + 'px'; });
};

// The room the choice is given: the grid when it fits the view (or
// there is no view), else one sliding row.
Choice.prototype.fitView = function (view) {
  this.view = view && view.width && view.height ? { width: view.width, height: view.height } : null;
  this.relayout();
};
Choice.prototype.relayout = function () {
  if (!this.isList()) return;
  this.setRow(false);
  if (!this.view || this.host.offsetHeight <= this.view.height + 1) return;
  this.setRow(true);
};
Choice.prototype.setRow = function (on) {
  if (on === this.row) return;
  this.row = on;
  this.host.classList.toggle('tl-ch-row', on);
  if (on) {
    var tw = Math.max(Choice.ROW_MIN_PX, Math.min(this.natural, Math.floor(this.win.clientWidth * Choice.ROW_SHARE)));
    this.grid.style.setProperty('--tw', tw + 'px');
    this.cols = this.tiles.length;
    this.evenHeights();
  } else {
    this.grid.style.removeProperty('--tw');
    this.grid.style.transform = '';
    this.shift = 0;
    this.layout();
  }
  this.placeCaption(false);
  this.centre();
};

// Which option stands in the middle of the row: the one the child last
// brought there, else the one in question (its caption is under the
// middle).
Choice.prototype.centreIndex = function () {
  if (this.at !== null && this.at < this.tiles.length) return this.at;
  var keys = (this.cap ? [this.cap.key] : []).concat(this.spot || [], this.held, this.selected), ids = this.ids();
  for (var i = 0; i < keys.length; i++) { var k = ids.indexOf(keys[i]); if (k >= 0) return k; }
  return 0;
};
// Slides the row so that option stands in the middle of the window.
Choice.prototype.centre = function () {
  if (!this.isList()) return;
  if (!this.row) { this.grid.style.transform = ''; this.shift = 0; return; }
  var t = this.tiles[this.centreIndex()]; if (!t) return;
  this.shift = this.win.clientWidth / 2 - (t.offsetLeft + t.offsetWidth / 2);
  this.grid.style.transform = 'translateX(' + this.shift.toFixed(1) + 'px)';
};

// Boxes under a score stand where the workflow says (centres in pixels
// from the choice's left edge); without places they spread evenly.
Choice.prototype.placeMarks = function () {
  var W = this.strip.clientWidth, n = this.marks.length, xs = this.xs;
  this.marks.forEach(function (m, i) {
    var x = xs && xs[i] !== undefined ? xs[i] : W * (i + .5) / n;
    m.style.left = Math.max(22, Math.min(W - 22, x)).toFixed(1) + 'px';
  });
};

// Draws a part's ABC on a short stave cropped to what is drawn (clef, key
// signature, notes; not the bare stave lines). Keeps the notes for
// playback.
Choice.prototype.drawStaff = function (id, abc, body) {
  var holder = document.createElement('span'); holder.className = 'tl-ch-staff';
  body.appendChild(holder);
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:700px;visibility:hidden';
  document.body.appendChild(box);
  var vis = ABCJS.renderAbc(box, Choice.tune(abc), { add_classes: true, staffwidth: 560, paddingleft: 0, paddingright: 0, paddingtop: 0, paddingbottom: 0 })[0];
  var svg = box.querySelector('svg');
  var all = svg.getBBox(), right = 0;
  svg.querySelectorAll('path, text').forEach(function (p) {
    var c = ' ' + (p.getAttribute('class') || '') + ' ' + ((p.parentNode && p.parentNode.getAttribute && p.parentNode.getAttribute('class')) || '') + ' ';
    if (/ abcjs-staff | abcjs-top-line /.test(c)) return;
    var b = p.getBBox(); if (b.width || b.height) right = Math.max(right, b.x + b.width);
  });
  var w = Math.ceil(right + 14), y0 = Math.floor(all.y - 4), h = Math.ceil(all.height + 8);
  svg.setAttribute('viewBox', '0 ' + y0 + ' ' + w + ' ' + h);
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.removeAttribute('style'); svg.setAttribute('aria-hidden', 'true');
  holder.appendChild(svg);
  box.remove();
  this.staffs[id].push({ svg: svg, w: w, y0: y0, h: h, notes: this.collect(vis) });
};

// The notes of a snippet in order with their onsets in whole notes and
// pitches (key signature and accidentals within the bar applied), and
// the drawn shapes to light while they sound.
Choice.prototype.collect = function (vis) {
  var C = Choice, out = [], t = 0, bar = {};
  var keyOf = function (k) { var m = {}; ((k && k.accidentals) || []).forEach(function (a) { m[a.note.toUpperCase()] = a.acc; }); return m; };
  var key = {}; try { key = keyOf(vis.getKeySignature()); } catch (e) { key = {}; }
  var info = function (p, within) {
    var letter = C.LETTERS[((p.pitch % 7) + 7) % 7], slot = letter + p.pitch;
    if (within && p.accidental) within[slot] = p.accidental;
    var acc = p.accidental || (within && within[slot]) || key[letter] || null;
    return 60 + 12 * Math.floor(p.pitch / 7) + C.STEP[letter] + (acc ? C.SHIFT[acc] : 0);
  };
  (vis.lines || []).forEach(function (line) {
    var staff = (line.staff || [])[0]; if (!staff) return;
    ((staff.voices || [])[0] || []).forEach(function (el) {
      if (el.el_type === 'bar') { bar = {}; return; }
      if (el.el_type !== 'note') return;
      var d = el.duration || 0;
      if (el.rest || !el.pitches) { t += d; return; }
      var shapes = ((el.abselem && el.abselem.elemset) || []).filter(function (x) { return x && x.getBBox; });
      out.push({ t: t, d: d, shapes: shapes, midis: el.pitches.map(function (p) { return info(p, bar); }) });
      t += d;
    });
  });
  return out;
};

// Applies the state to what is drawn. Ink already on the paper stays;
// only a mark that changed is drawn (or fades) now, and only when
// animated. In one row, the option in question slides to the middle.
Choice.prototype.apply = function (animated) {
  var self = this, move = animated && !Choice.still();
  this.host.classList.toggle('tl-ch-locked', this.locked);
  this.targets().forEach(function (el) {
    var key = self.keyOf(el);
    var ink = self.isList() ? (self.selected.indexOf(key) >= 0 ? 'tick' : null) : self.values[key];
    if (self.inked[key] !== ink) { self.ink(el, ink, move); self.inked[key] = ink; }
    var v = self.verdict[key], seal = v === true ? 'yes' : v === false ? 'no' : null;
    if (self.sealed[key] !== seal) { self.seal(el, seal, move); self.sealed[key] = seal; }
    var badge = self.labels[key] || null;
    if (self.badged[key] !== badge) { self.badge(el, badge, move); self.badged[key] = badge; }
    el.classList.toggle('tl-ch-on', !!ink);
    el.classList.toggle('tl-ch-out', !!self.struck[key]);
    el.classList.toggle('tl-ch-right', v === true);
    el.classList.toggle('tl-ch-wrong', v === false);
    el.classList.toggle('tl-lit', self.held.indexOf(key) >= 0);
    el.classList.toggle('tl-dim', !!self.spot && self.spot.indexOf(key) < 0);
    var said = v === true ? ', right' : v === false ? ', wrong' : '';
    if (self.isList()) {
      el.setAttribute('aria-checked', String(!!ink));
      el.setAttribute('aria-label', (badge ? badge + ': ' : '') + Choice.words(self.option(key)) + (self.struck[key] ? ', ruled out' : '') + said);
    } else {
      el.setAttribute('aria-label', 'Box ' + (key + 1) + ': ' + (ink ? Choice.WORDS[ink] : 'empty') + said);
    }
    el.setAttribute('aria-disabled', String(self.locked || !!self.struck[key]));
  });
  this.centre();
};

// The child's tick or cross in a box, drawn stroke by stroke like a pen;
// a mark taken away fades.
Choice.prototype.ink = function (el, ink, move) {
  var box = el.querySelector('.tl-ch-box');
  box.querySelectorAll('svg').forEach(function (old) {
    if (move && old.childNodes.length) { old.classList.add('tl-ch-erase'); setTimeout(function () { old.remove(); }, 200); }
    else old.remove();
  });
  if (!ink) return;
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.innerHTML = Choice[ink === 'tick' ? 'TICK_INK' : 'CROSS_INK'].map(function (d) { return '<path' + (move ? ' class="tl-ch-draw"' : '') + ' pathLength="1" d="' + d + '"/>'; }).join('');
  box.appendChild(svg);
};

Choice.prototype.seal = function (el, seal, move) {
  var old = el.querySelector(':scope > .tl-ch-seal'); if (old) old.remove();
  if (!seal) return;
  var s = document.createElement('span');
  s.className = 'tl-ch-seal tl-ch-' + seal + (move ? ' tl-ch-pop' : '');
  s.innerHTML = seal === 'yes' ? Choice.SEAL_YES : Choice.SEAL_NO;
  el.appendChild(s);
};

Choice.prototype.badge = function (el, text, move) {
  var old = el.querySelector(':scope > .tl-ch-badge'); if (old) old.remove();
  if (!text) return;
  var b = document.createElement('span');
  b.className = 'tl-ch-badge' + (move ? ' tl-ch-pop' : '');
  b.setAttribute('aria-hidden', 'true');
  b.textContent = text;
  el.appendChild(b);
};

// A press: in one row it waits to see whether the finger drags the row
// or taps; otherwise it is a tap at once.
Choice.prototype.onPointer = function (ev) {
  this.host.classList.remove('kbd');
  if (this.row && (ev.button === undefined || ev.button <= 0)) {
    var r = this.host.getBoundingClientRect();
    this.press = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, base: this.shift, k: (r.width / (this.host.offsetWidth || 1)) || 1, moved: false };
    return;
  }
  this.hit(ev);
};
Choice.prototype.onMove = function (ev) {
  var p = this.press; if (!p) return;
  var dx = ev.clientX - p.x, dy = ev.clientY - p.y;
  if (!p.moved) {
    if (Math.abs(dx) < Choice.DRAG_PX || Math.abs(dx) < Math.abs(dy)) return;
    p.moved = true;
    this.grid.classList.add('tl-ch-drag');
    try { this.host.setPointerCapture(p.id); } catch (e) { /* the pointer is already gone */ }
  }
  ev.preventDefault();
  this.shift = p.base + dx / p.k;
  this.grid.style.transform = 'translateX(' + this.shift.toFixed(1) + 'px)';
};
// A drag ends with the option nearest the middle brought there; a press
// that did not move is a tap.
Choice.prototype.onUp = function (ev) {
  var p = this.press; this.press = null;
  if (!p) return;
  if (!p.moved) { this.hit(ev); return; }
  this.grid.classList.remove('tl-ch-drag');
  var mid = this.win.clientWidth / 2, self = this, best = 0, dist = Infinity;
  this.tiles.forEach(function (t, i) { var d = Math.abs(t.offsetLeft + t.offsetWidth / 2 + self.shift - mid); if (d < dist) { dist = d; best = i; } });
  this.at = best;
  this.centre();
};
Choice.prototype.onCancel = function () {
  if (!this.press) return;
  this.press = null;
  this.grid.classList.remove('tl-ch-drag');
  this.centre();
};

// Taps: the target under the finger, or the nearest within a few pixels
// (the gaps between tiles, the space around a small box); further away,
// a tap on the blank (the stem, the margins). In one row only what the
// window shows can be tapped, and the option tapped comes to the middle.
Choice.prototype.hit = function (ev) {
  var x = ev.clientX, y = ev.clientY, best = null, dist = Infinity, reach;
  if (this.isList()) {
    reach = Choice.REACH_PX;
    var w = this.row ? this.win.getBoundingClientRect() : null;
    if (!w || (x >= w.left && x <= w.right)) {
      this.tiles.forEach(function (t) {
        var b = t.getBoundingClientRect();
        var dx = Math.max(b.left - x, 0, x - b.right), dy = Math.max(b.top - y, 0, y - b.bottom), d = Math.hypot(dx, dy);
        if (d < dist) { dist = d; best = t; }
      });
    }
  } else {
    reach = Choice.MARK_REACH_PX;
    var sb = this.strip.getBoundingClientRect();
    if (y >= sb.top - 6 && y <= sb.bottom + 6) {
      this.marks.forEach(function (m) {
        var b = m.getBoundingClientRect(), d = Math.abs(x - (b.left + b.width / 2));
        if (d < dist) { dist = d; best = m; }
      });
    }
  }
  if (!best || dist > reach) { this.emit('blankTap', {}); return; }
  if (ev.cancelable) ev.preventDefault();
  if (this.row) this.at = this.tiles.indexOf(best);
  this.tap(this.keyOf(best), ev);
  if (this.row) this.centre();
};

Choice.prototype.onKey = function (ev) {
  var cur = ev.target.closest('.tl-ch-opt, .tl-ch-mark'); if (!cur) return;
  var list = this.targets(), i = list.indexOf(cur), step = this.isList() ? this.cols : 1, next = null;
  if (ev.key === 'ArrowRight') next = list[Math.min(list.length - 1, i + 1)];
  else if (ev.key === 'ArrowLeft') next = list[Math.max(0, i - 1)];
  else if (ev.key === 'ArrowDown') next = list[Math.min(list.length - 1, i + step)];
  else if (ev.key === 'ArrowUp') next = list[Math.max(0, i - step)];
  else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.tap(this.keyOf(cur), null); return; }
  else if (ev.key === 'Escape') { this.emit('blankTap', {}); return; }
  if (!next || next === cur) return;
  ev.preventDefault();
  cur.tabIndex = -1; next.tabIndex = 0; next.focus({ preventScroll: true });
  if (this.row) { this.at = list.indexOf(next); this.centre(); }
};

// A tap on an option ticks it (one pick: the tick moves here; several:
// the oldest gives way once the limit is reached) or takes its tick
// away; a tap on a box steps it through tick, cross and empty. Locked or
// ruled out, nothing changes.
Choice.prototype.tap = function (key, ev) {
  var el = this.elOf(key); if (!el) return;
  if (this.locked) return;
  el.classList.add('tl-ch-down'); setTimeout(function () { el.classList.remove('tl-ch-down'); }, 180);
  if (ev) this.ripple(ev);
  if (!this.isList()) {
    var now = this.values[key], value = now === null ? 'tick' : now === 'tick' ? 'cross' : null;
    this.values[key] = value;
    this.apply(true);
    this.emit('boxTap', { index: key, value: value, values: this.values.slice() });
    return;
  }
  var index = this.ids().indexOf(key);
  if (this.struck[key]) { this.emit('optionTap', { id: key, index: index, on: false, selected: this.selected.slice(), struck: true }); return; }
  var at = this.selected.indexOf(key), on = at < 0;
  if (!on) this.selected.splice(at, 1);
  else if (this.o.pick <= 1) this.selected = [key];
  else { this.selected.push(key); while (this.selected.length > this.o.pick) this.selected.shift(); }
  this.apply(true);
  if (on && this.audible() && this.staffs[key].length) { this.stop(); this.sound(key); }
  this.emit('optionTap', { id: key, index: index, on: on, selected: this.selected.slice(), struck: false });
};

Choice.prototype.ripple = function (ev) {
  var rect = this.host.getBoundingClientRect(), r = document.createElement('div'); r.className = 'tl-ch-ripple';
  r.style.left = ev.clientX - rect.left + 'px'; r.style.top = ev.clientY - rect.top + 'px';
  this.over.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

// Sounds an option's snippets in order at the choice's tempo, lighting
// each note as it plays.
Choice.prototype.sound = function (id) {
  var self = this, q = 60 / this.o.tempo, at = 0, timers = this.timers;
  var light = function (els, on) { els.forEach(function (e) { e.classList.toggle('tl-ch-sounding', on); }); };
  (this.staffs[id] || []).forEach(function (st) {
    var end = 0;
    st.notes.forEach(function (n) {
      var s = at + n.t * 4 * q, d = Math.max(.08, n.d * 4 * q);
      n.midis.forEach(function (m) { self.note(m, s, d, .6); });
      timers.push(setTimeout(function () { light(n.shapes, true); }, s * 1000));
      timers.push(setTimeout(function () { light(n.shapes, false); }, (s + d) * 1000 - 20));
      end = Math.max(end, n.t * 4 * q + d);
    });
    at += end + .35;
  });
};

// The caption in state, as a dark bubble under its option (or box). The
// choice first opens room under that row (in one row, under the window,
// with the captioned option in the middle), so what is under it moves
// down and nothing is covered; then the bubble pops up in the room.
// Taken away, the bubble fades first and then the room closes.
Choice.prototype.placeCaption = function (animated) {
  var move = animated && !Choice.still(), C = Choice;
  var c = this.cap, el = c && this.elOf(c.key);
  var old = this.room; this.room = null;
  if (old) {
    if (move) {
      var bub = old.querySelector('.tl-ch-bubble'); if (bub) bub.style.opacity = '0';
      old.animate([{ height: old.offsetHeight + 'px' }, { height: '0px' }], { duration: C.MOVE_MS, delay: C.BUBBLE_FADE_MS, easing: C.EASE, fill: 'forwards' }).onfinish = function () { old.remove(); };
    } else old.remove();
  }
  if (!el) return;
  var room = document.createElement('div'); room.className = 'tl-ch-room';
  var b = document.createElement('div'); b.className = 'tl-ch-bubble'; b.innerHTML = c.html;
  room.appendChild(b);
  if (this.isList() && this.row) this.host.insertBefore(room, this.win.nextSibling);
  else if (this.isList()) {
    var i = this.tiles.indexOf(el), last = Math.min(this.tiles.length - 1, Math.floor(i / this.cols) * this.cols + this.cols - 1);
    this.grid.insertBefore(room, this.tiles[last].nextSibling);
  } else this.host.insertBefore(room, this.strip.nextSibling);
  var h = b.offsetHeight + 10, W = room.clientWidth, bw = b.offsetWidth;
  var rr = room.getBoundingClientRect(), er = el.getBoundingClientRect();
  var wide = this.isList() && !this.host.classList.contains('tl-ch-tall');
  var vx = this.row ? W / 2 : er.left - rr.left + (wide ? Math.min(er.width, 220) / 2 : er.width / 2);
  var left = Math.max(4, Math.min(W - 4 - bw, vx - bw / 2));
  b.style.left = left + 'px';
  b.style.setProperty('--ax', Math.max(12, Math.min(bw - 12, vx - left)) + 'px');
  room.style.height = h + 'px';
  this.room = room;
  if (move) {
    room.animate([{ height: '0px' }, { height: h + 'px' }], { duration: C.MOVE_MS, easing: C.EASE });
    b.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 350, delay: C.MOVE_MS * .55, easing: 'cubic-bezier(.2, 1.4, .4, 1)', fill: 'backwards' });
  }
};

// ---------- Commands ----------
// Ticks these options for the child (a demonstration in a lecture, or
// the answer given back when a question is opened again); for a row of
// boxes, the value of every box ('tick', 'cross' or null).
Choice.prototype.select = function (list) {
  if (this.isList()) {
    var self = this;
    this.selected = this.known(list).filter(function (k) { return !self.struck[k]; }).slice(-Math.max(1, this.o.pick));
  } else {
    var given = [].concat(list || []);
    this.values = this.values.map(function (v, i) { return given[i] === 'tick' || given[i] === 'cross' ? given[i] : null; });
  }
  this.apply(true);
};
// Rules options out with a red line; their ticks go.
Choice.prototype.strike = function (list) {
  var self = this;
  this.known(list).forEach(function (k) { self.struck[k] = true; var i = self.selected.indexOf(k); if (i >= 0) self.selected.splice(i, 1); });
  this.apply(true);
};
Choice.prototype.highlight = function (list) { this.held = this.known(list); this.at = null; this.apply(true); };
Choice.prototype.spotlight = function (list) { var f = this.known(list); this.spot = f.length ? f : null; this.at = null; this.apply(true); };
Choice.prototype.label = function (map) {
  var self = this; this.labels = {};
  Object.keys(map || {}).forEach(function (k) { var key = self.keyFor(k); if (self.known([key]).length) self.labels[key] = String(map[k]); });
  this.apply(true);
};
// Right or wrong, as the workflow judged it from the question file: a map
// from option id (or box index) to true or false; null takes a verdict away.
Choice.prototype.check = function (map) {
  var self = this;
  Object.keys(map || {}).forEach(function (k) {
    var key = self.keyFor(k);
    if (!self.known([key]).length) return;
    if (map[k] === true || map[k] === false) self.verdict[key] = map[k]; else delete self.verdict[key];
  });
  this.apply(true);
};
Choice.prototype.lock = function (on) { this.locked = on !== false; this.apply(true); };
Choice.prototype.place = function (xs) { this.xs = xs ? xs.slice() : null; if (!this.isList()) { this.placeMarks(); this.placeCaption(false); } };
// Shows a caption under an option or box; with no option, takes it away.
// In one row the captioned option comes to the middle, over its bubble.
Choice.prototype.caption = function (key, html) {
  var k = key === null || key === undefined ? [] : this.known([key]);
  this.cap = k.length ? { key: k[0], html: html } : null;
  if (this.row) this.at = null;
  this.placeCaption(true);
  this.centre();
};
Choice.prototype.play = function (id) { if (!this.audible() || !this.staffs[id] || !this.staffs[id].length) return; this.stop(); this.sound(id); };

// Shows exactly this state with nothing moving, the way the choice stood
// at the end of an act; used when the player steps back or forward or a
// question is opened again. Anything left out is cleared.
Choice.prototype.set = function (s) {
  var self = this; s = s || {};
  this.stop();
  if (this.isList()) this.selected = this.known(s.selected).slice(-Math.max(1, this.o.pick));
  else this.values = this.values.map(function (v, i) { var x = (s.values || [])[i]; return x === 'tick' || x === 'cross' ? x : null; });
  this.struck = {}; this.known(s.struck).forEach(function (k) { self.struck[k] = true; });
  this.selected = this.selected.filter(function (k) { return !self.struck[k]; });
  this.verdict = {}; Object.keys(s.checks || {}).forEach(function (k) { var key = self.keyFor(k); if (self.known([key]).length && (s.checks[k] === true || s.checks[k] === false)) self.verdict[key] = s.checks[k]; });
  this.labels = {}; Object.keys(s.labels || {}).forEach(function (k) { var key = self.keyFor(k); if (self.known([key]).length) self.labels[key] = String(s.labels[k]); });
  this.held = this.known(s.highlight);
  var sp = this.known(s.spotlight); this.spot = sp.length ? sp : null;
  this.locked = !!s.locked;
  this.at = null;
  var ck = s.caption ? this.known([s.caption.key]) : [];
  this.cap = ck.length ? { key: ck[0], html: s.caption.html } : null;
  this.hold();
  this.apply(false);
  this.placeCaption(false);
};

// Stops an option's sound: timers are cleared and every note still
// queued or sounding is silenced.
Choice.prototype.stop = function () {
  (this.timers || []).forEach(clearTimeout); this.timers = [];
  this.silence();
  if (this.host) this.host.querySelectorAll('.tl-ch-sounding').forEach(function (e) { e.classList.remove('tl-ch-sounding'); });
};

Choice.prototype.clear = function () { this.set({}); };
