/* ============================================================
   Beat grid component. Inputs: abc (one bar), meter, group, mode
   ('lecture' | 'practice'), tempo (crotchets per minute), playable,
   caption, compact. Commands: meter, subdivide, count, highlight,
   label, spotlight, caption, play, stop, clear, fit. Events (via
   onEvent): tileTap, beatTap, blankTap, countStep, playStart,
   playEnd. Sound goes through the injected source, lectures only.
   Colours come from the theme constants (--th-<name>) set on the
   page or stage around the grid.
   Time is counted in ticks: a semibreve is 6720 ticks, which divides
   evenly by every note value down to the hemidemisemiquaver and by
   triplets, quintuplets, sextuplets and septuplets.

   A bar is always shown whole: the grid never scrolls. fit(view) gives
   it the most room it may take ({width, height} in its own pixels, or
   null for its own size). When its own size is taller than that, it
   folds its words away (the room over the notes kept for labels, the
   labels, the beat numbers and the caption) and keeps the coloured
   blocks, the notes and the beat lines, so it is shorter; the region
   scales what is left.
   ============================================================ */
function BeatGrid(host, options) {
  this.host = host;
  this.o = Object.assign({ abc: '', meter: null, group: null, mode: 'lecture', tempo: 72, playable: false, caption: '', compact: false, sound: null, onEvent: function () {} }, options);
  this.held = {};
  this.marks = [];
  this.timers = [];
  this.tapTimers = [];
  this.voices = [];
  this.view = null;
  this.tight = false;
  this.tiles = BeatGrid.parse(this.o.abc);
  this.notesEnd = this.tiles.reduce(function (a, t) { return Math.max(a, t.t0 + t.dur); }, 0);
  this.m = BeatGrid.meterOf(this.o.meter, this.o.group);
  this.build();
}
BeatGrid.W = 6720;
BeatGrid.TAP_FADE_MS = 2000;
BeatGrid.NAMES = { 0.5: 'breve', 1: 'semibreve', 2: 'minim', 4: 'crotchet', 8: 'quaver', 16: 'semiquaver', 32: 'demisemiquaver', 64: 'hemidemisemiquaver' };
BeatGrid.STEPS = [0, 2, 4, 5, 7, 9, 11];
BeatGrid.ACC = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
BeatGrid.ICON_PLAY = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5v13l11-6.5z"/></svg>';
BeatGrid.ICON_STOP = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h4v12H5zM11 4h4v12h-4z"/></svg>';

// Splits a written length into a plain note value and its dots.
BeatGrid.shape = function (written) {
  var W = BeatGrid.W, f = [1, 1.5, 1.75];
  for (var d = 0; d < 3; d++) {
    var base = written / f[d], per = W / base;
    if (Math.abs(base - Math.round(base)) < 1e-6 && (per === .5 || (per >= 1 && Math.abs(Math.log2(per) - Math.round(Math.log2(per))) < 1e-9))) return { base: Math.round(base), per: per, dots: d };
  }
  return { base: written, per: W / written, dots: 0 };
};

BeatGrid.fraction = function (ticks) {
  var a = ticks, b = BeatGrid.W; var g = function (x, y) { return y ? g(y, x % y) : x; }; var c = g(a, b);
  return a / c + '/' + b / c;
};

BeatGrid.ticksOf = function (unit) {
  if (typeof unit === 'number') return unit;
  var p = String(unit).split('/'); return Math.round(BeatGrid.W * Number(p[0]) / Number(p[1] || 1));
};

// One bar of ABC to tiles: where each note or rest starts, how long it
// really lasts (tuplets applied), how it is written, its pitches for
// sound, its beam group, tuplet and tie.
BeatGrid.parse = function (abc) {
  var W = BeatGrid.W;
  var tune = ABCJS.parseOnly(abc)[0];
  var staff = tune.lines[0].staff[0];
  var keyAcc = {};
  ((staff.key && staff.key.accidentals) || []).forEach(function (a) { keyAcc[a.note.toUpperCase()] = BeatGrid.ACC[a.acc] || 0; });
  var barAcc = {}, tiles = [], t = 0, tup = null, tupId = 0, beam = null, beamId = 0;
  staff.voices[0].forEach(function (e) {
    if (e.el_type === 'bar') { barAcc = {}; return; }
    if (e.el_type !== 'note') return;
    if (e.startTriplet) tup = { id: tupId++, p: e.startTriplet, mult: e.tripletMultiplier };
    if (e.startBeam) beam = beamId++;
    var written = Math.round(e.duration * W);
    var dur = Math.round(e.duration * (tup ? tup.mult : 1) * W);
    var s = BeatGrid.shape(written);
    var tile = { i: tiles.length, t0: t, dur: dur, written: written, base: s.base, per: s.per, dots: s.dots, rest: !!e.rest, midi: [], tuplet: tup ? tup.id : null, tupletP: tup ? tup.p : null, beam: beam, tieNext: false, tiedFrom: false };
    (e.pitches || []).forEach(function (p) {
      var step = ((p.pitch % 7) + 7) % 7, oct = Math.floor(p.pitch / 7);
      var letter = 'CDEFGAB'[step], acc;
      if (p.accidental && BeatGrid.ACC[p.accidental] !== undefined) { acc = BeatGrid.ACC[p.accidental]; barAcc[p.pitch] = acc; }
      else if (barAcc[p.pitch] !== undefined) acc = barAcc[p.pitch];
      else acc = keyAcc[letter] || 0;
      tile.midi.push(60 + 12 * oct + BeatGrid.STEPS[step] + acc);
      if (p.startTie) tile.tieNext = true;
    });
    if (tiles.length && tiles[tiles.length - 1].tieNext) tile.tiedFrom = true;
    if (e.endBeam) beam = null;
    if (e.endTriplet) tup = null;
    t += dur;
    tiles.push(tile);
  });
  // A beam group with fewer than two notes is drawn with flags.
  var members = {};
  tiles.forEach(function (tl) { if (tl.beam !== null && !tl.rest) members[tl.beam] = (members[tl.beam] || 0) + 1; });
  tiles.forEach(function (tl) { if (tl.beam !== null && !(members[tl.beam] >= 2)) tl.beam = null; });
  return tiles;
};

