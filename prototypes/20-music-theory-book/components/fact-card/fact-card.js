/* ============================================================
   Fact card component. One card of a deck at a time: a category tag,
   a name, and rows of fields. A row's value is text, a short ABC
   snippet drawn as a stave (it sounds when tapped, ornaments played
   out), or a pitch range drawn on a miniature keyboard from A0 to C8.
   Inputs: entries ({id: {head, tag, rows: [{field, label, text, abc,
   range: [low, high], note}]}}), entry, fields, mode ('lecture' |
   'practice'), tempo, playable, compact, caption.
   Commands: show, highlight, spotlight, label, caption, check, fit,
   mask, reveal, play, stop, clear.
   Events (via onEvent): rowTap, headTap, blankTap, playStart, playEnd.
   Sound goes through the injected source, lectures only.
   Colours are the theme constants (--th-*) set on the stage or page.
   ============================================================ */
function FactCard(host, options) {
  this.host = host;
  this.o = Object.assign({ entries: {}, entry: null, fields: null, mode: 'lecture', tempo: 96, playable: false, compact: false, caption: '', sound: null, onEvent: function () {} }, options);
  this.entryId = this.o.entry || Object.keys(this.o.entries)[0] || null;
  this.masked = {};
  this.resetMarks();
  this.timers = [];
  this.tapTimers = [];
  this.voices = [];
  this.uid = 'tlfc' + (FactCard.count = (FactCard.count || 0) + 1);
  this.build();
}
FactCard.LETTERS = 'CDEFGAB';
FactCard.STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
FactCard.SHIFT = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
FactCard.LOW = 21;   // A0, the left end of every range strip
FactCard.HIGH = 108; // C8, the right end
FactCard.KEY_W = 10; // a white key's width in strip units
// Lanes of the range strip, in strip units from the top: the range bar,
// the band of a part being fitted, then the keys.
FactCard.LANE = { bar: 3, barH: 7, band: 14, bandH: 11, keys: 30, height: 74, blackH: 27 };
FactCard.TAP_FADE_MS = 2000;
FactCard.STAFF_SCALE = { normal: .92, compact: .8 };
FactCard.SVG = 'http://www.w3.org/2000/svg';
FactCard.TICK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.5" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
FactCard.CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke-width="2.4" stroke-linecap="round"/></svg>';

FactCard.esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

