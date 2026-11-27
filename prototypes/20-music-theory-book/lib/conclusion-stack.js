/* ============================================================
   Conclusion stack component. Keeps the conclusions a lecture has
   reached, one per act: the newest is a full-size slip on top of the
   stack, earlier ones shrink into strips pushed up under a clip, and
   beyond the last few they fold into a pile. A conclusion built on
   earlier ones is joined to them by a thread; the one that answers the
   question carries a seal.
   Slips are kept on screen from one state to the next and their sizes
   glide, so a slip that becomes a strip shrinks where it is instead of
   being drawn again; slips that join or leave grow in or flatten out,
   all in the same stretch of time, so the stack's height changes one way.
   Inputs: items ({id: {parts: [{text} | {term} | {op} | {abc}], from:
   [ids], final, note}}), mode ('lecture' | 'practice'), tempo.
   Commands: push, set, highlight, spotlight, caption, mask, reveal,
   stop, clear.
   Events (via onEvent): itemTap, pileTap, blankTap.
   Sound goes through the injected source, lectures only.
   ============================================================ */
function ConclusionStack(host, options) {
  var self = this;
  this.host = host;
  this.o = Object.assign({ items: {}, mode: 'lecture', tempo: 96, sound: null, onEvent: function () {} }, options);
  this.order = [];
  this.masked = {};
  this.held = [];
  this.spot = null;
  this.cap = null;
  this.open = false;
  this.flash = [];
  this.flashOn = false;
  this.entering = null;
  this.timers = [];
  this.tapTimers = [];
  this.voices = [];
  host.classList.add('tl-cs');
  host.addEventListener('pointerdown', function (ev) { self.onPointer(ev); });
  host.addEventListener('keydown', function (ev) { self.onKey(ev); });
  host.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') host.classList.add('kbd'); });
  this.build();
}
// Earlier conclusions shown as strips before the rest fold into the pile:
// fewer on a narrow stack, where height is scarce.
ConclusionStack.STRIPS = { wide: 3, narrow: 2 };
ConclusionStack.NARROW_PX = 480;
ConclusionStack.TAP_FADE_MS = 2000;
// The choreography of a push: everything glides together for MOVE_MS (the
// newest slip shrinking, the slips above sliding up, the new slip's paper
// growing, a folded slip flattening), starting very gently so the eye is
// on the slip before it moves much; the new slip's ink appears from
// INK_DELAY_MS for INK_MS, once its paper has opened; the thread draws and
// its sources light once all is still.
ConclusionStack.MOVE_MS = 520;
ConclusionStack.INK_DELAY_MS = 240;
ConclusionStack.INK_MS = 400;
ConclusionStack.SETTLE_MS = 660;
ConclusionStack.EASE = 'cubic-bezier(.6, 0, .25, 1)';
ConclusionStack.STAFF_SCALE = { fresh: .8, strip: .62, narrow: .5 };
ConclusionStack.LETTERS = 'CDEFGAB';
ConclusionStack.STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
ConclusionStack.SHIFT = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
ConclusionStack.SVG = 'http://www.w3.org/2000/svg';
ConclusionStack.OPS = {
  '=': '<path d="M3 6h10M3 10h10"/>',
  '≠': '<path d="M3 6h10M3 10h10M10.5 2.5l-5 11"/>',
  '+': '<path d="M8 3v10M3 8h10"/>',
  '→': '<path d="M2 8h11M9 4l4 4-4 4"/>'
};
ConclusionStack.OP_WORDS = { '=': 'equals', '≠': 'is not', '+': 'and', '→': 'gives' };
ConclusionStack.CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg>';

ConclusionStack.esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
ConclusionStack.still = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; };

// Accidental glyphs drawn by the score library, so a flat in a conclusion
// is the same shape as a flat on the score.
ConclusionStack.glyphs = function () {
  if (ConclusionStack._glyphs) return ConclusionStack._glyphs;
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
  ConclusionStack._glyphs = out;
  return out;
};