// Time signature to beats. Six, nine and twelve are compound (dotted
// beats); five, seven, eight, ten and eleven quavers or semiquavers are
// grouped into twos and threes; everything else is one beat per count.
BeatGrid.meterOf = function (sig, group) {
  if (!sig) return null;
  if (sig === '?') return { sig: '?', unknown: true };
  var s = sig === 'C' ? '4/4' : (sig === '¢' || sig === 'C|') ? '2/2' : sig;
  var num = Number(s.split('/')[0]), den = Number(s.split('/')[1]);
  var unit = BeatGrid.W / den, beats;
  var DEFAULT = { 5: [3, 2], 7: [2, 2, 3], 8: [3, 3, 2], 10: [3, 3, 2, 2], 11: [3, 3, 3, 2] };
  if (group && group.length) beats = group.slice();
  else if (num > 3 && num % 3 === 0) beats = Array(num / 3).fill(3);
  else if (den >= 8 && DEFAULT[num]) beats = DEFAULT[num];
  else beats = Array(num).fill(1);
  var starts = [], t = 0;
  beats.forEach(function (b) { starts.push(t); t += b * unit; });
  return { sig: sig, num: num, den: den, unit: unit, beats: beats, starts: starts, total: num * unit, top: sig === 'C' || sig === '¢' || sig === 'C|' ? null : String(num), bottom: String(den) };
};

// Glyph shapes come from one hidden abcjs drawing of every note value
// and rest on a one-line staff; each is kept relative to its notehead's
// left edge (or the rest's left edge) and the staff line.
BeatGrid.glyphs = function () {
  if (BeatGrid._g) return BeatGrid._g;
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:1400px;visibility:hidden';
  document.body.appendChild(box);
  ABCJS.renderAbc(box, 'X:1\nL:1/64\nK:C clef=none stafflines=1\nV:1 stem=up\nB128 B64 B32 B16 B8 B4 B2 B B24 z128 z64 z32 z16 z8 z4 z2 z|', { add_classes: true, staffwidth: 1300 });
  var lb = box.querySelector('.abcjs-top-line').getBBox(), lineY = lb.y + lb.height / 2;
  var notes = box.querySelectorAll('.abcjs-note'), rests = box.querySelectorAll('.abcjs-rest');
  var PER = [.5, 1, 2, 4, 8, 16, 32, 64];
  var G = { notes: {}, rests: {}, lineY: lineY };
  var extras = function (g) { return [].filter.call(g.querySelectorAll('path'), function (p) { return !p.classList.contains('abcjs-notehead') && !p.classList.contains('abcjs-stem'); }); };
  PER.forEach(function (per, i) {
    var g = notes[i]; if (!g) return;
    var h = g.querySelector('.abcjs-notehead'); if (!h) return;
    var hb = h.getBBox();
    var e = { head: h.getAttribute('d'), rx: hb.x, w: hb.width };
    var st = g.querySelector('.abcjs-stem');
    if (st) { var sb = st.getBBox(); e.stem = st.getAttribute('d'); e.stemX = sb.x - hb.x; e.stemW = sb.width; }
    var ex = extras(g);
    if (ex.length) { var fb = ex[0].getBBox(); e.flag = ex[0].getAttribute('d'); e.flagRight = fb.x + fb.width - hb.x; }
    G.notes[per] = e;
  });
  var dg = notes[8];
  if (dg && dg.querySelector('.abcjs-notehead')) {
    var dh = dg.querySelector('.abcjs-notehead').getBBox(), dot = extras(dg)[0];
    if (dot) { var db = dot.getBBox(); G.dot = { d: dot.getAttribute('d'), rx: db.x, ry: lineY, dx: db.x - dh.x - dh.width, w: db.width }; }
  }
  // abcjs draws no single glyph for a breve rest, so that one is left out.
  PER.forEach(function (per, i) {
    var g = rests[i]; if (!g) return;
    var p = g.querySelector('path'); if (!p) return;
    var b = p.getBBox();
    G.rests[per] = { d: p.getAttribute('d'), rx: b.x, w: b.width };
  });
  box.remove();
  return (BeatGrid._g = G);
};

BeatGrid.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };
BeatGrid.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
BeatGrid.prototype.known = function () { return !!this.m && !this.m.unknown; };
BeatGrid.prototype.extent = function () { return Math.max(this.notesEnd, this.known() ? this.m.total : 0); };
BeatGrid.prototype.secs = function (ticks) { return ticks / (BeatGrid.W / 4) * 60 / this.o.tempo; };

// Every note the grid sounds goes through here, so stop() can silence
// the notes and beat clicks already scheduled ahead on the audio clock.
BeatGrid.prototype.note = function (midi, delay, dur, velocity) {
  var v = this.o.sound.play(midi, delay, dur, velocity);
  if (v) this.voices.push(v);
};
BeatGrid.prototype.silence = function () {
  (this.voices || []).forEach(function (v) { v.stop(); });
  this.voices = [];
};

BeatGrid.prototype.nameOf = function (tl) {
  var n = BeatGrid.NAMES[tl.per] || '';
  return (tl.dots === 2 ? 'double-dotted ' : tl.dots === 1 ? 'dotted ' : '') + n + (tl.rest ? ' rest' : '');
};

// How wide a tile must be for its glyph to stay readable, in pixels.
// Beamed notes need only their head; flags and rests need a little more.
BeatGrid.prototype.minWidth = function (tl, k) {
  var G = BeatGrid.glyphs();
  if (tl.rest) { var r = G.rests[tl.per] || G.rests[4]; return (r.w + (tl.dots ? 6 : 0)) * k + 10; }
  var n = G.notes[tl.per] || G.notes[4];
  var w = n.w + (tl.dots ? 5 * tl.dots + 2 : 0);
  if (tl.beam === null && n.flag) return Math.max(w, n.flagRight + 2) * k + 10;
  return w * k + 7;
};

