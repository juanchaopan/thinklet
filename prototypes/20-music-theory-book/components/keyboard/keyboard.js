/* ============================================================
   Keyboard component. Inputs: from, to (MIDI), mode ('lecture' |
   'practice'), names ('none' | 'C' | 'all'), tune (what the play
   button plays), compact, caption. Commands: highlight, label,
   steps, count, spotlight, spelling, caption, play, stop, clear.
   Events (via onEvent): keyTap, blankTap, countStep, playStart,
   playEnd. Sound goes through the injected source, lectures only.
   Its look is keyboard.css; colours come from the theme constants
   (--th-<name>) set on the page or stage around the keyboard.

   When it does not fit: fit(view) gives the most room it may take,
   {width, height} in its own pixels (null: its own size again). Within
   a view the keyboard stays one row and its keys keep a width a finger
   can hit; a row longer than the view slides sideways. It comes to rest
   with an octave's C at its left edge where it can, and it moves by
   itself so the keys in play (held, counted, played, spotlit, captioned)
   are in view. A drag slides it, settling on the nearest octave; an
   edge with more keys beyond it fades. Without a view, a narrow keyboard
   breaks into rows at C instead.
   ============================================================ */
function Keyboard(host, options) {
  this.host = host;
  this.o = Object.assign({ from: 60, to: 83, mode: 'lecture', names: 'C', tune: null, compact: false, caption: '', sound: null, onEvent: function () {} }, options);
  this.held = {};
  this.spell = {};
  this.timers = [];
  this.tapTimers = [];
  this.voices = [];
  this.view = null;
  this.viewKey = '';
  this.interest = null;
  this.build();
}
Keyboard.WHITE = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };
Keyboard.BLACK = { 1: ['C♯', 'D♭'], 3: ['D♯', 'E♭'], 6: ['F♯', 'G♭'], 8: ['G♯', 'A♭'], 10: ['A♯', 'B♭'] };
// Black keys sit off-centre over the gap between two white keys, as on a real piano.
Keyboard.BLACK_SHIFT = { 1: -.07, 3: .07, 6: -.09, 8: 0, 10: .09 };
Keyboard.TAP_FADE_MS = 2000;
// The wooden case's padding on each side of the keys.
Keyboard.CASE_PAD = 12;

Keyboard.isWhite = function (m) { return Keyboard.WHITE[m % 12] !== undefined; };
Keyboard.octave = function (m) { return Math.floor(m / 12) - 1; };
Keyboard.spoken = function (n) { return n.replace('♯', ' sharp').replace('♭', ' flat').replace('𝄪', ' double sharp').replace('𝄫', ' double flat'); };