// Text as HTML in the serif, every ♯ ♭ ♮ swapped for the library glyph.
// The glyph is sized in em, so it grows and shrinks with the text around it.
ConclusionStack.inline = function (text) {
  var G = ConclusionStack.glyphs(), s = 0.034, band = 14;
  return String(text).split(/([♯♭♮])/).map(function (part) {
    var acc = part === '♯' ? 1 : part === '♭' ? -1 : part === '♮' ? 0 : null;
    if (acc === null) return ConclusionStack.esc(part);
    var g = G[acc]; if (!g) return part;
    return '<svg class="tl-cs-acc" viewBox="' + (g.x - .5) + ' ' + (G.lineY - band) + ' ' + (g.w + 1) + ' ' + band * 2 + '" style="width:' + ((g.w + 1) * s).toFixed(3) + 'em;height:' + (band * 2 * s).toFixed(3) + 'em;vertical-align:' + (0.33 - band * s).toFixed(3) + 'em;margin:0 1px" aria-hidden="true"><path d="' + g.d + '"/></svg>';
  }).join('');
};

// A part's ABC as a whole tune: header lines from the part (L:, K:, Q:)
// with defaults, K: last, then the music.
ConclusionStack.tune = function (abc) {
  var head = [], body = [], key = 'K:C';
  String(abc).split('\n').forEach(function (line) {
    if (/^K:/.test(line)) key = line;
    else if (/^[A-Za-z]:/.test(line)) head.push(line);
    else body.push(line);
  });
  if (!head.some(function (l) { return /^L:/.test(l); })) head.push('L:1/4');
  return 'X:1\n' + head.join('\n') + '\n' + key + '\n' + body.join('\n');
};

// A conclusion in words, for screen readers and for events.
ConclusionStack.words = function (item) {
  return (item.parts || []).map(function (p) {
    if (p.abc) return '♪';
    if (p.op) return ConclusionStack.OP_WORDS[p.op] || p.op;
    return p.text || p.term || '';
  }).join(' ');
};

ConclusionStack.prototype.audible = function () { return this.o.mode === 'lecture' && !!this.o.sound; };
ConclusionStack.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
ConclusionStack.prototype.item = function (id) { return this.o.items[id] || { parts: [] }; };
ConclusionStack.prototype.known = function (list) {
  var self = this;
  return [].concat(list || []).filter(function (id) { return self.order.indexOf(id) >= 0; });
};
ConclusionStack.prototype.live = function () { return [].slice.call(this.list.querySelectorAll('.tl-cs-pile:not(.tl-cs-leaving), .tl-cs-slip:not(.tl-cs-leaving)')); };

// Every note the stack sounds goes through here, so stop() can silence
// the notes already scheduled ahead on the audio clock.
ConclusionStack.prototype.note = function (midi, delay, dur, velocity) {
  var v = this.o.sound.play(midi, delay, dur, velocity);
  if (v) this.voices.push(v);
};
ConclusionStack.prototype.silence = function () {
  (this.voices || []).forEach(function (v) { v.stop(); });
  this.voices = [];
};

// Redraws everything inside the host, e.g. after a change of width or
// mode; the conclusions and marks are state, so they come back.
ConclusionStack.prototype.build = function () {
  this.stop(); this.clearTap();
  clearTimeout(this.settleTimer);
  this.host.innerHTML = '<div class="tl-cs-clip" aria-hidden="true"></div>';
  this.list = document.createElement('div'); this.list.className = 'tl-cs-list'; this.list.setAttribute('role', 'list');
  this.host.appendChild(this.list);
  this.thread = document.createElementNS(ConclusionStack.SVG, 'svg'); this.thread.setAttribute('class', 'tl-cs-thread'); this.thread.setAttribute('aria-hidden', 'true');
  this.list.appendChild(this.thread);
  this.over = document.createElement('div'); this.over.className = 'tl-cs-over';
  this.host.appendChild(this.over);
  this.slipEls = {}; this.staffs = {}; this.leaving = {}; this.pileEl = null; this.shape = '';
  this.render(false);
};

// Which earlier conclusions are drawn as strips and which are folded:
// the last few stay out, and so does any the workflow lights or spots.
ConclusionStack.prototype.layout = function () {
  var self = this, strips = this.order.slice(0, -1), keep = this.held.concat(this.spot || []);
  var max = ConclusionStack.STRIPS[this.narrow ? 'narrow' : 'wide'];
  var shown = strips.filter(function (id, i) { return self.open || i >= strips.length - max || keep.indexOf(id) >= 0; });
  return { strips: shown, folded: strips.length - shown.length, foldable: strips.length > max, fresh: this.order.length ? this.order[this.order.length - 1] : null };
};