// Rows: one row when every tile fits its minimum width across the space
// given; otherwise rows break at beats (at tiles when there is no
// meter), and only a single beat too wide for the space shrinks.
BeatGrid.prototype.layout = function (width) {
  var self = this, ext = this.extent();
  var k = this.o.compact ? 1.1 : (width < 480 ? 1.25 : 1.5);
  var gutter = this.m ? (this.o.compact ? 30 : 40) : 12;
  var avail = Math.max(60, width - gutter - 14);
  var need = 0;
  this.tiles.forEach(function (tl) { need = Math.max(need, self.minWidth(tl, k) / tl.dur); });
  var cuts = [0];
  if (this.known()) this.m.starts.slice(1).forEach(function (s) { if (s < ext) cuts.push(s); });
  this.tiles.forEach(function (tl) { if (!self.known() || tl.t0 >= self.m.total) cuts.push(tl.t0); });
  if (this.known() && this.m.total < ext) cuts.push(this.m.total);
  cuts = cuts.filter(function (c, i, a) { return a.indexOf(c) === i && c < ext; }).sort(function (a, b) { return a - b; });
  cuts.push(ext);
  var per = avail / ext;
  var rows;
  if (per >= need) rows = [[0, ext]];
  else {
    per = need;
    var longest = 0;
    for (var i = 1; i < cuts.length; i++) longest = Math.max(longest, cuts[i] - cuts[i - 1]);
    if (longest * per > avail) { k = Math.max(.8, k * (avail / (longest * per))); per = avail / longest; }
    rows = []; var start = 0;
    for (var j = 1; j < cuts.length; j++) {
      if ((cuts[j] - start) * per > avail + .5 && cuts[j - 1] > start) { rows.push([start, cuts[j - 1]]); start = cuts[j - 1]; }
    }
    rows.push([start, ext]);
  }
  return { rows: rows, per: per, k: k, gutter: gutter };
};

// Vertical positions inside a row, from the glyph scale; folded, the
// room over the notes kept for labels goes.
BeatGrid.prototype.metrics = function (k) {
  var top = this.tight ? (this.o.compact ? 6 : 8) : (this.o.compact ? 22 : 28);
  var lineY = top + 20 + 32 * k;
  var ribbonY = lineY + 19 * k, ribbonH = this.o.compact ? 9 : 12;
  var rulerY = ribbonY + ribbonH + 8, rulerH = this.o.compact ? 24 : 30;
  return { top: top, lineY: lineY, beamTop: lineY - 31 * k, ribbonY: ribbonY, ribbonH: ribbonH, rulerY: rulerY, rulerH: rulerH, height: rulerY + rulerH + 2 };
};

BeatGrid.prototype.build = function () {
  var self = this;
  this.stop(); this.clearTap();
  this.host.classList.add('tl-bg');
  this.host.classList.toggle('tl-tight', !!this.tight);
  this.host.innerHTML = '';
  this.card = document.createElement('div'); this.card.className = 'tl-card'; this.card.tabIndex = 0;
  this.card.setAttribute('role', 'group'); this.card.setAttribute('aria-label', '节拍格');
  this.rowsEl = document.createElement('div'); this.rowsEl.className = 'tl-rows';
  this.card.appendChild(this.rowsEl);
  this.host.appendChild(this.card);
  this.overlay = document.createElement('div'); this.overlay.className = 'tl-overlay';
  this.host.appendChild(this.overlay);
  if (this.o.caption) { var c = document.createElement('p'); c.className = 'tl-caption'; c.textContent = this.o.caption; this.host.appendChild(c); }

  var playable = this.o.playable && this.o.mode === 'lecture';
  var width = Math.max(140, (this.host.clientWidth || 300) - 20);
  var L = this.layout(width);
  this.L = L; this.M = this.metrics(L.k);
  this.tiles.forEach(function (tl) { delete tl.row; });
  this.rows = L.rows.map(function (r, idx) { return self.drawRow(r[0], r[1], idx); });
  if (playable) {
    this.card.style.paddingTop = '46px';
    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button'; this.playBtn.className = 'tl-play'; this.playBtn.setAttribute('aria-label', '播放');
    this.playBtn.innerHTML = BeatGrid.ICON_PLAY;
    this.playBtn.addEventListener('click', function (ev) { ev.stopPropagation(); if (self.playing) self.stop(); else self.play(); });
    this.playBtn.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    this.card.appendChild(this.playBtn);
  } else this.playBtn = null;
  this.card.addEventListener('pointerdown', function (ev) { self.host.classList.remove('kbd'); self.onPointer(ev); });
  this.card.addEventListener('keydown', function (ev) { self.onKey(ev); });
  this.card.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') self.host.classList.add('kbd'); });
  this.restore();
};

// The room it is given: folded when its own size is taller than the
// view, at its own size otherwise. Its own height is measured while it
// stands at its own size, so a view that does not change leaves it as
// it is.
BeatGrid.prototype.fit = function (view) {
  this.view = view && view.height > 0 ? { width: view.width, height: view.height } : null;
  var own = this.tight ? this.ownHeight : this.host.offsetHeight;
  var want = !!this.view && own > this.view.height + .5;
  if (want === this.tight) return;
  if (want) this.ownHeight = own;
  this.tight = want;
  this.build();
};
// Lays the grid out at its own size, then folds it when the view is
// smaller than that.
BeatGrid.prototype.relay = function () {
  this.tight = false;
  this.build();
  if (!this.view || this.host.offsetHeight <= this.view.height + .5) return;
  this.ownHeight = this.host.offsetHeight;
  this.tight = true;
  this.build();
};

BeatGrid.prototype.x = function (row, t) { return this.L.gutter + (t - row.t0) * this.L.per; };

BeatGrid.prototype.glyphPath = function (d, rx, ry, x, y, k, cls) {
  return '<path class="' + cls + '" d="' + d + '" transform="translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') scale(' + k.toFixed(3) + ') translate(' + (-rx).toFixed(2) + ' ' + (-ry).toFixed(2) + ')"/>';
};

BeatGrid.prototype.beamRect = function (x1, x2, y, th) {
  return '<rect class="tl-beam" x="' + x1.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + Math.max(1, x2 - x1).toFixed(2) + '" height="' + th.toFixed(2) + '"/>';
};