// A window onto a strip longer than it, moved along one axis with
// transforms: `parts` move together, `snap` picks where a drag comes to
// rest. An edge with more beyond it fades (--slide-a, --slide-b on the
// window). The owner passes its pointer events to grab, drag and drop,
// and treats a press that never dragged as a tap.
Keyboard.Slide = function (win, parts, axis, snap) {
  this.win = win; this.parts = parts; this.y = axis === 'y'; this.snap = snap || function (o) { return o; };
  this.on = false; this.at = 0; this.len = 0; this.press = null;
};
Keyboard.Slide.DRAG_PX = 8;
Keyboard.Slide.RUBBER = .35;
Keyboard.Slide.prototype.pos = function (e) { return this.y ? e.clientY : e.clientX; };
Keyboard.Slide.prototype.room = function () { return this.y ? this.win.clientHeight : this.win.clientWidth; };
Keyboard.Slide.prototype.max = function () { return Math.max(0, this.len - this.room()); };
Keyboard.Slide.prototype.clamp = function (o) { return Math.max(0, Math.min(this.max(), o)); };
Keyboard.Slide.prototype.set = function (on, len) { this.on = !!on; this.len = len || 0; this.place(this.on ? this.clamp(this.at) : 0, false); };
Keyboard.Slide.prototype.place = function (o, animated) {
  var still = !animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var t = o ? (this.y ? 'translateY(' : 'translateX(') + (-o).toFixed(1) + 'px)' : '';
  this.at = o;
  this.parts.forEach(function (p) { p.style.transition = still ? 'none' : ''; p.style.transform = t; });
  this.win.style.setProperty('--slide-a', this.on && o > 1 ? '1' : '0');
  this.win.style.setProperty('--slide-b', this.on && o < this.max() - 1 ? '1' : '0');
};
Keyboard.Slide.prototype.to = function (o, animated) { if (this.on) this.place(this.clamp(o), animated !== false); };
// Keeps a..b in view: centred when it fits, from a when it does not.
Keyboard.Slide.prototype.show = function (a, b, animated) {
  var room = this.room();
  this.to(b - a <= room ? (a + b) / 2 - room / 2 : a, animated);
};
Keyboard.Slide.prototype.grab = function (e) {
  if (!this.on || e.button > 0) return false;
  this.press = { p: this.pos(e), at: this.at, id: e.pointerId, moved: false };
  return true;
};
Keyboard.Slide.prototype.drag = function (e) {
  var p = this.press; if (!p) return false;
  var d = this.pos(e) - p.p;
  if (!p.moved && Math.abs(d) > Keyboard.Slide.DRAG_PX) {
    p.moved = true;
    try { this.win.setPointerCapture(p.id); } catch (err) { /* the pointer is already gone */ }
  }
  if (!p.moved) return false;
  e.preventDefault();
  var o = p.at - d, max = this.max();
  if (o < 0) o *= Keyboard.Slide.RUBBER; else if (o > max) o = max + (o - max) * Keyboard.Slide.RUBBER;
  this.place(o, false);
  return true;
};
Keyboard.Slide.prototype.drop = function () {
  var p = this.press; this.press = null;
  if (!p || !p.moved) return false;
  this.to(this.snap(this.clamp(this.at)), true);
  return true;
};

Keyboard.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };
Keyboard.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };

// Every note the keyboard sounds goes through here, so stop() can
// silence the notes already scheduled ahead on the audio clock.
Keyboard.prototype.note = function (midi, delay, dur, velocity) {
  var v = this.o.sound.play(midi, delay, dur, velocity);
  if (v) this.voices.push(v);
};
Keyboard.prototype.silence = function () {
  (this.voices || []).forEach(function (v) { v.stop(); });
  this.voices = [];
};

// Every way to write a key, the spelling the workflow chose first.
Keyboard.prototype.namesOf = function (m) {
  var pc = m % 12, o = Keyboard.octave(m);
  var all = Keyboard.isWhite(m) ? [Keyboard.WHITE[pc]] : Keyboard.BLACK[pc].slice();
  var chosen = this.spell[m] || this.spell[pc];
  if (chosen) { all = all.filter(function (n) { return n !== chosen; }); all.unshift(chosen); }
  return all.map(function (n) { return n + o; });
};

// Splits the white keys into rows. Within a view the keyboard keeps one
// row and slides. Otherwise a keyboard that fits keeps one row; one that
// does not breaks at C so every row is whole octaves where possible. Keys
// keep a size a finger can hit instead of shrinking; small keyboards
// shown side by side accept narrower keys.
Keyboard.prototype.layout = function (width) {
  var whites = []; for (var m = this.o.from; m <= this.o.to; m++) if (Keyboard.isWhite(m)) whites.push(m);
  var minW = this.o.compact ? 22 : 40, maxW = this.o.compact ? 44 : 62;
  var perRow = this.view ? whites.length : Math.max(1, Math.floor(width / minW));
  var rows = [];
  if (whites.length <= perRow) rows.push(whites);
  else {
    var groups = []; var g = [];
    whites.forEach(function (w) { if (w % 12 === 0 && g.length) { groups.push(g); g = []; } g.push(w); });
    if (g.length) groups.push(g);
    var cur = [];
    groups.forEach(function (grp) {
      if (cur.length + grp.length > perRow && cur.length) { rows.push(cur); cur = []; }
      while (grp.length > perRow) { rows.push(grp.slice(0, perRow)); grp = grp.slice(perRow); }
      cur = cur.concat(grp);
    });
    if (cur.length) rows.push(cur);
  }
  var longest = rows.reduce(function (a, r) { return Math.max(a, r.length); }, 1);
  var keyW = Math.max(this.view ? minW : 0, Math.min(maxW, Math.floor(width / longest)));
  var whiteH = Math.round(Math.max(this.o.compact ? 92 : 132, Math.min(this.o.compact ? 132 : 210, keyW * 3.6)));
  return { rows: rows, keyW: keyW, whiteH: whiteH };
};