// What decides a slip's size: its kind, depth and the stack's width.
ConclusionStack.prototype.sizeKey = function (el) {
  return el.classList.contains('tl-cs-fresh') + ':' + el.style.getPropertyValue('--d') + ':' + this.narrow;
};

// The height a slip will have once its glides end: a copy styled the same
// way, laid out out of sight with nothing gliding.
ConclusionStack.prototype.measure = function (el) {
  var copy = el.cloneNode(true);
  copy.classList.add('tl-cs-probe');
  this.list.appendChild(copy);
  var h = copy.offsetHeight;
  copy.remove();
  return h;
};

// Brings the drawing to the state. Slips already on screen are kept and
// restyled, so their sizes and places glide (the height of the paper too,
// toward the height it will end with); new ones grow in, removed ones
// flatten out. Unanimated, it simply draws the state.
ConclusionStack.prototype.render = function (animated) {
  var self = this, C = ConclusionStack, move = animated && !C.still();
  var before = {};
  if (move) Object.keys(this.slipEls).forEach(function (id) { var el = self.slipEls[id]; before[id] = { key: self.sizeKey(el), h: el.offsetHeight }; });
  if (!move) this.host.classList.add('tl-cs-still');
  this.narrow = this.host.clientWidth < C.NARROW_PX;
  this.host.classList.toggle('tl-cs-narrow', this.narrow);
  this.host.classList.toggle('tl-cs-open', this.open);
  var L = this.layout(), want = [], grown = [];
  if (L.foldable) {
    if (!this.pileEl) { this.pileEl = document.createElement('div'); this.pileEl.className = 'tl-cs-pile'; this.pileEl.setAttribute('role', 'button'); this.pileEl.tabIndex = -1; grown.push(this.pileEl); }
    var pile = this.pileEl;
    pile.style.setProperty('--d', String(Math.min(3, L.strips.length + 1)));
    pile.innerHTML = (L.folded ? '<i></i><i></i><i></i>' : '') + '<span class="tl-cs-more">' + (L.folded ? '+' + L.folded : '') + C.CHEVRON + '</span>';
    pile.setAttribute('aria-label', L.folded ? '前面还有 ' + L.folded + ' 条结论，点开' : '收起前面的结论');
    pile.setAttribute('aria-expanded', String(this.open));
    want.push(pile);
  } else if (this.pileEl) { this.leave(this.pileEl, move); this.pileEl = null; }
  var plan = L.strips.map(function (id, k) { return { id: id, kind: 'strip', depth: Math.min(3, L.strips.length - k) }; });
  if (L.fresh) plan.push({ id: L.fresh, kind: 'fresh', depth: 0 });
  var ids = plan.map(function (p) { return p.id; });
  Object.keys(this.slipEls).forEach(function (id) { if (ids.indexOf(id) < 0) { self.leave(self.slipEls[id], move); delete self.slipEls[id]; } });
  plan.forEach(function (p) {
    var el = self.slipEls[p.id];
    if (!el && self.leaving[p.id]) { el = self.leaving[p.id]; delete self.leaving[p.id]; if (el._anim) el._anim.cancel(); el.classList.remove('tl-cs-leaving'); el.style.overflow = ''; grown.push(el); }
    if (!el) { el = self.slip(p.id); grown.push(el); }
    self.slipEls[p.id] = el;
    self.dress(el, p.id, p.kind, p.depth);
    want.push(el);
  });
  this.place(want);
  this.live().forEach(function (el) { el.tabIndex = -1; });
  var slips = this.list.querySelectorAll('.tl-cs-slip:not(.tl-cs-leaving)');
  if (slips.length) slips[slips.length - 1].tabIndex = 0;
  this.applyMasks(false);
  this.apply();
  var entering = this.entering; this.entering = null;
  var shape = want.map(function (el) { return (el.dataset.id || 'pile') + ':' + el.className + ':' + el.style.getPropertyValue('--d'); }).join('|') + '|' + this.narrow;
  var changed = shape !== this.shape; this.shape = shape;
  if (move) {
    plan.forEach(function (p) {
      var el = self.slipEls[p.id], b = before[p.id];
      if (!b || grown.indexOf(el) >= 0 || b.key === self.sizeKey(el)) return;
      var h = self.measure(el);
      if (Math.abs(h - b.h) > .5) el.animate([{ height: b.h + 'px' }, { height: h + 'px' }], { duration: C.MOVE_MS, easing: C.EASE });
    });
    grown.forEach(function (el) { self.grow(el, el.dataset.id === entering && !!entering); });
  }
  clearTimeout(this.settleTimer);
  if (move && changed) {
    this.thread.classList.add('tl-cs-moving');
    this.settleTimer = setTimeout(function () { self.drawThread(!!entering); self.thread.classList.remove('tl-cs-moving'); self.placeCaption(false); }, C.SETTLE_MS);
  } else {
    this.drawThread(false); this.thread.classList.remove('tl-cs-moving');
    this.placeCaption(false);
  }
  if (!move) requestAnimationFrame(function () { requestAnimationFrame(function () { self.host.classList.remove('tl-cs-still'); }); });
};