// Draws one row: guides, the one-line staff, every tile that starts or
// continues in it (glyph, stem, ribbon), beams, ties, tuplets, barlines,
// the ruler with its beats, and the time signature on the first row.
BeatGrid.prototype.drawRow = function (t0, t1, idx) {
  var self = this, G = BeatGrid.glyphs(), L = this.L, M = this.M, k = L.k;
  var row = { t0: t0, t1: t1, idx: idx };
  var w = Math.ceil(this.x(row, t1) + 12);
  var el = document.createElement('div'); el.className = 'tl-row';
  el.style.width = w + 'px'; el.style.height = M.height + 'px';
  var ruler = document.createElement('div'); ruler.className = 'tl-ruler';
  ruler.style.left = (L.gutter - 4) + 'px'; ruler.style.width = (this.x(row, t1) - L.gutter + 8) + 'px';
  ruler.style.top = M.rulerY + 'px'; ruler.style.height = M.rulerH + 'px';
  el.appendChild(ruler);
  var s = [];
  var known = this.known(), m = this.m;

  // Beat cells, ticks and numbers on the ruler; dotted guides up through the staff.
  if (known) {
    m.starts.forEach(function (bs, bi) {
      var be = bs + m.beats[bi] * m.unit;
      if (be <= t0 || bs >= t1) return;
      var a = self.x(row, Math.max(bs, t0)), b = self.x(row, Math.min(be, t1));
      s.push('<rect class="tl-cell" data-beat="' + (bi + 1) + '" x="' + a + '" y="' + M.rulerY + '" width="' + (b - a) + '" height="' + M.rulerH + '" opacity="' + (bi % 2 ? .35 : 1) + '"/>');
      if (bs >= t0) {
        s.push('<line class="tl-tick tl-beat" x1="' + a + '" x2="' + a + '" y1="' + M.rulerY + '" y2="' + (M.rulerY + M.rulerH) + '"/>');
        s.push('<text class="tl-beatno" x="' + (a + 5) + '" y="' + (M.rulerY + M.rulerH - 7) + '">' + (bi + 1) + '</text>');
        s.push('<line class="tl-guide tl-major" x1="' + a + '" x2="' + a + '" y1="' + (M.beamTop - 6) + '" y2="' + (M.ribbonY + M.ribbonH + 4) + '"/>');
      }
      for (var u = bs + m.unit; u < be - 1; u += m.unit) {
        if (u <= t0 || u >= t1) continue;
        var ux = self.x(row, u);
        s.push('<line class="tl-tick" x1="' + ux + '" x2="' + ux + '" y1="' + M.rulerY + '" y2="' + (M.rulerY + M.rulerH * .35) + '"/>');
      }
    });
  }
  s.push('<line class="tl-staff" x1="' + (L.gutter - 6) + '" x2="' + (this.x(row, t1) + 4) + '" y1="' + M.lineY + '" y2="' + M.lineY + '"/>');

  // Time signature, on the first row only.
  if (idx === 0 && m) {
    var gx = L.gutter / 2 - 2, fs = this.o.compact ? 20 : 15 + 6 * k;
    if (m.unknown) s.push('<text class="tl-sig tl-unknown" text-anchor="middle" x="' + gx + '" y="' + (M.lineY + fs * .36) + '" font-size="' + fs * 1.5 + '">?</text>');
    else if (!m.top) s.push('<text class="tl-sig" text-anchor="middle" x="' + gx + '" y="' + (M.lineY + fs * .38) + '" font-size="' + fs * 1.6 + '">' + (m.sig === 'C' ? 'C' : '¢') + '</text>');
    else {
      s.push('<text class="tl-sig" text-anchor="middle" x="' + gx + '" y="' + (M.lineY - 3) + '" font-size="' + fs + '">' + m.top + '</text>');
      s.push('<text class="tl-sig" text-anchor="middle" x="' + gx + '" y="' + (M.lineY + fs * .78) + '" font-size="' + fs + '">' + m.bottom + '</text>');
    }
  }

  // Tiles: the glyph where the tile starts, its ribbon in every row it covers.
  var overFrom = known && m.total < this.notesEnd ? m.total : Infinity;
  this.tiles.forEach(function (tl) {
    var a0 = tl.t0, a1 = tl.t0 + tl.dur;
    if (a1 <= t0 || a0 >= t1) return;
    var first = a0 >= t0;
    var over = a1 > overFrom;
    var xa = self.x(row, Math.max(a0, t0)), xb = self.x(row, Math.min(a1, t1));
    var p = ['<g class="tl-part' + (tl.rest ? ' tl-rest' : '') + (over ? ' tl-over' : '') + '" data-i="' + tl.i + '">'];
    var ribX = xa + (first ? 1 : 0), ribW = Math.max(3, xb - xa - (a1 <= t1 ? 3 : 0) - (first ? 1 : 0));
    p.push('<rect class="tl-ribbon" x="' + ribX + '" y="' + M.ribbonY + '" width="' + ribW + '" height="' + M.ribbonH + '" rx="' + (first ? M.ribbonH / 2 : 1) + '"/>');
    p.push('<rect class="tl-ribbon-hi" x="' + (ribX + 3) + '" y="' + (M.ribbonY + 2) + '" width="' + Math.max(0, ribW - 6) + '" height="2" rx="1"/>');
    if (first) {
      var hx = xa + 4;
      tl.row = idx; tl.hx = hx;
      if (tl.rest) {
        var r = G.rests[tl.per] || G.rests[4];
        p.push(self.glyphPath(r.d, r.rx, G.lineY, hx, M.lineY, k, 'tl-glyph'));
        tl.hw = r.w * k;
        if (tl.dots && G.dot) for (var dr = 0; dr < tl.dots; dr++) p.push(self.glyphPath(G.dot.d, G.dot.rx, G.dot.ry, hx + (r.w + 3 + dr * 5) * k, M.lineY - 4 * k, k, 'tl-glyph'));
      } else {
        var n = G.notes[tl.per] || G.notes[4];
        p.push(self.glyphPath(n.head, n.rx, G.lineY, hx, M.lineY, k, 'tl-glyph'));
        tl.hw = n.w * k;
        if (n.stem) {
          if (tl.beam === null) {
            p.push(self.glyphPath(n.stem, n.rx, G.lineY, hx, M.lineY, k, 'tl-stem'));
            if (n.flag) p.push(self.glyphPath(n.flag, n.rx, G.lineY, hx, M.lineY, k, 'tl-glyph'));
          } else {
            var sx = hx + n.stemX * k, sw = Math.max(1.2, n.stemW * k);
            p.push('<rect class="tl-stem" x="' + sx.toFixed(2) + '" y="' + M.beamTop.toFixed(2) + '" width="' + sw.toFixed(2) + '" height="' + (M.lineY - M.beamTop - 1).toFixed(2) + '"/>');
            tl.sx = sx; tl.sw = sw;
          }
        }
        if (tl.dots && G.dot) for (var dd = 0; dd < tl.dots; dd++) p.push(self.glyphPath(G.dot.d, G.dot.rx, G.dot.ry, hx + (n.w + G.dot.dx + dd * 5) * k, M.lineY, k, 'tl-glyph'));
      }
    }
    p.push('</g>');
    s.push(p.join(''));
  });

  // Beams: the primary beam joins the group; shorter values add beams
  // between neighbours, or a short stub when a note stands alone.
  var groups = {};
  this.tiles.forEach(function (tl) { if (tl.beam !== null && !tl.rest && tl.row === idx && tl.t0 >= t0 && tl.t0 < t1) (groups[tl.beam] = groups[tl.beam] || []).push(tl); });
  Object.keys(groups).forEach(function (gid) {
    var g = groups[gid];
    var th = 3.6 * k, gap = 6 * k;
    if (g.length < 2) {
      var only = g[0], lv = Math.max(1, Math.log2(only.per) - 2);
      for (var q = 0; q < lv; q++) s.push(self.beamRect(only.sx, only.sx + 10 * k, M.beamTop + q * gap, th));
      return;
    }
    var levels = g.map(function (tl) { return Math.max(1, Math.log2(tl.per) - 2); });
    var maxL = Math.max.apply(null, levels);
    for (var lvl = 1; lvl <= maxL; lvl++) {
      var y = M.beamTop + (lvl - 1) * gap;
      for (var i = 0; i < g.length; i++) {
        if (levels[i] < lvl) continue;
        if (i + 1 < g.length && levels[i + 1] >= lvl) { s.push(self.beamRect(g[i].sx, g[i + 1].sx + g[i + 1].sw, y, th)); continue; }
        if ((i === 0 || levels[i - 1] < lvl) && lvl > 1) {
          var len = 8 * k;
          if (i > 0) s.push(self.beamRect(g[i].sx - len, g[i].sx + g[i].sw, y, th));
          else s.push(self.beamRect(g[i].sx, g[i].sx + len, y, th));
        }
      }
    }
  });

  // Ties between heads in this row.
  this.tiles.forEach(function (tl, i) {
    var nx = self.tiles[i + 1];
    if (!tl.tieNext || !nx || tl.row !== idx || nx.row !== idx) return;
    var xa = tl.hx + tl.hw * .7, xb = nx.hx + nx.hw * .3, y = M.lineY + 6 * k;
    s.push('<path class="tl-tie" d="M' + xa + ' ' + y + ' Q ' + (xa + xb) / 2 + ' ' + (y + 7 * k) + ' ' + xb + ' ' + y + '"/>');
  });

  // Tuplets: the number alone over a single beamed group, otherwise a bracket.
  var tups = {};
  this.tiles.forEach(function (tl) { if (tl.tuplet !== null && tl.row === idx && tl.t0 >= t0 && tl.t0 < t1) (tups[tl.tuplet] = tups[tl.tuplet] || []).push(tl); });
  Object.keys(tups).forEach(function (id) {
    var g = tups[id], a = g[0], z = g[g.length - 1];
    var beamed = g.every(function (tl) { return !tl.rest && tl.beam !== null && tl.beam === a.beam; });
    var xa = a.hx, xb = z.hx + z.hw, mid = (xa + xb) / 2, y = M.beamTop - 8;
    if (!beamed) s.push('<path class="tl-bracket" d="M' + xa + ' ' + (y + 5) + ' V ' + y + ' H ' + (mid - 8) + ' M ' + (mid + 8) + ' ' + y + ' H ' + xb + ' V ' + (y + 5) + '"/>');
    s.push('<text class="tl-tupno" text-anchor="middle" x="' + mid + '" y="' + (y + 5) + '">' + a.tupletP + '</text>');
  });

  // Barlines: the end of the written bar, the end the meter expects
  // when it is earlier, and a dashed box for time the bar is missing.
  if (this.notesEnd > t0 && this.notesEnd <= t1) {
    var bx = this.x(row, this.notesEnd) - 1;
    s.push('<line class="tl-barline" x1="' + bx + '" x2="' + bx + '" y1="' + (M.lineY - 13 * k) + '" y2="' + (M.lineY + 13 * k) + '"/>');
  }
  if (known && m.total < this.notesEnd && m.total > t0 && m.total <= t1) {
    var wx = this.x(row, m.total) - 1;
    s.push('<line class="tl-barline tl-warnline" x1="' + wx + '" x2="' + wx + '" y1="' + (M.beamTop - 4) + '" y2="' + (M.rulerY + M.rulerH) + '"/>');
  }
  if (known && m.total > this.notesEnd) {
    var ma = Math.max(this.notesEnd, t0), mb = Math.min(m.total, t1);
    if (mb > ma) s.push('<rect class="tl-missing" x="' + (this.x(row, ma) + 2) + '" y="' + (M.lineY - 16 * k) + '" width="' + (this.x(row, mb) - this.x(row, ma) - 4) + '" height="' + (M.ribbonY + M.ribbonH - M.lineY + 16 * k) + '" rx="6"/>');
  }

  el.insertAdjacentHTML('beforeend', '<svg width="' + w + '" height="' + M.height + '" aria-hidden="true">' + s.join('') + '<g class="tl-marks"></g></svg>');
  var head = document.createElement('div'); head.className = 'tl-playhead';
  head.style.top = (M.beamTop - 8) + 'px'; head.style.height = (M.rulerY + M.rulerH - M.beamTop + 8) + 'px';
  el.appendChild(head);
  this.rowsEl.appendChild(el);
  row.el = el; row.marks = el.querySelector('.tl-marks'); row.playhead = head;
  return row;
};