Keyboard.prototype.build = function () {
  var self = this, pad = Keyboard.CASE_PAD;
  this.stop(); this.clearTap();
  this.host.classList.add('tl-kb');
  if (this.o.compact) this.host.classList.add('tl-compact');
  this.host.innerHTML = '';
  this.case = document.createElement('div'); this.case.className = 'tl-case';
  this.win = document.createElement('div'); this.win.className = 'tl-window';
  this.track = document.createElement('div'); this.track.className = 'tl-track';
  var rowsEl = document.createElement('div'); rowsEl.className = 'tl-rows';
  this.track.appendChild(rowsEl);
  this.win.appendChild(this.track);
  this.case.appendChild(this.win);
  this.host.appendChild(this.case);
  this.overlay = document.createElement('div'); this.overlay.className = 'tl-overlay';
  this.overlay.innerHTML = '<svg aria-hidden="true"></svg>';
  this.arcs = this.overlay.querySelector('svg');
  this.track.appendChild(this.overlay);
  if (this.o.caption) { var c = document.createElement('p'); c.className = 'tl-caption'; c.textContent = this.o.caption; this.host.appendChild(c); }
  if (this.view) {
    var cs = this.case.style;
    cs.boxSizing = 'border-box'; cs.maxWidth = Math.floor(this.view.width) + 'px'; cs.width = '100%'; cs.alignSelf = 'center';
  }

  var playable = this.o.tune && this.o.mode === 'lecture';
  var laneH = playable ? 58 : (this.o.compact ? 18 : 44);
  var outer = this.view ? Math.min(this.view.width, this.host.clientWidth || this.view.width) : (this.host.clientWidth || 300);
  var width = Math.max(120, outer - 2 * pad);
  var L = this.layout(width);
  this.keyW = L.keyW;
  this.keys = {};
  L.rows.forEach(function (row) {
    var r = document.createElement('div'); r.className = 'tl-row';
    var lane = document.createElement('div'); lane.className = 'tl-lane'; lane.style.height = laneH + 'px';
    var felt = document.createElement('div'); felt.className = 'tl-felt';
    var bed = document.createElement('div'); bed.className = 'tl-keys';
    bed.style.width = row.length * L.keyW + 'px'; bed.style.height = L.whiteH + 'px';
    r.appendChild(lane); r.appendChild(felt); r.appendChild(bed);
    rowsEl.appendChild(r);
    var lastWhite = row[row.length - 1];
    row.forEach(function (w, i) {
      self.addKey(bed, w, i * L.keyW, L.keyW - 1, L.whiteH, r);
      var b = w + 1;
      if (!Keyboard.isWhite(b) && b <= self.o.to && w !== lastWhite) {
        var bw = Math.round(L.keyW * .58);
        var x = (i + 1 + Keyboard.BLACK_SHIFT[b % 12]) * L.keyW - bw / 2;
        self.addKey(bed, b, x, bw, Math.round(L.whiteH * .62), r);
      }
    });
  });
  var rowW = L.rows.reduce(function (a, r) { return Math.max(a, r.length); }, 0) * L.keyW;
  var sliding = !!this.view && rowW > width + 1;
  this.case.classList.toggle('tl-sliding', sliding);
  this.track.style.width = sliding ? rowW + 'px' : '';
  this.win.style.width = sliding ? width + 'px' : '';
  this.slide = new Keyboard.Slide(this.win, [this.track], 'x', function (o) { return self.rest(o); });
  this.slide.set(sliding, rowW);
  if (playable) {
    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button'; this.playBtn.className = 'tl-play'; this.playBtn.setAttribute('aria-label', '播放');
    this.playBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg>';
    this.playBtn.addEventListener('click', function (ev) { ev.stopPropagation(); if (self.playing) self.stop(); else self.play(self.o.tune); });
    this.playBtn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    this.case.appendChild(this.playBtn);
  } else this.playBtn = null;
  var first = this.keys[this.o.from] || this.keys[Object.keys(this.keys)[0]];
  if (first) first.tabIndex = 0;
  // While the row slides, a press is a tap only if it never dragged.
  var pressed = null;
  this.case.addEventListener('pointerdown', function (ev) {
    self.host.classList.remove('kbd');
    if (self.slide.grab(ev)) { pressed = ev; return; }
    self.down(ev);
  });
  this.case.addEventListener('pointermove', function (ev) { if (self.slide.drag(ev)) pressed = null; });
  this.case.addEventListener('pointerup', function () { var p = pressed; pressed = null; if (!self.slide.drop() && p) self.down(p); });
  this.case.addEventListener('pointercancel', function () { pressed = null; self.slide.drop(); });
  this.case.addEventListener('keydown', function (ev) { self.onKey(ev); });
  this.case.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') self.host.classList.add('kbd'); });
  this.restore();
  if (this.interest) this.follow(this.interest, false);
};