// 'Bb3', 'B♭3', 'F#2', 'C4' -> MIDI number.
FactCard.midi = function (name) {
  var m = /^([A-Ga-g])(#|b|♯|♭|)(-?\d)$/.exec(String(name).trim()); if (!m) return null;
  var acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + FactCard.STEP[m[1].toUpperCase()] + acc;
};
FactCard.pretty = function (name) { return String(name).replace(/^([A-Ga-g])#/, '$1♯').replace(/^([A-Ga-g])b(?=-?\d)/, '$1♭'); };

// Accidental glyphs drawn by the score library, so a flat in a name here
// is the same shape as a flat on the score.
FactCard.glyphs = function () {
  if (FactCard._glyphs) return FactCard._glyphs;
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
  FactCard._glyphs = out;
  return out;
};

// Text as HTML in the serif, every ♯ ♭ ♮ swapped for the library glyph,
// scaled to the text and centred a third of an em above the baseline.
FactCard.inline = function (text, fontPx) {
  var G = FactCard.glyphs();
  return String(text).split(/([♯♭♮])/).map(function (part) {
    var acc = part === '♯' ? 1 : part === '♭' ? -1 : part === '♮' ? 0 : null;
    if (acc === null) return FactCard.esc(part);
    var g = G[acc]; if (!g) return part;
    var s = fontPx * 0.034, band = 14, w = (g.w + 1) * s, h = band * 2 * s, lift = 0.33 * fontPx - band * s;
    return '<svg class="tl-fc-acc" viewBox="' + (g.x - .5) + ' ' + (G.lineY - band) + ' ' + (g.w + 1) + ' ' + band * 2 + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" style="vertical-align:' + lift.toFixed(1) + 'px;margin:0 1px" aria-hidden="true"><path d="' + g.d + '"/></svg>';
  }).join('');
};

// A row's ABC as a whole tune: header lines from the row (L:, K:, Q:)
// with defaults, K: last, then the music.
FactCard.tune = function (abc) {
  var head = [], body = [], key = 'K:C';
  String(abc).split('\n').forEach(function (line) {
    if (/^K:/.test(line)) key = line;
    else if (/^[A-Za-z]:/.test(line)) head.push(line);
    else body.push(line);
  });
  if (!head.some(function (l) { return /^L:/.test(l); })) head.push('L:1/4');
  return 'X:1\n' + head.join('\n') + '\n' + key + '\n' + body.join('\n');
};

// White keys below a MIDI note, counted from A0: where it sits on the strip.
FactCard.whitesBelow = function (m) {
  var n = 0; for (var k = FactCard.LOW; k < m; k++) if (!FactCard.isBlack(k)) n++;
  return n;
};
FactCard.isBlack = function (m) { return [1, 3, 6, 8, 10].indexOf(m % 12) >= 0; };
FactCard.keyLeft = function (m) { var w = FactCard.whitesBelow(m) * FactCard.KEY_W; return FactCard.isBlack(m) ? w - 3.2 : w; };
FactCard.keyRight = function (m) { var w = FactCard.whitesBelow(m) * FactCard.KEY_W; return FactCard.isBlack(m) ? w + 3.2 : w + FactCard.KEY_W; };

FactCard.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };
FactCard.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
FactCard.prototype.entry = function () { return this.o.entries[this.entryId] || { head: '', tag: '', rows: [] }; };
FactCard.prototype.rowsShown = function () {
  var f = this.o.fields;
  return this.entry().rows.filter(function (r) { return !f || f.indexOf(r.field) >= 0; });
};
FactCard.prototype.rowData = function (field) { return this.rowsShown().filter(function (r) { return r.field === field; })[0] || null; };
FactCard.prototype.sounds = function (r) { return !!(r.range || (r.abc && this.staffs[r.field] && this.staffs[r.field].notes.length)); };
FactCard.prototype.resetMarks = function () { this.held = []; this.spot = null; this.labels = {}; this.checks = {}; this.fits = {}; };

// Every note the card sounds goes through here, so stop() can silence
// the notes already scheduled ahead on the audio clock.
FactCard.prototype.note = function (midi, delay, dur, velocity) {
  var v = this.o.sound.play(midi, delay, dur, velocity);
  if (v) this.voices.push(v);
};
FactCard.prototype.silence = function () {
  (this.voices || []).forEach(function (v) { v.stop(); });
  this.voices = [];
};

FactCard.prototype.build = function () {
  var self = this;
  this.stop(); this.clearTap();
  this.host.classList.add('tl-fc');
  this.host.classList.toggle('tl-fc-compact', !!this.o.compact);
  this.host.innerHTML = '';
  this.card = document.createElement('div'); this.card.className = 'tl-fc-card';
  this.host.appendChild(this.card);
  if (this.o.caption) { var cap = document.createElement('p'); cap.className = 'tl-fc-caption'; cap.textContent = this.o.caption; this.host.appendChild(cap); }
  this.card.addEventListener('pointerdown', function (ev) { self.onPointer(ev); });
  this.card.addEventListener('keydown', function (ev) { self.onKey(ev); });
  this.card.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') self.host.classList.add('kbd'); });
  this.render();
};

// Draws the current entry: head, rows, play button, then the marks.
FactCard.prototype.render = function () {
  var self = this, e = this.entry(), rows = this.rowsShown();
  var valPx = this.o.compact ? 19 : 21, headPx = this.o.compact ? 25 : 34;
  this.card.innerHTML = '';
  this.staffs = {}; this.strips = {};
  this.head = document.createElement('div'); this.head.className = 'tl-fc-head'; this.head.tabIndex = -1;
  this.head.innerHTML = '<span class="tl-fc-tag">' + FactCard.esc(e.tag || '') + '</span><span class="tl-fc-word"><span class="tl-fc-text">' + FactCard.inline(e.head || '', headPx) + '</span></span>';
  this.card.appendChild(this.head);
  this.rowsEl = document.createElement('div'); this.rowsEl.className = 'tl-fc-rows';
  this.card.appendChild(this.rowsEl);
  this.rowEls = {};
  rows.forEach(function (r, i) {
    var row = document.createElement('div');
    row.className = 'tl-fc-row' + (r.range ? ' tl-fc-wide' : '');
    row.dataset.field = r.field; row.tabIndex = i === 0 ? 0 : -1; row.setAttribute('role', 'button');
    row.innerHTML = '<span class="tl-fc-label"><span class="tl-fc-ltext">' + FactCard.esc(r.label || r.field) + '</span></span><div class="tl-fc-cell"><div class="tl-fc-val"></div></div>';
    var val = row.querySelector('.tl-fc-val');
    if (r.text) { var t = document.createElement('span'); t.className = 'tl-fc-text'; t.innerHTML = FactCard.inline(r.text, valPx); val.appendChild(t); }
    self.rowsEl.appendChild(row);
    self.rowEls[r.field] = row;
    if (r.abc) self.drawStaff(r, val);
    if (r.range) self.drawRange(r, val);
    row.setAttribute('aria-label', (r.label || r.field) + ': ' + (r.text || (r.range ? FactCard.pretty(r.range[0]) + ' to ' + FactCard.pretty(r.range[1]) : 'music')));
  });
  this.over = document.createElement('div'); this.over.className = 'tl-fc-over';
  this.card.appendChild(this.over);
  var playable = this.o.playable && this.o.mode === 'lecture' && rows.some(function (r) { return self.sounds(r); });
  this.card.classList.toggle('tl-fc-has-play', playable);
  if (playable) {
    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button'; this.playBtn.className = 'tl-fc-play';
    this.playBtn.addEventListener('click', function (ev) { ev.stopPropagation(); if (self.playing) self.stop(); else self.play(); });
    this.playBtn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    this.card.appendChild(this.playBtn);
    this.playIcon(false);
  } else this.playBtn = null;
  this.applyMasks(false);
  this.apply();
};

// Draws a row's ABC on a short stave, cropped to what is drawn, at one
// scale for every card, so the same snippet is the same size everywhere;
// shrunk only when the cell is narrower. Keeps the notes with their
// pitches, timing and ornaments for playback.
FactCard.prototype.drawStaff = function (r, val) {
  var holder = document.createElement('div'); holder.className = 'tl-fc-staff';
  val.appendChild(holder);
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:700px;visibility:hidden';
  document.body.appendChild(box);
  var vis = ABCJS.renderAbc(box, FactCard.tune(r.abc), { add_classes: true, staffwidth: 560, paddingleft: 0, paddingright: 0, paddingtop: 0, paddingbottom: 0 })[0];
  var svg = box.querySelector('svg');
  var all = svg.getBBox(), right = 0;
  svg.querySelectorAll('path, text').forEach(function (p) {
    var c = (p.getAttribute('class') || '') + ' ' + ((p.parentNode && p.parentNode.getAttribute && p.parentNode.getAttribute('class')) || '');
    if (/abcjs-staff|abcjs-top-line/.test(c)) return;
    var b = p.getBBox(); if (b.width || b.height) right = Math.max(right, b.x + b.width);
  });
  var w = Math.ceil(right + 10), y0 = Math.floor(all.y - 4), h = Math.ceil(all.height + 8);
  var k = FactCard.STAFF_SCALE[this.o.compact ? 'compact' : 'normal'];
  var room = Math.max(120, val.parentNode.clientWidth || 200);
  if (w * k > room) k = room / w;
  svg.setAttribute('viewBox', '0 ' + y0 + ' ' + w + ' ' + h);
  svg.setAttribute('width', (w * k).toFixed(1)); svg.setAttribute('height', (h * k).toFixed(1));
  svg.removeAttribute('style'); svg.setAttribute('aria-hidden', 'true');
  holder.appendChild(svg);
  box.remove();
  this.staffs[r.field] = { svg: svg, notes: this.collect(vis) };
};

// The notes of a snippet in order with their onsets in whole notes,
// pitches (key signature and accidentals within the bar applied), grace
// notes and ornament, and the drawn shapes to light while they sound.
FactCard.prototype.collect = function (vis) {
  var out = [], t = 0, bar = {};
  var keyOf = function (k) { var m = {}; ((k && k.accidentals) || []).forEach(function (a) { m[a.note.toUpperCase()] = a.acc; }); return m; };
  var key = {}; try { key = keyOf(vis.getKeySignature()); } catch (e) { key = {}; }
  var info = function (p, within) {
    var letter = FactCard.LETTERS[((p.pitch % 7) + 7) % 7], slot = letter + p.pitch;
    if (within && p.accidental) within[slot] = p.accidental;
    var acc = p.accidental || (within && within[slot]) || key[letter] || null;
    return 60 + 12 * Math.floor(p.pitch / 7) + FactCard.STEP[letter] + (acc ? FactCard.SHIFT[acc] : 0);
  };
  (vis.lines || []).forEach(function (line) {
    var staff = (line.staff || [])[0]; if (!staff) return;
    ((staff.voices || [])[0] || []).forEach(function (el) {
      if (el.el_type === 'bar') { bar = {}; return; }
      if (el.el_type !== 'note') return;
      var d = el.duration || 0;
      if (el.rest || !el.pitches) { t += d; return; }
      var shapes = ((el.abselem && el.abselem.elemset) || []).filter(function (x) { return x && x.getBBox; });
      var pitch = el.pitches[0];
      out.push({
        t: t, d: d, shapes: shapes,
        midis: el.pitches.map(function (p) { return info(p, bar); }),
        up: info({ pitch: pitch.pitch + 1 }, null), down: info({ pitch: pitch.pitch - 1 }, null),
        graces: (el.gracenotes || []).map(function (g) { return { midi: info(g, null), crushed: !!g.acciaccatura }; }),
        ornament: (el.decoration || []).filter(function (x) { return /trill|turn|mordent|pralltriller/.test(x); })[0] || null
      });
      t += d;
    });
  });
  return out;
};

// How a snippet sounds, in seconds from its start: each note at the
// card's tempo, ornaments and grace notes played out the way they are
// written out on the ornament cards (a semiquaver of the beat each).
FactCard.prototype.sequence = function (notes) {
  var q = 60 / this.o.tempo, out = [], end = 0;
  notes.forEach(function (n) {
    var at = n.t * 4 * q, len = n.d * 4 * q, unit = Math.min(q / 4, len / 4), main = n.midis;
    var push = function (midis, s, d) { out.push({ midis: midis, at: s, dur: Math.max(.06, d), shapes: n.shapes }); };
    if (n.ornament === 'trill') {
      var u = unit / 2, s = at, i = 0;
      while (s + u < at + len - unit) { push([i % 2 ? n.up : main[0]], s, u); s += u; i++; }
      push(main, s, at + len - s);
    } else if (n.ornament === 'turn') {
      [n.up, main[0], n.down].forEach(function (m, i) { push([m], at + i * len / 4, len / 4); });
      push(main, at + 3 * len / 4, len / 4);
    } else if (/mordent|pralltriller/.test(n.ornament || '')) {
      var other = /upper|prall/.test(n.ornament) ? n.up : n.down;
      push([main[0]], at, unit); push([other], at + unit, unit); push(main, at + 2 * unit, len - 2 * unit);
    } else if (n.graces.length) {
      var g = n.graces[0];
      if (g.crushed) { push([g.midi], Math.max(0, at - .06), .06); push(main, at, len); }
      else { push([g.midi], at, len / 2); push(main, at + len / 2, len / 2); }
    } else push(main, at, len);
    end = Math.max(end, at + len);
  });
  return { steps: out, length: end };
};

// The range strip: the instrument's range lit on a keyboard from A0 to
// C8, its lowest and highest notes named above, every C marked below.
FactCard.prototype.drawRange = function (r, val) {
  var self = this, L = FactCard.LANE, lo = FactCard.midi(r.range[0]), hi = FactCard.midi(r.range[1]);
  var W = FactCard.whitesBelow(FactCard.HIGH + 1) * FactCard.KEY_W;
  var wrap = document.createElement('div'); wrap.className = 'tl-fc-range';
  var svg = document.createElementNS(FactCard.SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + L.height); svg.setAttribute('aria-hidden', 'true');
  var glow = this.uid + '-' + r.field + '-glow';
  var html = '<defs><filter id="' + glow + '" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="2.2"/></filter>' +
    '<pattern id="' + this.uid + '-' + r.field + '-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" style="fill:color-mix(in srgb, var(--tl-wrong) 16%, transparent)"/><line x1="0" y1="0" x2="0" y2="5" style="stroke:var(--tl-wrong)" stroke-width="2"/></pattern></defs>';
  var bx = FactCard.keyLeft(lo), bw = FactCard.keyRight(hi) - bx;
  var bar = '<rect class="tl-fc-bar" x="' + bx + '" y="' + L.bar + '" width="' + bw + '" height="' + L.barH + '" rx="3.5"';
  html += bar + ' filter="url(#' + glow + ')" opacity=".7"/>' + bar + '/>';
  html += '<g class="tl-fc-bandlayer"></g>';
  var whites = '', blacks = '';
  for (var m = FactCard.LOW; m <= FactCard.HIGH; m++) {
    var inR = m >= lo && m <= hi ? ' tl-fc-in' : '';
    if (FactCard.isBlack(m)) blacks += '<rect class="tl-fc-bk' + inR + '" data-m="' + m + '" x="' + FactCard.keyLeft(m) + '" y="' + L.keys + '" width="6.4" height="' + L.blackH + '" rx="1"/>';
    else whites += '<rect class="tl-fc-wk' + inR + '" data-m="' + m + '" x="' + FactCard.keyLeft(m) + '" y="' + L.keys + '" width="' + FactCard.KEY_W + '" height="' + (L.height - L.keys) + '" rx="1.2"/>';
  }
  svg.innerHTML = html + whites + blacks;
  wrap.appendChild(svg);
  var px = this.o.compact ? 15 : 16;
  var names = [[lo, r.range[0]], [hi, r.range[1]]].map(function (p) {
    var s = document.createElement('span'); s.className = 'tl-fc-name'; s.innerHTML = FactCard.inline(FactCard.pretty(p[1]), px);
    s.dataset.x = ((FactCard.keyLeft(p[0]) + FactCard.keyRight(p[0])) / 2 / W * 100).toFixed(2);
    wrap.appendChild(s); return s;
  });
  for (var c = 24; c <= 108; c += 12) {
    var tk = document.createElement('span'); tk.className = 'tl-fc-tick'; tk.textContent = 'C' + (c / 12 - 1);
    tk.style.left = ((FactCard.keyLeft(c) + FactCard.KEY_W / 2) / W * 100).toFixed(2) + '%';
    wrap.appendChild(tk);
  }
  val.appendChild(wrap);
  this.strips[r.field] = { svg: svg, wrap: wrap, lo: lo, hi: hi, W: W };
  this.placeNames(names, wrap);
  requestAnimationFrame(function () { self.placeNames(names, wrap); });
};
// The two names sit over their keys, pushed apart if they would touch
// and kept inside the strip.
FactCard.prototype.placeNames = function (names, wrap) {
  var full = wrap.clientWidth; if (!full) return;
  var boxes = names.map(function (s) { var w = s.offsetWidth; return { s: s, w: w, x: Math.max(0, Math.min(full - w, Number(s.dataset.x) / 100 * full - w / 2)) }; });
  var gap = 8, a = boxes[0], b = boxes[1];
  if (a.x + a.w + gap > b.x) {
    var mid = (a.x + a.w + b.x) / 2;
    a.x = Math.max(0, mid - gap / 2 - a.w); b.x = Math.min(full - b.w, a.x + a.w + gap);
  }
  boxes.forEach(function (bx) { bx.s.style.left = bx.x + 'px'; });
};

// Masks lie over the value as paper slips; masks survive a change of card.
FactCard.prototype.applyMasks = function (animated) {
  var self = this;
  var cover = function (el, on) {
    if (!el) return;
    var slip = el.querySelector(':scope > .tl-fc-slip');
    if (on && !slip) {
      slip = document.createElement('span'); slip.className = 'tl-fc-slip'; slip.innerHTML = '<span class="tl-fc-q">?</span>';
      el.appendChild(slip); el.classList.add('tl-fc-hidden');
    } else if (!on && slip) {
      el.classList.remove('tl-fc-hidden');
      if (animated) {
        el.querySelectorAll(':scope > :not(.tl-fc-slip)').forEach(function (c) { c.classList.remove('tl-fc-ink'); void c.offsetWidth; c.classList.add('tl-fc-ink'); });
        slip.classList.add('off'); setTimeout(function () { slip.remove(); }, 480);
      } else slip.remove();
    }
  };
  cover(this.head.querySelector('.tl-fc-word'), !!this.masked.head);
  this.head.setAttribute('aria-label', this.masked.head ? '名称未知' : this.entry().head || '');
  Object.keys(this.rowEls).forEach(function (f) {
    var row = self.rowEls[f], r = self.rowData(f);
    cover(row.querySelector('.tl-fc-val'), !!self.masked[f]);
    row.setAttribute('aria-label', (r.label || f) + ': ' + (self.masked[f] ? '未知' : r.text || (r.range ? FactCard.pretty(r.range[0]) + ' to ' + FactCard.pretty(r.range[1]) : 'music')));
  });
};

// Applies the marks held in state to the drawn card: lit rows (held and
// the one a tap lit), the spotlight, badges, claims and fitted ranges.
// Marks already drawn are kept, so their entrance plays only once.
FactCard.prototype.apply = function () {
  var self = this;
  var lit = this.held.slice(); if (this.tapLit) lit.push(this.tapLit);
  this.head.classList.toggle('tl-lit', lit.indexOf('head') >= 0);
  this.head.classList.toggle('tl-dim', !!this.spot && this.spot.indexOf('head') < 0);
  Object.keys(this.rowEls).forEach(function (f) {
    var row = self.rowEls[f];
    row.classList.toggle('tl-lit', lit.indexOf(f) >= 0);
    row.classList.toggle('tl-dim', !!self.spot && self.spot.indexOf(f) < 0);
    var label = row.querySelector('.tl-fc-label'), badge = label.querySelector('.tl-fc-badge');
    if (self.labels[f] === undefined) { if (badge) badge.remove(); }
    else if (!badge || badge.textContent !== self.labels[f]) {
      if (badge) badge.remove();
      badge = document.createElement('span'); badge.className = 'tl-fc-badge'; badge.textContent = self.labels[f];
      badge.style.animationDelay = Object.keys(self.labels).indexOf(f) * 80 + 'ms';
      label.insertBefore(badge, label.firstChild);
    }
    var cell = row.querySelector('.tl-fc-cell'), claim = cell.querySelector('.tl-fc-claim'), want = self.checks[f];
    var sig = want ? want.text + '|' + want.holds : null;
    if (!want) { if (claim) claim.remove(); }
    else if (!claim || claim.dataset.sig !== sig) {
      if (claim) claim.remove();
      claim = document.createElement('span'); claim.dataset.sig = sig;
      claim.className = 'tl-fc-claim ' + (want.holds ? 'tl-fc-holds' : 'tl-fc-fails');
      var said = FactCard.inline(want.text, 17);
      claim.innerHTML = want.holds ? '<span>' + said + '</span>' + FactCard.TICK : '<s>' + said + '</s>' + FactCard.CROSS;
      claim.setAttribute('aria-label', '说法“' + want.text + '”' + (want.holds ? '对' : '不对'));
      cell.appendChild(claim);
    }
    self.drawFit(f);
  });
};

// A part's range over the strip: a dashed band; the notes the instrument
// cannot reach hatched in brick red; a verdict line under the strip.
FactCard.prototype.drawFit = function (f) {
  var st = this.strips[f]; if (!st) return;
  var want = this.fits[f], L = FactCard.LANE, layer = st.svg.querySelector('.tl-fc-bandlayer'), cell = this.rowEls[f].querySelector('.tl-fc-cell');
  var old = cell.querySelector('.tl-fc-verdict');
  var sig = want ? want.low + '|' + want.high : null;
  if (!want) { layer.innerHTML = ''; if (old) old.remove(); return; }
  if (old && old.dataset.sig === sig) return;
  if (old) old.remove();
  var lo = FactCard.midi(want.low), hi = FactCard.midi(want.high), hatch = 'url(#' + this.uid + '-' + f + '-hatch)';
  var x1 = FactCard.keyLeft(lo), x2 = FactCard.keyRight(hi), y = L.band, h = L.bandH;
  var html = '<g class="tl-fc-band"><rect class="tl-fc-part" x="' + x1 + '" y="' + y + '" width="' + (x2 - x1) + '" height="' + h + '" rx="2.5"/>';
  var below = lo < st.lo, above = hi > st.hi;
  if (below) { var e1 = Math.min(x2, FactCard.keyLeft(st.lo)); html += '<rect class="tl-fc-over-low" x="' + x1 + '" y="' + y + '" width="' + (e1 - x1) + '" height="' + h + '" rx="2.5" fill="' + hatch + '"/>'; }
  if (above) { var s2 = Math.max(x1, FactCard.keyRight(st.hi)); html += '<rect class="tl-fc-over-high" x="' + s2 + '" y="' + y + '" width="' + (x2 - s2) + '" height="' + h + '" rx="2.5" fill="' + hatch + '"/>'; }
  layer.innerHTML = html + '</g>';
  var ok = !below && !above;
  var v = document.createElement('span'); v.dataset.sig = sig;
  v.className = 'tl-fc-verdict ' + (ok ? 'tl-fc-holds' : 'tl-fc-fails');
  var part = FactCard.inline(FactCard.pretty(want.low) + '–' + FactCard.pretty(want.high), 16);
  v.innerHTML = (ok ? FactCard.TICK : FactCard.CROSS) + '<span>part ' + part + ': ' + (ok ? 'in range' : below && above ? 'too low and too high' : below ? 'too low' : 'too high') + '</span>';
  cell.appendChild(v);
};

// Taps: the head; a row (rows touch, and a tap just outside a row's edge
// goes to the nearer one); the margin under the last row is blank.
FactCard.prototype.onPointer = function (ev) {
  this.host.classList.remove('kbd');
  var y = ev.clientY, rows = this.rowsEl.querySelectorAll('.tl-fc-row');
  var headBox = this.head.getBoundingClientRect();
  var target = null;
  if (y <= headBox.bottom + 2) target = 'head';
  else {
    var best = null, dist = Infinity;
    rows.forEach(function (row) { var b = row.getBoundingClientRect(); var d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0; if (d < dist) { dist = d; best = row; } });
    if (best && dist <= 6) target = best.dataset.field;
  }
  if (!target) { this.blankTap(); return; }
  if (this.o.mode !== 'lecture') { ev.preventDefault(); return; }
  ev.preventDefault();
  if (target === 'head') this.headTap(); else this.tap(target, ev);
};

FactCard.prototype.onKey = function (ev) {
  var cur = ev.target.closest('.tl-fc-row'); if (!cur) return;
  var list = [].slice.call(this.rowsEl.querySelectorAll('.tl-fc-row')), i = list.indexOf(cur), next = null;
  if (ev.key === 'ArrowDown') next = list[Math.min(list.length - 1, i + 1)];
  else if (ev.key === 'ArrowUp') next = list[Math.max(0, i - 1)];
  else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (this.o.mode === 'lecture') this.tap(cur.dataset.field, null); return; }
  else if (ev.key === 'Escape') { this.blankTap(); return; }
  if (!next || next === cur) return;
  ev.preventDefault();
  cur.tabIndex = -1; next.tabIndex = 0; next.focus();
  if (this.o.mode === 'lecture') this.tap(next.dataset.field, null);
};

FactCard.prototype.tap = function (field, ev) {
  var self = this, r = this.rowData(field), row = this.rowEls[field]; if (!r || !row) return;
  this.clearTap();
  this.tapLit = field;
  row.classList.add('tl-fc-down'); setTimeout(function () { row.classList.remove('tl-fc-down'); }, 200);
  if (ev) this.ripple(ev);
  this.apply();
  var hidden = !!this.masked[field];
  if (!hidden && this.audible() && this.sounds(r)) { this.stop(); this.sound(r, 0); }
  if (!hidden && r.note) this.caption(field, FactCard.inline(r.note, 17), true);
  this.emit('rowTap', { entry: this.entryId, field: field, label: r.label || field, text: hidden ? null : r.text || null, low: r.range && !hidden ? r.range[0] : null, high: r.range && !hidden ? r.range[1] : null, hidden: hidden });
  this.tapTimers.push(setTimeout(function () {
    self.over.querySelectorAll('.tl-fc-bubble.tl-fc-tapped').forEach(function (b) { b.classList.add('out'); });
    self.tapLit = null; self.apply();
  }, FactCard.TAP_FADE_MS));
  this.tapTimers.push(setTimeout(function () { self.over.querySelectorAll('.tl-fc-bubble.out').forEach(function (b) { b.remove(); }); }, FactCard.TAP_FADE_MS + 600));
};

FactCard.prototype.headTap = function () {
  var self = this; this.clearTap();
  this.tapLit = 'head'; this.apply();
  this.emit('headTap', { entry: this.entryId, head: this.masked.head ? null : this.entry().head, hidden: !!this.masked.head });
  this.tapTimers.push(setTimeout(function () { self.tapLit = null; self.apply(); }, FactCard.TAP_FADE_MS));
};

FactCard.prototype.blankTap = function () { this.clearTap(); this.emit('blankTap', {}); };

FactCard.prototype.clearTap = function () {
  (this.tapTimers || []).forEach(clearTimeout); this.tapTimers = [];
  if (this.tapLit) { this.tapLit = null; if (this.head) this.apply(); }
  if (this.over) this.over.querySelectorAll('.tl-fc-bubble.tl-fc-tapped').forEach(function (b) { b.remove(); });
};

FactCard.prototype.ripple = function (ev) {
  var rect = this.card.getBoundingClientRect(), r = document.createElement('div'); r.className = 'tl-fc-ripple';
  r.style.left = ev.clientX - rect.left + 'px'; r.style.top = ev.clientY - rect.top + 'px';
  this.over.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

// Sounds one row from `delay` seconds and lights what is sounding: the
// notes of a stave as each plays; on a range strip, the lowest then the
// highest key. Returns how long it lasts.
FactCard.prototype.sound = function (r, delay) {
  var self = this, timers = this.timers;
  var light = function (els, on) { els.forEach(function (e) { e.classList.toggle('tl-fc-sounding', on); }); };
  if (r.range) {
    var st = this.strips[r.field];
    [st.lo, st.hi].forEach(function (m, i) {
      var at = delay + i * .9;
      self.note(m, at, .8, .6);
      var key = st.svg.querySelector('[data-m="' + m + '"]');
      timers.push(setTimeout(function () { light([key], true); }, at * 1000));
      timers.push(setTimeout(function () { light([key], false); }, (at + .8) * 1000));
    });
    return 1.8;
  }
  var seq = this.sequence(this.staffs[r.field].notes);
  seq.steps.forEach(function (s) {
    s.midis.forEach(function (m) { self.note(m, delay + s.at, s.dur, .6); });
    timers.push(setTimeout(function () { light(s.shapes, true); }, (delay + s.at) * 1000));
    timers.push(setTimeout(function () { light(s.shapes, false); }, (delay + s.at + s.dur) * 1000 - 20));
  });
  return seq.length + .3;
};

FactCard.prototype.unlightAll = function () {
  this.card.querySelectorAll('.tl-fc-sounding').forEach(function (e) { e.classList.remove('tl-fc-sounding'); });
};

// Turns the card over to another entry. Masks stay; other marks go,
// since they belong to the card that was showing.
FactCard.prototype.show = function (id) {
  var self = this;
  if (!this.o.entries[id]) return;
  this.stop(); this.clearTap();
  this.entryId = id; this.resetMarks();
  this.over.querySelectorAll('.tl-fc-bubble').forEach(function (b) { b.remove(); });
  var card = this.card;
  clearTimeout(this.flipTimer);
  card.classList.remove('tl-fc-in'); card.classList.add('tl-fc-out');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.flipTimer = setTimeout(function () {
    self.render();
    card.classList.remove('tl-fc-out'); void card.offsetWidth; card.classList.add('tl-fc-in');
  }, reduce ? 0 : 240);
};

FactCard.prototype.fieldsOf = function (list) {
  var self = this;
  return [].concat(list || []).filter(function (f) { return f === 'head' || self.rowEls[f]; });
};
FactCard.prototype.highlight = function (fields) { this.held = this.fieldsOf(fields); this.apply(); };
FactCard.prototype.spotlight = function (fields) { var f = this.fieldsOf(fields); this.spot = f.length ? f : null; this.apply(); };
FactCard.prototype.label = function (map) { var self = this; this.labels = {}; Object.keys(map || {}).forEach(function (f) { if (self.rowEls[f]) self.labels[f] = String(map[f]); }); this.apply(); };
FactCard.prototype.check = function (field, claim, holds) { if (!this.rowEls[field]) return; this.checks[field] = { text: String(claim), holds: !!holds }; this.apply(); };
FactCard.prototype.fit = function (field, low, high) { if (!this.strips[field] || FactCard.midi(low) === null || FactCard.midi(high) === null) return; this.fits[field] = { low: low, high: high }; this.apply(); };

// A dark bubble under a row (over it when there is no room below),
// pointing at the row's value and kept inside the card.
FactCard.prototype.caption = function (field, html, tapped) {
  var row = this.rowEls[field];
  this.over.querySelectorAll('.tl-fc-bubble').forEach(function (e) { e.remove(); });
  if (!row) return;
  var b = document.createElement('div'); b.innerHTML = html;
  b.className = 'tl-fc-bubble';
  this.over.appendChild(b);
  var card = this.card.getBoundingClientRect(), rb = row.getBoundingClientRect(), vb = row.querySelector('.tl-fc-val').getBoundingClientRect();
  var vx = vb.left - card.left + Math.min(vb.width, 160) / 2;
  var rowTop = rb.top - card.top, rowBottom = rb.bottom - card.top;
  var bw = b.offsetWidth, bh = b.offsetHeight;
  var below = rowBottom + bh + 10 <= card.height;
  b.className = 'tl-fc-bubble ' + (below ? 'tl-fc-below' : 'tl-fc-above') + (tapped ? ' tl-fc-tapped' : '');
  var left = Math.max(10, Math.min(card.width - 10 - bw, vx - bw / 2));
  b.style.left = left + 'px';
  b.style.top = (below ? rowBottom + 4 : rowTop - bh - 4) + 'px';
  b.style.setProperty('--ax', Math.max(12, Math.min(bw - 12, vx - left)) + 'px');
};

// 'head' or field names; with no argument, reveal() uncovers everything.
FactCard.prototype.mask = function (what) { var self = this; [].concat(what).forEach(function (f) { self.masked[f] = true; }); this.applyMasks(false); };
FactCard.prototype.reveal = function (what) {
  var self = this;
  if (what === undefined) this.masked = {};
  else [].concat(what).forEach(function (f) { delete self.masked[f]; });
  this.applyMasks(true);
};

// Sounds every row that can sound, top to bottom, with a breath between.
FactCard.prototype.play = function () {
  var self = this; this.stop();
  if (!this.audible()) return;
  var at = 0;
  this.rowsShown().forEach(function (r) {
    if (!self.sounds(r) || self.masked[r.field]) return;
    var start = at;
    self.timers.push(setTimeout(function () { self.held = [r.field]; self.apply(); }, start * 1000));
    at += self.sound(r, start) + .5;
  });
  this.timers.push(setTimeout(function () { self.voices = []; self.held = []; self.apply(); self.playing = false; self.playIcon(false); self.emit('playEnd', {}); }, at * 1000));
  this.playing = true; this.playIcon(true);
  this.emit('playStart', {});
};

FactCard.prototype.playIcon = function (playing) {
  if (!this.playBtn) return;
  this.playBtn.innerHTML = playing ? '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h4v12H5zM11 4h4v12h-4z"/></svg>' : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg>';
  this.playBtn.setAttribute('aria-label', playing ? '停止' : '播放');
};

// Stops a playback or a tapped row: timers are cleared and every note
// still queued or sounding is silenced.
FactCard.prototype.stop = function () {
  (this.timers || []).forEach(clearTimeout); this.timers = [];
  this.silence();
  if (this.card) this.unlightAll();
  if (this.playing) { this.held = []; if (this.head) this.apply(); }
  this.playing = false; this.playIcon(false);
};

FactCard.prototype.clear = function () {
  this.stop(); this.clearTap();
  this.resetMarks(); this.masked = {};
  this.over.querySelectorAll('.tl-fc-bubble').forEach(function (b) { b.remove(); });
  this.applyMasks(true); this.apply();
};