BeatGrid.prototype.parts = function (i) { return this.host.querySelectorAll('.tl-part[data-i="' + i + '"]'); };
BeatGrid.prototype.lit = function (is) { var self = this; is.forEach(function (i) { self.parts(i).forEach(function (p) { p.classList.add('tl-lit'); }); }); };
BeatGrid.prototype.unlit = function (is) { var self = this; is.forEach(function (i) { self.parts(i).forEach(function (p) { p.classList.remove('tl-lit'); }); }); };

// Which row and time a point inside the card falls on.
BeatGrid.prototype.locate = function (cx, cy) {
  for (var r = 0; r < this.rows.length; r++) {
    var row = this.rows[r], b = row.el.getBoundingClientRect();
    if (cy < b.top - 5 || cy > b.bottom + 5) continue;
    var x = cx - b.left, y = cy - b.top;
    if (x < this.L.gutter - 6 || x > this.x(row, row.t1) + 6) return null;
    var t = row.t0 + (x - this.L.gutter) / this.L.per;
    return { row: row, t: Math.max(row.t0, Math.min(row.t1 - 1, t)), x: x, y: y };
  }
  return null;
};

BeatGrid.prototype.tileAt = function (t) {
  for (var i = 0; i < this.tiles.length; i++) { var tl = this.tiles[i]; if (t >= tl.t0 && t < tl.t0 + tl.dur) return tl; }
  return null;
};
BeatGrid.prototype.beatAt = function (t) {
  if (!this.known() || t >= this.m.total) return null;
  for (var i = this.m.starts.length - 1; i >= 0; i--) if (t >= this.m.starts[i]) return i + 1;
  return null;
};