// Puts the wanted elements in order after the thread, leaving slips that
// are flattening out where they are and moving nothing that is already in
// place, so no slip loses its glide.
ConclusionStack.prototype.place = function (want) {
  var list = this.list, node = this.thread.nextSibling;
  want.forEach(function (el) {
    while (node && node !== el && node.classList.contains('tl-cs-leaving')) node = node.nextSibling;
    if (node === el) { node = node.nextSibling; return; }
    list.insertBefore(el, node);
  });
};

// A slip or the pile leaving: it flattens and fades where it is, then goes.
ConclusionStack.prototype.leave = function (el, move) {
  var self = this, id = el.dataset.id;
  el.classList.add('tl-cs-leaving'); el.tabIndex = -1;
  if (!move) { el.remove(); return; }
  if (id) this.leaving[id] = el;
  var cs = getComputedStyle(el);
  el.style.overflow = 'hidden';
  el._anim = el.animate([
    { height: el.offsetHeight + 'px', minHeight: cs.minHeight, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, opacity: 1 },
    { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', opacity: 0 }
  ], { duration: ConclusionStack.MOVE_MS, easing: ConclusionStack.EASE, fill: 'forwards' });
  el._anim.onfinish = function () { if (el.classList.contains('tl-cs-leaving')) { el.remove(); if (id && self.leaving[id] === el) delete self.leaving[id]; } };
};

// A slip or the pile joining: its paper grows from nothing to its own
// height over the same time as everything else moves. The conclusion just
// pushed then has its ink settle in a moment later, and the answer's seal
// stamps last.
ConclusionStack.prototype.grow = function (el, isNew) {
  var C = ConclusionStack, cs = getComputedStyle(el);
  var to = { height: el.offsetHeight + 'px', minHeight: cs.minHeight, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, opacity: 1 };
  var from = { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', opacity: 0 };
  el.style.overflow = 'hidden';
  el._anim = el.animate([from, to], { duration: C.MOVE_MS, easing: C.EASE, fill: 'backwards' });
  el._anim.onfinish = function () { el.style.overflow = ''; };
  if (!isNew) return;
  var body = el.querySelector('.tl-cs-body');
  if (body) body.animate([{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(2px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: C.INK_MS, delay: C.INK_DELAY_MS, easing: C.EASE, fill: 'backwards' });
  var seal = el.querySelector('.tl-cs-seal');
  if (seal) seal.animate([{ transform: 'scale(1.7) rotate(-20deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: C.INK_DELAY_MS + C.INK_MS - 120, easing: 'cubic-bezier(.2, 1.5, .4, 1)', fill: 'backwards' });
};

// One conclusion as a slip: its step number (a seal for the answer), then
// its parts in a row that wraps by words.
ConclusionStack.prototype.slip = function (id) {
  var self = this, it = this.item(id);
  var el = document.createElement('div');
  el.className = 'tl-cs-slip';
  el.dataset.id = id; el.tabIndex = -1; el.setAttribute('role', 'listitem');
  el.innerHTML = (it.final ? '<span class="tl-cs-seal" aria-hidden="true"><span>∴</span></span>' : '<span class="tl-cs-num" aria-hidden="true"></span>') + '<div class="tl-cs-body"></div>';
  var body = el.querySelector('.tl-cs-body');
  this.staffs[id] = [];
  (it.parts || []).forEach(function (p) {
    if (p.abc) { self.drawStaff(id, p.abc, body); return; }
    var s = document.createElement('span');
    if (p.op) { s.className = 'tl-cs-op'; s.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' + (ConclusionStack.OPS[p.op] || '') + '</svg>'; }
    else { s.className = 'tl-cs-text' + (p.term ? ' tl-cs-term' : ''); s.innerHTML = ConclusionStack.inline(p.term || p.text || ''); }
    body.appendChild(s);
  });
  return el;
};

// Styles a slip for its place: the newest or an earlier one, how deep in
// the stack, its step number and the size of its staves. Changes glide.
ConclusionStack.prototype.dress = function (el, id, kind, depth) {
  var it = this.item(id), K = ConclusionStack.STAFF_SCALE[kind === 'fresh' ? 'fresh' : this.narrow ? 'narrow' : 'strip'];
  el.classList.toggle('tl-cs-fresh', kind === 'fresh');
  el.classList.toggle('tl-cs-final', !!it.final);
  el.style.setProperty('--d', String(depth));
  var num = el.querySelector('.tl-cs-num'); if (num) num.textContent = String(this.order.indexOf(id) + 1);
  (this.staffs[id] || []).forEach(function (st) { st.svg.style.width = (st.w * K).toFixed(1) + 'px'; });
};

// Draws a part's ABC on a short stave cropped to what is drawn (clef, key
// signature, notes; not the bare stave lines). Its width is set by the
// slip it is on; it never grows wider than the slip. Keeps the notes for
// playback.
ConclusionStack.prototype.drawStaff = function (id, abc, body) {
  var holder = document.createElement('span'); holder.className = 'tl-cs-staff';
  body.appendChild(holder);
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:700px;visibility:hidden';
  document.body.appendChild(box);
  var vis = ABCJS.renderAbc(box, ConclusionStack.tune(abc), { add_classes: true, staffwidth: 560, paddingleft: 0, paddingright: 0, paddingtop: 0, paddingbottom: 0 })[0];
  var svg = box.querySelector('svg');
  var all = svg.getBBox(), right = 0;
  svg.querySelectorAll('path, text').forEach(function (p) {
    var c = ' ' + (p.getAttribute('class') || '') + ' ' + ((p.parentNode && p.parentNode.getAttribute && p.parentNode.getAttribute('class')) || '') + ' ';
    if (/ abcjs-staff | abcjs-top-line /.test(c)) return;
    var b = p.getBBox(); if (b.width || b.height) right = Math.max(right, b.x + b.width);
  });
  var w = Math.ceil(right + 10), y0 = Math.floor(all.y - 4), h = Math.ceil(all.height + 8);
  svg.setAttribute('viewBox', '0 ' + y0 + ' ' + w + ' ' + h);
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.removeAttribute('style'); svg.setAttribute('aria-hidden', 'true');
  holder.appendChild(svg);
  box.remove();
  this.staffs[id].push({ svg: svg, w: w, notes: this.collect(vis) });
};

// The notes of a snippet in order with their onsets in whole notes,
// pitches (key signature and accidentals within the bar applied), grace
// notes and ornament, and the drawn shapes to light while they sound.
ConclusionStack.prototype.collect = function (vis) {
  var C = ConclusionStack, out = [], t = 0, bar = {};
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
// stack's tempo, ornaments and grace notes played out the way the other
// etude components play them (a semiquaver of the beat each).
ConclusionStack.prototype.sequence = function (notes) {
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

// The thread from the conclusions the newest one builds on: a dot at each
// (at the pile for a folded one), down the left margin, into the newest.
// Drawn once the slips stand still.
ConclusionStack.prototype.drawThread = function (animated) {
  var self = this, L = this.layout(), svg = this.thread;
  svg.innerHTML = '';
  if (!L.fresh || !this.slipEls[L.fresh]) return;
  var from = this.known(this.item(L.fresh).from).filter(function (id) { return id !== L.fresh; });
  if (!from.length) return;
  var mid = function (el) { return el.offsetTop + Math.min(el.offsetHeight / 2, 22); };
  var to = this.slipEls[L.fresh], ty = to.offsetTop + Math.min(to.offsetHeight / 2, 30), tx = to.offsetLeft, gx = 8;
  var ends = [], seen = {};
  from.forEach(function (id) {
    var el = self.slipEls[id] || self.pileEl, key = self.slipEls[id] ? id : '_pile';
    if (!el || seen[key]) return;
    seen[key] = true;
    ends.push({ y: mid(el), x: el.offsetLeft });
  });
  if (!ends.length) return;
  var top = Math.min.apply(null, ends.map(function (e) { return e.y; }));
  var draw = animated ? ' class="tl-cs-draw"' : '', html = '';
  ends.forEach(function (e) { html += '<path' + draw + ' pathLength="1" d="M' + (e.x - 1) + ' ' + e.y + 'H' + gx + '"/><circle' + (animated ? ' class="tl-cs-dot"' : '') + ' cx="' + (e.x - 1) + '" cy="' + e.y + '" r="2.8"/>'; });
  html += '<path' + draw + ' pathLength="1" d="M' + gx + ' ' + top + 'V' + ty + 'H' + (tx - 2) + '"/>';
  html += '<path' + (animated ? ' class="tl-cs-tip"' : '') + ' d="M' + (tx - 7) + ' ' + (ty - 4) + 'L' + (tx - 2) + ' ' + ty + 'L' + (tx - 7) + ' ' + (ty + 4) + '"/>';
  svg.innerHTML = html;
};

ConclusionStack.prototype.applyMasks = function (animated) {
  var self = this;
  Object.keys(this.slipEls).forEach(function (id) {
    var el = self.slipEls[id], body = el.querySelector('.tl-cs-body'), on = !!self.masked[id];
    var cover = body.querySelector(':scope > .tl-cs-cover');
    if (on && !cover) {
      cover = document.createElement('span'); cover.className = 'tl-cs-cover'; cover.innerHTML = '<span class="tl-cs-q">?</span>';
      body.appendChild(cover); body.classList.add('tl-cs-hidden');
    } else if (!on && cover) {
      body.classList.remove('tl-cs-hidden');
      if (animated) {
        body.querySelectorAll(':scope > :not(.tl-cs-cover)').forEach(function (c) { c.classList.remove('tl-cs-ink'); void c.offsetWidth; c.classList.add('tl-cs-ink'); });
        cover.classList.add('off'); setTimeout(function () { cover.remove(); }, 480);
      } else cover.remove();
    }
    el.setAttribute('aria-label', (self.item(id).final ? 'Answer: ' : 'Step ' + (self.order.indexOf(id) + 1) + ': ') + (on ? '未知' : ConclusionStack.words(self.item(id))));
  });
};

// Applies the marks held in state to the drawn slips: lit (held, the
// sources of the conclusion just pushed once its thread draws, the one a
// tap lit) and the spotlight. A lit source folded in the pile lights the
// pile.
ConclusionStack.prototype.apply = function () {
  var self = this, lit = this.held.concat(this.flashOn ? this.flash : []); if (this.tapLit) lit.push(this.tapLit);
  Object.keys(this.slipEls).forEach(function (id) {
    var el = self.slipEls[id];
    el.classList.toggle('tl-lit', lit.indexOf(id) >= 0);
    el.classList.toggle('tl-dim', !!self.spot && self.spot.indexOf(id) < 0);
  });
  if (this.pileEl) this.pileEl.classList.toggle('tl-lit', lit.some(function (id) { return self.order.indexOf(id) >= 0 && !self.slipEls[id]; }));
};

// Taps: slips touch each other, so a tap goes to the slip at that height,
// or the nearest one within a few pixels; where two overlap, the one on
// top; the pile is a target too; the clip's sides and the margin under
// the newest slip are blank.
ConclusionStack.prototype.onPointer = function (ev) {
  this.host.classList.remove('kbd');
  var y = ev.clientY, best = null, dist = Infinity;
  this.live().forEach(function (el) {
    var b = el.getBoundingClientRect(), d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
    if (d <= dist) { dist = d; best = el; }
  });
  if (!best || dist > 6) { this.blankTap(); return; }
  ev.preventDefault();
  if (this.o.mode !== 'lecture') return;
  if (best === this.pileEl) this.pileTap(); else this.tap(best.dataset.id, ev);
};

ConclusionStack.prototype.onKey = function (ev) {
  var cur = ev.target.closest('.tl-cs-slip, .tl-cs-pile'); if (!cur) return;
  var list = this.live(), i = list.indexOf(cur), next = null;
  if (ev.key === 'ArrowDown') next = list[Math.min(list.length - 1, i + 1)];
  else if (ev.key === 'ArrowUp') next = list[Math.max(0, i - 1)];
  else if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    if (this.o.mode !== 'lecture') return;
    if (cur === this.pileEl) { this.pileTap(); if (this.pileEl) { this.pileEl.tabIndex = 0; this.pileEl.focus(); } } else this.tap(cur.dataset.id, null);
    return;
  } else if (ev.key === 'Escape') { this.blankTap(); return; }
  if (!next || next === cur) return;
  ev.preventDefault();
  cur.tabIndex = -1; next.tabIndex = 0; next.focus();
};

ConclusionStack.prototype.tap = function (id, ev) {
  var self = this, el = this.slipEls[id], it = this.item(id); if (!el) return;
  this.clearTap();
  this.tapLit = id;
  el.classList.add('tl-cs-down'); setTimeout(function () { el.classList.remove('tl-cs-down'); }, 200);
  if (ev) this.ripple(ev);
  this.apply();
  var hidden = !!this.masked[id];
  if (!hidden && this.audible() && this.staffs[id].length) { this.stop(); this.sound(id); }
  if (!hidden && it.note) { this.cap = { id: id, html: ConclusionStack.inline(it.note), tapped: true }; this.placeCaption(true); }
  this.emit('itemTap', { id: id, step: this.order.indexOf(id) + 1, final: !!it.final, text: hidden ? null : ConclusionStack.words(it), hidden: hidden });
  this.tapTimers.push(setTimeout(function () {
    self.over.querySelectorAll('.tl-cs-bubble.tl-cs-tapped').forEach(function (b) { b.classList.add('out'); });
    self.tapLit = null; self.apply();
  }, ConclusionStack.TAP_FADE_MS));
  this.tapTimers.push(setTimeout(function () {
    if (self.cap && self.cap.tapped) { self.cap = null; self.placeCaption(false); }
  }, ConclusionStack.TAP_FADE_MS + 500));
};

ConclusionStack.prototype.pileTap = function () {
  this.clearTap();
  this.open = !this.open;
  this.render(true);
  this.emit('pileTap', { folded: this.open ? 0 : this.layout().folded, open: this.open });
};

ConclusionStack.prototype.blankTap = function () {
  this.clearTap();
  if (this.open) { this.open = false; this.render(true); }
  this.emit('blankTap', {});
};

ConclusionStack.prototype.clearTap = function () {
  (this.tapTimers || []).forEach(clearTimeout); this.tapTimers = [];
  if (this.cap && this.cap.tapped) { this.cap = null; if (this.over) this.placeCaption(false); }
  if (this.tapLit) { this.tapLit = null; if (this.list) this.apply(); }
};

ConclusionStack.prototype.ripple = function (ev) {
  var rect = this.host.getBoundingClientRect(), r = document.createElement('div'); r.className = 'tl-cs-ripple';
  r.style.left = ev.clientX - rect.left + 'px'; r.style.top = ev.clientY - rect.top + 'px';
  this.over.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

// Sounds the snippets of one conclusion in order, lighting each note as
// it plays.
ConclusionStack.prototype.sound = function (id) {
  var self = this, timers = this.timers, at = 0;
  var light = function (els, on) { els.forEach(function (e) { e.classList.toggle('tl-cs-sounding', on); }); };
  this.staffs[id].forEach(function (st) {
    var seq = self.sequence(st.notes), start = at;
    seq.steps.forEach(function (s) {
      s.midis.forEach(function (m) { self.note(m, start + s.at, s.dur, .6); });
      timers.push(setTimeout(function () { light(s.shapes, true); }, (start + s.at) * 1000));
      timers.push(setTimeout(function () { light(s.shapes, false); }, (start + s.at + s.dur) * 1000 - 20));
    });
    at += seq.length + .35;
  });
};

// The caption in state as a dark bubble under its slip. Below the newest
// slip there is no room, so the stack grows under itself while the bubble
// shows; a bubble never covers another conclusion.
ConclusionStack.prototype.placeCaption = function (animated) {
  var c = this.cap, el = c && this.slipEls[c.id];
  this.over.querySelectorAll('.tl-cs-bubble').forEach(function (e) { e.remove(); });
  if (!el) { this.host.style.paddingBottom = ''; return; }
  var b = document.createElement('div'); b.innerHTML = c.html;
  b.className = 'tl-cs-bubble' + (c.tapped ? ' tl-cs-tapped' : '') + (animated ? '' : ' tl-cs-still');
  this.over.appendChild(b);
  var body = el.querySelector('.tl-cs-body');
  var x0 = this.list.offsetLeft + el.offsetLeft + body.offsetLeft, vx = x0 + Math.min(body.offsetWidth, 160) / 2;
  var bottom = this.list.offsetTop + el.offsetTop + el.offsetHeight, bw = b.offsetWidth, bh = b.offsetHeight, W = this.host.clientWidth;
  var listEnd = this.list.offsetTop + this.list.offsetHeight, need = bottom + 6 + bh + 10 - listEnd;
  this.host.style.paddingBottom = need > 18 ? need + 'px' : '';
  var left = Math.max(10, Math.min(W - 10 - bw, vx - bw / 2));
  b.style.left = left + 'px';
  b.style.top = bottom + 6 + 'px';
  b.style.setProperty('--ax', Math.max(12, Math.min(bw - 12, vx - left)) + 'px');
};

// The conclusion of this act lands on the stack. Once everything has
// settled, the conclusions it is built on light up for a moment while
// its thread draws.
ConclusionStack.prototype.push = function (id) {
  var self = this, C = ConclusionStack;
  if (!this.o.items[id] || this.order.indexOf(id) >= 0) return;
  this.stop(); this.clearTap();
  this.cap = null; this.open = false;
  this.order.push(id);
  clearTimeout(this.flashTimer); clearTimeout(this.flashEnd);
  this.flash = this.known(this.item(id).from).filter(function (f) { return f !== id; });
  this.flashOn = false;
  this.entering = id;
  this.render(true);
  var settle = C.still() ? 0 : C.SETTLE_MS;
  this.flashTimer = setTimeout(function () { self.flashOn = true; self.apply(); }, settle);
  this.flashEnd = setTimeout(function () { self.flash = []; self.flashOn = false; self.apply(); }, settle + C.TAP_FADE_MS);
};

// Shows exactly these conclusions with no entrance, the way the stack
// stood at the end of an act; used when the player steps back or forward
// or a question is opened again.
ConclusionStack.prototype.set = function (ids) {
  var self = this, seen = {};
  this.stop(); this.clearTap();
  clearTimeout(this.flashTimer); clearTimeout(this.flashEnd); this.flash = []; this.flashOn = false;
  this.cap = null; this.open = false; this.entering = null;
  this.order = [].concat(ids || []).filter(function (id) { if (!self.o.items[id] || seen[id]) return false; seen[id] = true; return true; });
  this.held = this.known(this.held); this.spot = this.spot ? this.known(this.spot) : null;
  if (this.spot && !this.spot.length) this.spot = null;
  this.render(false);
};

ConclusionStack.prototype.highlight = function (ids) { this.held = this.known(ids); this.render(true); };
ConclusionStack.prototype.spotlight = function (ids) { var f = this.known(ids); this.spot = f.length ? f : null; this.render(true); };
ConclusionStack.prototype.caption = function (id, html) { if (!this.slipEls[id]) return; this.cap = { id: id, html: html, tapped: false }; this.placeCaption(true); };
ConclusionStack.prototype.mask = function (ids) { var self = this; [].concat(ids).forEach(function (id) { if (self.o.items[id]) self.masked[id] = true; }); this.applyMasks(false); };
// With no argument, reveal() uncovers everything.
ConclusionStack.prototype.reveal = function (ids) {
  var self = this;
  if (ids === undefined) this.masked = {};
  else [].concat(ids).forEach(function (id) { delete self.masked[id]; });
  this.applyMasks(true);
};

// Stops the sound of a tapped conclusion: timers are cleared and every
// note still queued or sounding is silenced.
ConclusionStack.prototype.stop = function () {
  (this.timers || []).forEach(clearTimeout); this.timers = [];
  this.silence();
  if (this.list) this.list.querySelectorAll('.tl-cs-sounding').forEach(function (e) { e.classList.remove('tl-cs-sounding'); });
};

ConclusionStack.prototype.clear = function () {
  this.stop(); this.clearTap();
  clearTimeout(this.flashTimer); clearTimeout(this.flashEnd);
  this.order = []; this.masked = {}; this.held = []; this.spot = null; this.cap = null; this.open = false; this.flash = []; this.flashOn = false;
  this.render(false);
};