// The most room the keyboard may take, or null for its own size; it is
// drawn again only when that changes.
Keyboard.prototype.fit = function (view) {
  var key = view ? Math.round(view.width) + 'x' + Math.round(view.height) : '';
  if (key === this.viewKey) return;
  this.viewKey = key;
  this.view = view ? { width: view.width, height: view.height } : null;
  this.build();
};

// A press on the case: a key, or the wood around the keys.
Keyboard.prototype.down = function (ev) {
  var key = ev.target.closest('.tl-key');
  if (!key) { this.blankTap(); return; }
  if (this.o.mode !== 'lecture') { ev.preventDefault(); return; }
  this.tap(Number(key.dataset.midi));
};

Keyboard.prototype.addKey = function (bed, m, x, w, h, row) {
  var k = document.createElement('button');
  k.type = 'button'; k.tabIndex = -1;
  k.className = 'tl-key ' + (Keyboard.isWhite(m) ? 'tl-white' : 'tl-black');
  k.dataset.midi = m; k.style.left = x + 'px'; k.style.width = w + 'px'; k.style.height = h + 'px';
  k.setAttribute('aria-label', this.namesOf(m).join(' 或 '));
  var show = this.o.names === 'all' || (this.o.names === 'C' && m % 12 === 0);
  if (show && Keyboard.isWhite(m)) {
    var t = document.createElement('span'); t.className = 'tl-letter';
    t.innerHTML = Keyboard.WHITE[m % 12] + (m % 12 === 0 ? '<sub>' + Keyboard.octave(m) + '</sub>' : '');
    k.appendChild(t);
  }
  k._row = row;
  bed.appendChild(k);
  this.keys[m] = k;
};

// Where a sliding row may rest: an octave's C at the left edge, or
// either end of the row.
Keyboard.prototype.stops = function () {
  var self = this, max = this.slide.max(), out = [0, max];
  Object.keys(this.keys).forEach(function (m) { var x = parseFloat(self.keys[m].style.left); if (Number(m) % 12 === 0 && x <= max) out.push(x); });
  return out.sort(function (a, b) { return a - b; });
};
Keyboard.prototype.rest = function (o) {
  return this.stops().reduce(function (best, s) { return Math.abs(s - o) < Math.abs(best - o) ? s : best; }, 0);
};
// Slides the row so these keys are in view, with the C at or below the
// lowest of them at the left edge when they all fit after it.
Keyboard.prototype.follow = function (ms, animated) {
  var self = this;
  ms = (ms || []).filter(function (m) { return self.keys[m]; });
  if (!ms.length) return;
  this.interest = ms;
  if (!this.slide.on) return;
  var lo = Infinity, hi = -Infinity;
  ms.forEach(function (m) { var k = self.keys[m], x = parseFloat(k.style.left); lo = Math.min(lo, x); hi = Math.max(hi, x + parseFloat(k.style.width)); });
  var room = this.slide.room(), best = null;
  this.stops().forEach(function (s) { if (s <= lo && s + room >= hi) best = s; });
  if (best !== null) this.slide.to(best, animated);
  else this.slide.show(lo, hi, animated);
};

// Marks the workflow asked for survive a rebuild (a resize re-lays the rows).
Keyboard.prototype.restore = function () {
  var self = this, keep = this.marks || [];
  this.marks = [];
  this.lit(Object.keys(this.held).map(Number));
  keep.forEach(function (mk) { self[mk[0]].apply(self, mk[1]); });
};
Keyboard.prototype.remember = function (name, args) { (this.marks = this.marks || []).push([name, args]); };