BeatGrid.prototype.onPointer = function (ev) {
  var p = this.locate(ev.clientX, ev.clientY);
  if (!p || p.y < this.M.top - 6) { this.blankTap(); return; }
  if (this.o.mode !== 'lecture') { ev.preventDefault(); return; }
  if (p.y >= this.M.rulerY - 4) {
    var b = this.beatAt(p.t);
    if (b) this.tapBeat(b); else this.blankTap();
    return;
  }
  var tl = this.tileAt(p.t);
  if (tl) this.tap(tl.i); else this.blankTap();
};

BeatGrid.prototype.onKey = function (ev) {
  var n = this.tiles.length; if (!n) return;
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
    ev.preventDefault();
    var cur = this.focusI === undefined ? -1 : this.focusI;
    var next = Math.max(0, Math.min(n - 1, cur + (ev.key === 'ArrowRight' ? 1 : -1)));
    this.focusI = next;
    if (this.o.mode === 'lecture') this.tap(next);
  } else if ((ev.key === 'Enter' || ev.key === ' ') && this.focusI !== undefined) {
    ev.preventDefault(); if (this.o.mode === 'lecture') this.tap(this.focusI);
  } else if (ev.key === 'Escape') this.blankTap();
};

// A tap lights the tile, plays it for its real length, and reports it;
// the light and any caption fade by themselves after a moment.
BeatGrid.prototype.tap = function (i) {
  var self = this, tl = this.tiles[i]; if (!tl) return;
  this.clearTap();
  this.tapLit = i;
  this.lit([i]);
  var w = this.where(i); if (w) this.ripple(w.x, w.lineY);
  if (this.audible() && !tl.rest) { var secs = this.secs(tl.dur); tl.midi.forEach(function (m) { self.note(m, 0, Math.max(.25, secs), .75); }); }
  var beats = this.known() ? Math.round(tl.dur / (this.m.total / this.m.beats.length) * 100) / 100 : null;
  this.emit('tileTap', { index: i, rest: tl.rest, name: this.nameOf(tl), dur: BeatGrid.fraction(tl.dur), written: BeatGrid.fraction(tl.written), tuplet: tl.tupletP, beats: beats });
  this.fadeLater(function () { if (!self.held[i]) self.unlit([i]); });
};

BeatGrid.prototype.tapBeat = function (b) {
  this.clearTap();
  var cells = this.host.querySelectorAll('.tl-cell[data-beat="' + b + '"]');
  cells.forEach(function (c) { c.classList.add('tl-lit'); });
  this.tapCells = cells;
  this.emit('beatTap', { beat: b, of: this.m.beats.length });
  this.fadeLater(function () { cells.forEach(function (c) { c.classList.remove('tl-lit'); }); });
};

BeatGrid.prototype.fadeLater = function (fn) {
  var self = this;
  this.tapTimers.push(setTimeout(function () { fn(); self.overlay.querySelectorAll('.tl-bubble').forEach(function (b) { b.classList.add('out'); }); }, BeatGrid.TAP_FADE_MS));
  this.tapTimers.push(setTimeout(function () { self.overlay.querySelectorAll('.tl-bubble.out').forEach(function (b) { b.remove(); }); }, BeatGrid.TAP_FADE_MS + 600));
};

BeatGrid.prototype.blankTap = function () { this.clearTap(); this.emit('blankTap', {}); };

BeatGrid.prototype.clearTap = function () {
  (this.tapTimers || []).forEach(clearTimeout); this.tapTimers = [];
  if (this.tapLit !== undefined && this.tapLit !== null && !this.held[this.tapLit]) this.unlit([this.tapLit]);
  this.tapLit = null;
  if (this.tapCells) { this.tapCells.forEach(function (c) { c.classList.remove('tl-lit'); }); this.tapCells = null; }
  if (this.overlay) this.overlay.querySelectorAll('.tl-bubble').forEach(function (b) { b.remove(); });
};

// Where a tile's glyph sits, in pixels inside the component.
BeatGrid.prototype.where = function (i) {
  var tl = this.tiles[i]; if (!tl || tl.row === undefined || !this.rows[tl.row]) return null;
  var row = this.rows[tl.row], host = this.host.getBoundingClientRect(), b = row.el.getBoundingClientRect();
  var k = host.width / (this.host.offsetWidth || 1) || 1;
  var ox = (b.left - host.left) / k, oy = (b.top - host.top) / k;
  return { x: ox + tl.hx + tl.hw / 2, top: oy + this.M.top, lineY: oy + this.M.lineY, beamTop: oy + this.M.beamTop, rulerY: oy + this.M.rulerY };
};

BeatGrid.prototype.ripple = function (x, y) {
  var r = document.createElement('div'); r.className = 'tl-ripple';
  r.style.left = x + 'px'; r.style.top = y + 'px';
  this.overlay.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

// Marks the workflow asked for survive a rebuild (a resize re-lays the
// rows); they are drawn again at once, without animation or sound.
BeatGrid.prototype.remember = function (name, args) { this.marks.push([name, args]); };
BeatGrid.prototype.restore = function () {
  var self = this, keep = this.marks || [];
  this.marks = [];
  this.lit(Object.keys(this.held).map(Number));
  keep.forEach(function (mk) { self[mk[0]].apply(self, mk[1].concat([true])); });
};

// A new meter re-lays the grid; labels stay, marks tied to the old beats go.
BeatGrid.prototype.meter = function (sig, group) {
  this.m = BeatGrid.meterOf(sig, group);
  this.marks = this.marks.filter(function (mk) { return mk[0] === 'label'; });
  this.relay();
};

BeatGrid.prototype.highlight = function (is) {
  this.unlit(Object.keys(this.held).map(Number));
  var held = {}; is.forEach(function (i) { held[i] = true; }); this.held = held;
  this.lit(is);
};

BeatGrid.prototype.label = function (i, text, quiet) {
  var w = this.where(i); if (!w) return;
  this.remember('label', [i, text]);
  var b = document.createElement('span'); b.className = 'tl-badge tl-mark'; b.textContent = text;
  b.style.left = w.x + 'px'; b.style.top = (w.top - 12 + (this.o.compact ? 2 : 0)) + 'px';
  b.style.animationDelay = quiet ? '0ms' : (this.marks.length % 8) * 70 + 'ms';
  this.overlay.appendChild(b);
};

// Draws the boundaries of a smaller unit on the ruler, e.g. semiquavers.
BeatGrid.prototype.subdivide = function (unit) {
  var self = this, u = BeatGrid.ticksOf(unit); if (!u) return;
  this.remember('subdivide', [unit]);
  this.rows.forEach(function (row) {
    var s = [];
    for (var t = Math.ceil(row.t0 / u) * u; t <= row.t1 && t <= self.extent(); t += u) {
      var x = self.x(row, t);
      s.push('<line class="tl-tick tl-sub" x1="' + x + '" x2="' + x + '" y1="' + (self.M.rulerY - 3) + '" y2="' + (self.M.rulerY + self.M.rulerH * .55) + '"/>');
    }
    row.marks.insertAdjacentHTML('beforeend', s.join(''));
  });
};

// Counts how many of one unit fit across some tiles: each cell lights
// on the ruler with its number, in turn, sounding the tile above it.
BeatGrid.prototype.count = function (unit, from, to, quiet) {
  var self = this; this.clearTimers();
  var u = BeatGrid.ticksOf(unit); if (!u) return;
  from = from === undefined ? 0 : from; to = to === undefined ? this.tiles.length - 1 : to;
  var ta = this.tiles[from].t0, tb = this.tiles[to].t0 + this.tiles[to].dur;
  var total = Math.floor((tb - ta) / u + 1e-6);
  this.remember('count', [unit, from, to]);
  var instant = quiet || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var range = []; for (var r = from; r <= to; r++) range.push(r);
  this.highlight(range);
  for (var n = 1; n <= total; n++) (function (n) {
    var step = function () {
      var c0 = ta + (n - 1) * u, c1 = c0 + u;
      self.rows.forEach(function (row) {
        if (c1 <= row.t0 || c0 >= row.t1) return;
        var a = self.x(row, Math.max(c0, row.t0)), b = self.x(row, Math.min(c1, row.t1));
        row.marks.insertAdjacentHTML('beforeend', '<rect class="tl-unit" x="' + (a + 1) + '" y="' + (self.M.rulerY + 2) + '" width="' + Math.max(2, b - a - 2) + '" height="' + (self.M.rulerH - 4) + '" rx="4"/>' +
          (c0 >= row.t0 ? '<text class="tl-countno" text-anchor="middle" x="' + (a + b) / 2 + '" y="' + (self.M.rulerY + self.M.rulerH / 2 + 6) + '">' + n + '</text>' : ''));
      });
      var under = self.tileAt(c0);
      if (!quiet && self.audible() && under && !under.rest) under.midi.forEach(function (m) { self.note(m, 0, .22, .55); });
      if (!quiet) self.emit('countStep', { n: n, total: total });
    };
    if (instant) step(); else self.timers.push(setTimeout(step, n * 520));
  })(n);
};

// Dims everything outside some beats ({beats: [from, to]}) or some
// tiles ({tiles: [from, to]}) and lays a soft light over the rest.
BeatGrid.prototype.spotlight = function (range) {
  var self = this;
  this.overlay.querySelectorAll('.tl-spot').forEach(function (s) { s.remove(); });
  this.host.querySelectorAll('.tl-dim').forEach(function (e) { e.classList.remove('tl-dim'); });
  if (!range) { this.marks = this.marks.filter(function (mk) { return mk[0] !== 'spotlight'; }); return; }
  var ta, tb;
  if (range.beats && this.known()) { var b0 = range.beats[0] - 1, b1 = range.beats[1] - 1; ta = this.m.starts[b0]; tb = this.m.starts[b1] + this.m.beats[b1] * this.m.unit; }
  else if (range.tiles) { ta = this.tiles[range.tiles[0]].t0; var z = this.tiles[range.tiles[1]]; tb = z.t0 + z.dur; }
  else return;
  this.remember('spotlight', [range]);
  this.tiles.forEach(function (tl) { if (tl.t0 + tl.dur <= ta || tl.t0 >= tb) self.parts(tl.i).forEach(function (p) { p.classList.add('tl-dim'); }); });
  if (this.known()) this.host.querySelectorAll('.tl-cell').forEach(function (c) { var s = self.m.starts[Number(c.dataset.beat) - 1]; if (s < ta || s >= tb) c.classList.add('tl-dim'); });
  var host = this.host.getBoundingClientRect(), k = host.width / (this.host.offsetWidth || 1) || 1;
  this.rows.forEach(function (row) {
    if (tb <= row.t0 || ta >= row.t1) return;
    var b = row.el.getBoundingClientRect();
    var a = self.x(row, Math.max(ta, row.t0)), z2 = self.x(row, Math.min(tb, row.t1));
    var sp = document.createElement('div'); sp.className = 'tl-spot';
    sp.style.left = ((b.left - host.left) / k + a - 6) + 'px'; sp.style.width = (z2 - a + 12) + 'px';
    sp.style.top = ((b.top - host.top) / k + self.M.beamTop - 14) + 'px'; sp.style.height = (self.M.rulerY + self.M.rulerH - self.M.beamTop + 20) + 'px';
    self.overlay.appendChild(sp);
    requestAnimationFrame(function () { requestAnimationFrame(function () { sp.classList.add('on'); }); });
  });
};

BeatGrid.prototype.bubbleAt = function (x, y, html) {
  this.overlay.querySelectorAll('.tl-bubble').forEach(function (e) { e.remove(); });
  var d = document.createElement('div'); d.className = 'tl-bubble'; d.innerHTML = html;
  d.style.left = Math.max(90, Math.min(this.host.clientWidth - 90, x)) + 'px'; d.style.top = y + 'px';
  this.overlay.appendChild(d);
};
BeatGrid.prototype.caption = function (i, html) {
  var w = this.where(i); if (w) this.bubbleAt(w.x, w.beamTop - 12, html);
};
BeatGrid.prototype.captionBeat = function (b, html) {
  var cell = this.host.querySelector('.tl-cell[data-beat="' + b + '"]'); if (!cell) return;
  var host = this.host.getBoundingClientRect(), r = cell.getBoundingClientRect(), k = host.width / (this.host.offsetWidth || 1) || 1;
  this.bubbleAt((r.left - host.left + r.width / 2) / k, (r.top - host.top) / k - 6, html);
};

// Plays the bar at its tempo: notes sound for their real length (tied
// notes as one), a light playhead sweeps the rows, each beat cell
// pulses and, with pulse on, a soft low note marks every beat.
BeatGrid.prototype.play = function (opts) {
  var self = this; this.stop();
  if (!this.audible()) return;
  var pulse = opts && opts.pulse !== undefined ? opts.pulse : this.known();
  var lead = .15;
  this.playing = true;
  if (this.playBtn) this.playBtn.innerHTML = BeatGrid.ICON_STOP;
  this.emit('playStart', {});
  this.tiles.forEach(function (tl, i) {
    if (!tl.rest && !tl.tiedFrom) {
      var len = tl.dur, j = i;
      while (self.tiles[j].tieNext && self.tiles[j + 1]) { j++; len += self.tiles[j].dur; }
      tl.midi.forEach(function (m) { self.note(m, lead + self.secs(tl.t0), self.secs(len) * .95, .75); });
    }
    self.timers.push(setTimeout(function () { self.lit([tl.i]); }, (lead + self.secs(tl.t0)) * 1000));
    self.timers.push(setTimeout(function () { if (!self.held[tl.i]) self.unlit([tl.i]); }, (lead + self.secs(tl.t0 + tl.dur)) * 1000 - 30));
  });
  if (this.known()) this.m.starts.forEach(function (bs, bi) {
    if (pulse) self.note(bi === 0 ? 43 : 48, lead + self.secs(bs), .18, bi === 0 ? .42 : .3);
    self.timers.push(setTimeout(function () {
      self.host.querySelectorAll('.tl-cell[data-beat="' + (bi + 1) + '"]').forEach(function (c) { c.classList.remove('tl-pulse'); void c.getBBox(); c.classList.add('tl-pulse'); });
    }, (lead + self.secs(bs)) * 1000));
  });
  var ext = this.extent(), started = performance.now() + lead * 1000;
  var frame = function () {
    if (!self.playing) return;
    var t = Math.max(0, (performance.now() - started) / 1000) / self.secs(BeatGrid.W) * BeatGrid.W;
    self.rows.forEach(function (row) {
      var on = t >= row.t0 && t < row.t1;
      row.playhead.classList.toggle('on', on);
      if (on) row.playhead.style.left = self.x(row, t) + 'px';
    });
    if (t < ext) self.raf = requestAnimationFrame(frame);
  };
  this.raf = requestAnimationFrame(frame);
  this.timers.push(setTimeout(function () { self.voices = []; self.stop(); self.emit('playEnd', {}); }, (lead + this.secs(ext)) * 1000 + 200));
};

BeatGrid.prototype.clearTimers = function () { (this.timers || []).forEach(clearTimeout); this.timers = []; };

// Stops a playback or a count: timers are cleared and every note still
// queued or sounding is silenced.
BeatGrid.prototype.stop = function () {
  this.clearTimers(); this.silence(); this.playing = false;
  if (this.raf) cancelAnimationFrame(this.raf);
  if (this.playBtn) this.playBtn.innerHTML = BeatGrid.ICON_PLAY;
  if (!this.rows) return;
  var self = this;
  this.rows.forEach(function (row) { row.playhead.classList.remove('on'); });
  this.tiles.forEach(function (tl) { if (!self.held[tl.i] && tl.i !== self.tapLit) self.unlit([tl.i]); });
};

BeatGrid.prototype.clear = function () {
  this.stop(); this.clearTap(); this.spotlight(null);
  this.marks = []; this.held = {};
  var self = this;
  this.tiles.forEach(function (tl) { self.unlit([tl.i]); });
  this.overlay.querySelectorAll('.tl-mark').forEach(function (e) { e.remove(); });
  this.rows.forEach(function (row) { row.marks.innerHTML = ''; });
};