// Centre of a key and the lane above its row, in pixels inside the
// overlay, which moves with the keys.
Keyboard.prototype.where = function (m) {
  var k = this.keys[m]; if (!k) return null;
  var host = this.overlay.getBoundingClientRect(), kr = k.getBoundingClientRect();
  var lane = k._row.querySelector('.tl-lane').getBoundingClientRect();
  var row = k._row.getBoundingClientRect();
  return { x: kr.left + kr.width / 2 - host.left, keyTop: kr.top - host.top, keyBottom: kr.bottom - host.top, laneTop: lane.top - host.top, laneMid: lane.top + lane.height / 2 - host.top, laneBottom: lane.bottom - host.top, rowLeft: row.left - host.left, rowRight: row.right - host.left, row: k._row };
};

Keyboard.prototype.onKey = function (ev) {
  var cur = ev.target.closest('.tl-key'); if (!cur) return;
  var m = Number(cur.dataset.midi);
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
    ev.preventDefault();
    var next = m + (ev.key === 'ArrowRight' ? 1 : -1);
    if (!this.keys[next]) return;
    cur.tabIndex = -1; this.keys[next].tabIndex = 0; this.keys[next].focus({ preventScroll: true });
    this.follow([next]);
    if (this.o.mode === 'lecture') this.tap(next);
  } else if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault(); if (this.o.mode === 'lecture') this.tap(m);
  } else if (ev.key === 'Escape') this.blankTap();
};

// A tap presses the key, plays it, shows it lit and reports it; the light
// and any caption fade by themselves after a moment.
Keyboard.prototype.tap = function (m) {
  var self = this;
  this.clearTap();
  this.tapLit = m;
  this.press(m, 220);
  this.lit([m]);
  this.ripple(m);
  if (this.audible()) this.note(m, 0, 1.1);
  var names = this.namesOf(m);
  this.emit('keyTap', { midi: m, name: names[0], names: names, en: names.map(function (n) { return Keyboard.spoken(n.replace(/\d+$/, '')); }) });
  this.tapTimers.push(setTimeout(function () {
    self.overlay.querySelectorAll('.tl-bubble').forEach(function (b) { b.classList.add('out'); });
    if (!self.held[m]) self.unlit([m]);
  }, Keyboard.TAP_FADE_MS));
  this.tapTimers.push(setTimeout(function () { self.overlay.querySelectorAll('.tl-bubble.out').forEach(function (b) { b.remove(); }); }, Keyboard.TAP_FADE_MS + 600));
};

Keyboard.prototype.blankTap = function () { this.clearTap(); this.emit('blankTap', {}); };

Keyboard.prototype.clearTap = function () {
  (this.tapTimers || []).forEach(clearTimeout); this.tapTimers = [];
  if (this.tapLit !== undefined && this.tapLit !== null && !this.held[this.tapLit]) this.unlit([this.tapLit]);
  this.tapLit = null;
  if (this.overlay) this.overlay.querySelectorAll('.tl-bubble').forEach(function (b) { b.remove(); });
};

Keyboard.prototype.press = function (m, ms) {
  var k = this.keys[m]; if (!k) return;
  k.classList.add('tl-down');
  setTimeout(function () { k.classList.remove('tl-down'); }, ms);
};
Keyboard.prototype.lit = function (ms) { var self = this; ms.forEach(function (m) { if (self.keys[m]) self.keys[m].classList.add('tl-lit'); }); };
Keyboard.prototype.unlit = function (ms) { var self = this; ms.forEach(function (m) { if (self.keys[m]) self.keys[m].classList.remove('tl-lit'); }); };

Keyboard.prototype.ripple = function (m) {
  var p = this.where(m); if (!p) return;
  var r = document.createElement('div'); r.className = 'tl-ripple';
  r.style.left = p.x + 'px'; r.style.top = (Keyboard.isWhite(m) ? p.keyBottom - 40 : p.keyBottom - 26) + 'px';
  this.overlay.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

Keyboard.prototype.highlight = function (ms) {
  this.unlit(Object.keys(this.held).map(Number));
  var held = {}; ms.forEach(function (m) { held[m] = true; }); this.held = held;
  this.lit(ms);
  this.follow(ms);
};

Keyboard.prototype.label = function (m, text) {
  var k = this.keys[m]; if (!k) return;
  this.remember('label', [m, text]);
  var b = document.createElement('span'); b.className = 'tl-badge tl-mark'; b.textContent = text;
  b.style.animationDelay = (this.marks.length % 8) * 60 + 'ms';
  k.appendChild(b);
};

Keyboard.prototype.spelling = function (map) {
  this.spell = map || {};
  var self = this;
  Object.keys(this.keys).forEach(function (m) { self.keys[m].setAttribute('aria-label', self.namesOf(Number(m)).join(' 或 ')); });
};

// Arcs over the lane between neighbouring keys, each marked with how far
// apart they are. An arc that crosses to the next row is drawn as two
// halves, leaving one row's edge and entering the next.
Keyboard.prototype.steps = function (pairs) {
  var self = this;
  this.remember('steps', [pairs]);
  var MARK = { 1: 'S', 2: 'T', 3: 'T+S' };
  pairs.forEach(function (pr, k) {
    var a = self.where(pr[0]), b = self.where(pr[1]); if (!a || !b) return;
    var text = pr[2] || MARK[Math.abs(pr[1] - pr[0])] || String(Math.abs(pr[1] - pr[0]));
    var delay = k * 90;
    var base = a.laneBottom - 4, lift = Math.min(26, (a.laneBottom - a.laneTop) - 12);
    var mid;
    if (a.row === b.row) {
      self.arc(a.x, b.x, base, lift, delay);
      mid = (a.x + b.x) / 2;
    } else {
      self.arc(a.x, a.rowRight + 10, base, lift, delay);
      self.arc(b.rowLeft - 10, b.x, b.laneBottom - 4, lift, delay);
      mid = (a.x + a.rowRight) / 2;
    }
    var tag = document.createElement('div'); tag.className = 'tl-step tl-mark' + (text.length > 1 ? ' wide' : ''); tag.textContent = text;
    tag.style.left = mid + 'px'; tag.style.top = (base - lift + 2) + 'px'; tag.style.animationDelay = delay + 200 + 'ms';
    self.overlay.appendChild(tag);
  });
};
Keyboard.prototype.arc = function (x1, x2, base, lift, delay) {
  var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M' + (x1 + 3) + ' ' + base + ' Q ' + (x1 + x2) / 2 + ' ' + (base - lift * 1.6) + ' ' + (x2 - 3) + ' ' + base);
  p.setAttribute('class', 'tl-arc');
  this.arcs.appendChild(p);
  p.style.setProperty('--len', Math.ceil(p.getTotalLength()) + 'px');
  p.style.animationDelay = delay + 'ms';
};

// Counts semitones from one key to another: each key on the way lights,
// sounds and gets its number above it. The first and last keys stay lit.
Keyboard.prototype.count = function (from, to) {
  var self = this; this.stop();
  var dir = to >= from ? 1 : -1, total = Math.abs(to - from);
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.highlight([from]);
  if (this.audible()) this.note(from, 0, .6, .6);
  for (var n = 1; n <= total; n++) (function (n) {
    self.timers.push(setTimeout(function () {
      var m = from + dir * n;
      self.unlit(Object.keys(self.keys).map(Number).filter(function (k) { return !self.held[k]; }));
      self.lit([m]); self.press(m, 160);
      self.follow([from, m]);
      if (self.audible()) self.note(m, 0, .5, .6);
      var p = self.where(m);
      if (p) {
        var d = document.createElement('div'); d.className = 'tl-count tl-mark'; d.textContent = String(n);
        d.style.left = p.x + 'px'; d.style.top = p.laneMid + 'px'; self.overlay.appendChild(d);
      }
      self.emit('countStep', { n: n, midi: m, total: total });
      if (n === total) self.highlight([from, to]);
    }, n * (reduce ? 150 : 560)));
  })(n);
};

Keyboard.prototype.spotlight = function (lo, hi) {
  var self = this;
  this.overlay.querySelectorAll('.tl-spot').forEach(function (s) { s.remove(); });
  Object.keys(this.keys).forEach(function (m) { self.keys[m].classList.remove('tl-dim'); });
  if (lo === null || lo === undefined) return;
  this.remember('spotlight', [lo, hi]);
  Object.keys(this.keys).forEach(function (m) { if (m < lo || m > hi) self.keys[m].classList.add('tl-dim'); });
  var byRow = new Map();
  for (var m = lo; m <= hi; m++) { var p = this.where(m); if (!p) continue; var e = byRow.get(p.row) || { x1: Infinity, x2: -Infinity, top: p.laneTop, bottom: p.keyBottom }; var w = this.keys[m].offsetWidth / 2; e.x1 = Math.min(e.x1, p.x - w); e.x2 = Math.max(e.x2, p.x + w); e.bottom = Math.max(e.bottom, p.keyBottom); byRow.set(p.row, e); }
  byRow.forEach(function (e) {
    var s = document.createElement('div'); s.className = 'tl-spot';
    s.style.left = e.x1 - 10 + 'px'; s.style.width = e.x2 - e.x1 + 20 + 'px'; s.style.top = e.top + 'px'; s.style.height = e.bottom - e.top + 'px';
    self.overlay.appendChild(s);
    requestAnimationFrame(function () { requestAnimationFrame(function () { s.classList.add('on'); }); });
  });
  var range = []; for (var k = lo; k <= hi; k++) range.push(k);
  this.follow(range);
};

Keyboard.prototype.caption = function (m, html) {
  this.overlay.querySelectorAll('.tl-bubble').forEach(function (e) { e.remove(); });
  this.follow([m]);
  var p = this.where(m); if (!p) return;
  var d = document.createElement('div'); d.className = 'tl-bubble'; d.innerHTML = html;
  d.style.left = Math.max(80, Math.min(this.overlay.clientWidth - 80, p.x)) + 'px'; d.style.top = (p.keyTop - 6) + 'px';
  this.overlay.appendChild(d);
};

// Plays a tune: each item is one key, or several keys sounded together.
// Keys go down and light while they sound.
Keyboard.prototype.play = function (tune, beat) {
  var self = this; this.stop();
  if (!this.audible() || !tune || !tune.length) return;
  var step = beat || .42, t = 0;
  this.playing = true;
  if (this.playBtn) this.playBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h4v12H5zM11 4h4v12h-4z"/></svg>';
  this.emit('playStart', {});
  tune.forEach(function (item) {
    var chord = Array.isArray(item) ? item : [item];
    var dur = chord.length > 1 ? 1.4 : step;
    chord.forEach(function (m) { self.note(m, t, dur * .95, chord.length > 1 ? .55 : .75); });
    self.timers.push(setTimeout(function () {
      chord.forEach(function (m) { self.press(m, Math.max(120, dur * 1000 - 60)); });
      self.lit(chord);
      self.follow(chord);
      self.timers.push(setTimeout(function () { self.unlit(chord.filter(function (m) { return !self.held[m]; })); }, Math.max(120, dur * 1000 - 40)));
    }, t * 1000));
    t += dur;
  });
  this.timers.push(setTimeout(function () { self.voices = []; self.stop(); self.emit('playEnd', {}); }, t * 1000 + 150));
};

Keyboard.prototype.clearTimers = function () { (this.timers || []).forEach(clearTimeout); this.timers = []; };

// Stops a playback or a count: timers are cleared and every note still
// queued or sounding is silenced.
Keyboard.prototype.stop = function () {
  this.clearTimers(); this.silence(); this.playing = false;
  if (this.playBtn) this.playBtn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg>';
  if (!this.keys) return;
  var self = this;
  Object.keys(this.keys).forEach(function (m) { self.keys[m].classList.remove('tl-down'); if (!self.held[m] && Number(m) !== self.tapLit) self.keys[m].classList.remove('tl-lit'); });
};

Keyboard.prototype.clear = function () {
  this.stop(); this.clearTap(); this.spotlight(null);
  this.marks = []; this.held = {}; this.spell = {}; this.interest = null;
  var self = this;
  Object.keys(this.keys).forEach(function (m) { self.keys[m].classList.remove('tl-lit'); });
  this.host.querySelectorAll('.tl-mark').forEach(function (e) { e.remove(); });
  this.arcs.innerHTML = '';
};
