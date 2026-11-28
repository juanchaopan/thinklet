/* ============================================================
   Fill-in component. Answers by writing, as on an exam paper: answer
   boxes set into the question's sentence (or stacked as the two numbers
   of a time signature, or in a row under a score), and a tray of keys
   the question chooses. What the child writes appears in ink in a
   handwriting; what the workflow lights or confirms takes the theme's
   accent, what is wrong its wrong colour with a dashed edge and a cross.
   Every colour comes from the theme constants in the stylesheet.
   The component does not know the answer, nor what a valid number or
   chord is: the workflow tells it what to draw right or wrong.
   Inputs: shape ('line' | 'row'), tag, prompt (parts: {text} | {term} |
   {field: {id, size, name}} | {stack: [field, field]}), fields (row
   shape: [{id, size, name}]), keys (labels, e.g. '0'-'9' or 'IV').
   Commands: focus, fill, type, highlight, spotlight, label, caption,
   check, lock, place, set, stop, clear.
   Events (via onEvent): fieldTap, keyPress, blankTap.
   ============================================================ */
function Fill(host, options) {
  var self = this;
  this.host = host;
  this.o = Object.assign({ shape: 'line', tag: '', prompt: null, fields: [], keys: Fill.DIGITS, onEvent: function () {} }, options);
  this.list = this.collect();
  this.values = {};
  this.list.forEach(function (f) { self.values[f.id] = []; });
  this.verdict = {};
  this.labels = {};
  this.held = [];
  this.spot = null;
  this.cap = null;
  this.locked = false;
  this.xs = null;
  this.timers = [];
  this.cur = this.list.length ? this.list[0].id : null;
  host.classList.add('tl-fi', 'tl-fi-is-' + this.o.shape);
  host.addEventListener('pointerdown', function (ev) { self.onPointer(ev); });
  host.addEventListener('keydown', function (ev) { self.onKey(ev); });
  host.addEventListener('keyup', function (ev) { if (ev.key === 'Tab') host.classList.add('kbd'); });
  host.addEventListener('focusin', function (ev) { self.onFocus(ev); });
  this.build();
}
Fill.MOVE_MS = 520;
Fill.EASE = 'cubic-bezier(.6, 0, .25, 1)';
Fill.BUBBLE_FADE_MS = 200;
Fill.DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
Fill.BACK = 'back';
Fill.NEXT = 'next';
Fill.KEY_W = 48;
Fill.KEY_W_NARROW = 44;
Fill.KEY_GAP = 8;
Fill.PAD_INSET = 10;
// Boxes under a score keep at least this much space between them, so the
// seal or letter on one box's corner stays clear of the box beside it.
Fill.BOX_GAP = 12;
// A tap between two keys goes to the nearer one; a tap near a box goes to
// it (further for the small boxes under a score); beyond, it is a tap on
// the blank.
Fill.KEY_REACH_PX = 8;
Fill.FIELD_REACH_PX = 10;
Fill.ROW_REACH_PX = 30;
Fill.TYPE_GAP_MS = 420;
Fill.FULL_MS = 600;
Fill.ICONS = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>'
};
Fill.KEY_NAMES = { back: 'Delete', next: 'Next box' };
Fill.SEAL_YES = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3L12.5 5"/></svg>';
Fill.SEAL_NO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
// Marks that draw themselves when they appear; once a state is drawn
// directly these are taken off, so nothing plays again later.
Fill.ENTRANCES = ['tl-fi-write', 'tl-fi-pop'];

Fill.esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
Fill.still = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; };

// Accidental glyphs drawn by the score library, so a flat in the sentence
// is the same shape as a flat on the score.
Fill.glyphs = function () {
  if (Fill._glyphs) return Fill._glyphs;
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
  Fill._glyphs = out;
  return out;
};

// Text as HTML in the serif, every ♯ ♭ ♮ swapped for the library glyph,
// sized in em so it follows the text around it.
Fill.inline = function (text) {
  var G = Fill.glyphs(), s = 0.034, band = 14;
  return String(text).split(/([♯♭♮])/).map(function (part) {
    var acc = part === '♯' ? 1 : part === '♭' ? -1 : part === '♮' ? 0 : null;
    if (acc === null) return Fill.esc(part);
    var g = G[acc]; if (!g) return part;
    return '<svg class="tl-fi-acc" viewBox="' + (g.x - .5) + ' ' + (G.lineY - band) + ' ' + (g.w + 1) + ' ' + band * 2 + '" style="width:' + ((g.w + 1) * s).toFixed(3) + 'em;height:' + (band * 2 * s).toFixed(3) + 'em;vertical-align:' + (0.33 - band * s).toFixed(3) + 'em;margin:0 1px" aria-hidden="true"><path d="' + g.d + '"/></svg>';
  }).join('');
};

// A box is as wide as what may be written in it, at least a fingertip.
Fill.width = function (size) { return Math.max(48, 18 + size * 14); };

Fill.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
Fill.prototype.isLine = function () { return this.o.shape === 'line'; };

// Every box in order, from the sentence or the row.
Fill.prototype.collect = function () {
  var out = [], add = function (f) { if (f && f.id) out.push({ id: String(f.id), size: Math.max(1, f.size || 2), name: f.name || '' }); };
  if (this.o.shape === 'line') [].concat(this.o.prompt || []).forEach(function (p) { if (p.field) add(p.field); else if (p.stack) p.stack.forEach(add); });
  else [].concat(this.o.fields || []).forEach(add);
  return out;
};
Fill.prototype.ids = function () { return this.list.map(function (f) { return f.id; }); };
Fill.prototype.field = function (id) { for (var i = 0; i < this.list.length; i++) if (this.list[i].id === id) return this.list[i]; return null; };
Fill.prototype.known = function (list) {
  var ids = this.ids();
  return [].concat(list === undefined || list === null ? [] : list).map(String).filter(function (k) { return ids.indexOf(k) >= 0; });
};
Fill.prototype.text = function (id) { return (this.values[id] || []).join(''); };
Fill.prototype.all = function () { var self = this, out = {}; this.list.forEach(function (f) { out[f.id] = self.text(f.id); }); return out; };

// The keys: the question's own, then delete, then next when there are
// several boxes.
Fill.prototype.keySet = function () {
  var out = this.o.keys.map(function (k) { return { id: 'k:' + k, label: String(k) }; });
  out.push({ id: Fill.BACK, label: '', ebony: true });
  if (this.list.length > 1) out.push({ id: Fill.NEXT, label: '', ebony: true });
  return out;
};
Fill.prototype.keyById = function (id) { for (var i = 0; i < this.keys.length; i++) if (this.keys[i].id === id) return this.keys[i]; return null; };

// Splits what is to be written into the pieces the keys write: the
// longest key label that matches, else one character.
Fill.prototype.tokens = function (s) {
  var labels = this.o.keys.map(String).sort(function (a, b) { return b.length - a.length; }), out = [], i = 0;
  s = String(s === null || s === undefined ? '' : s);
  while (i < s.length) {
    var hit = null;
    for (var j = 0; j < labels.length; j++) if (labels[j] && s.substr(i, labels[j].length) === labels[j]) { hit = labels[j]; break; }
    hit = hit || s[i];
    out.push(hit); i += hit.length;
  }
  return out;
};

// What is written in a box, cut to what fits in it.
Fill.prototype.fit = function (id, s) {
  var size = this.field(id).size, out = [];
  this.tokens(s).forEach(function (t) { if (out.join('').length + t.length <= size) out.push(t); });
  return out;
};

// Holds every glide and entrance while a state is drawn directly, takes
// the entrances off what is already drawn, and lets motion back in two
// frames later, when the drawing has settled.
Fill.prototype.hold = function () {
  var self = this;
  this.host.classList.add('tl-fi-still');
  this.host.querySelectorAll('.' + Fill.ENTRANCES.join(', .')).forEach(function (e) { Fill.ENTRANCES.forEach(function (c) { e.classList.remove(c); }); });
  cancelAnimationFrame(this.release);
  this.release = requestAnimationFrame(function () { self.release = requestAnimationFrame(function () { self.host.classList.remove('tl-fi-still'); }); });
};

// Redraws everything inside the host, e.g. after a change of width; what
// is written and every mark are state, so they come back.
Fill.prototype.build = function () {
  var self = this;
  this.stop();
  this.host.innerHTML = '';
  this.hold();
  this.inked = {}; this.sealed = {}; this.badged = {}; this.fieldEls = {}; this.keyEls = {};
  var stem = document.createElement('div'); stem.className = 'tl-fi-stem';
  if (this.o.tag) stem.innerHTML = '<span class="tl-fi-tag">' + Fill.esc(this.o.tag) + '</span>';
  var line = document.createElement('div'); line.className = 'tl-fi-line';
  stem.appendChild(line);
  if (this.isLine()) {
    this.sentence(line);
    this.host.appendChild(stem);
    this.anchor = stem;
  } else {
    if (this.o.prompt) { line.innerHTML = this.partsHtml(this.o.prompt); this.host.appendChild(stem); }
    this.strip = document.createElement('div'); this.strip.className = 'tl-fi-strip'; this.strip.setAttribute('role', 'group');
    if (this.o.prompt) this.strip.setAttribute('aria-label', line.textContent);
    this.list.forEach(function (f) { self.strip.appendChild(self.box(f, Fill.width(f.size))); });
    this.host.appendChild(this.strip);
    this.anchor = this.strip;
  }
  this.padWrap = document.createElement('div'); this.padWrap.className = 'tl-fi-padwrap';
  this.pad = document.createElement('div'); this.pad.className = 'tl-fi-pad'; this.pad.setAttribute('role', 'group'); this.pad.setAttribute('aria-label', 'Keys');
  this.keys = this.keySet();
  this.keys.forEach(function (k, i) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'tl-fi-key' + (k.ebony ? ' tl-fi-ebony' : '');
    b.dataset.key = k.id; b.tabIndex = i ? -1 : 0;
    if (k.ebony) { b.innerHTML = Fill.ICONS[k.id]; b.setAttribute('aria-label', Fill.KEY_NAMES[k.id]); }
    else b.textContent = k.label;
    self.pad.appendChild(b);
    self.keyEls[k.id] = b;
  });
  this.padWrap.appendChild(this.pad);
  this.host.appendChild(this.padWrap);
  this.layer = document.createElement('div'); this.layer.className = 'tl-fi-layer';
  this.host.appendChild(this.layer);
  this.room = null;
  this.padShown = null;
  this.layoutPad();
  this.placeBoxes();
  this.apply(false);
  this.placeCaption(false);
};

Fill.prototype.partsHtml = function (parts) {
  return [].concat(parts || []).map(function (p) {
    if (p.term) return '<span class="tl-fi-term">' + Fill.inline(p.term) + '</span>';
    return p.text ? Fill.inline(p.text) : '';
  }).join('');
};

// The sentence with its boxes. A box is kept on one line with the word
// before it and any stop or comma right after it, so a line never breaks
// between "bar" and its box.
Fill.prototype.sentence = function (line) {
  var self = this;
  var pieces = [].concat(this.o.prompt || []).map(function (p) {
    if (p.field || p.stack) return { box: p };
    return { cls: p.term ? 'tl-fi-term' : 'tl-fi-text', s: String(p.term || p.text || ''), lead: '', tail: '' };
  });
  pieces.forEach(function (it, i) {
    if (it.box) return;
    var prev = pieces[i - 1], next = pieces[i + 1], m;
    if (prev && prev.box && (m = it.s.match(/^\S+/))) { it.lead = m[0]; it.s = it.s.slice(m[0].length); }
    if (next && next.box && (m = it.s.match(/\S+\s*$/))) { it.tail = m[0]; it.s = it.s.slice(0, it.s.length - m[0].length); }
  });
  var span = function (cls, s) { var e = document.createElement('span'); e.className = cls; e.innerHTML = Fill.inline(s); return e; };
  pieces.forEach(function (it, i) {
    if (!it.box) { if (it.s) line.appendChild(span(it.cls, it.s)); return; }
    var g = document.createElement('span'); g.className = 'tl-fi-glue';
    var prev = pieces[i - 1], next = pieces[i + 1];
    if (prev && !prev.box && prev.tail) g.appendChild(span(prev.cls, prev.tail));
    g.appendChild(self.boxes(it.box));
    if (next && !next.box && next.lead) g.appendChild(span(next.cls, next.lead));
    line.appendChild(g);
  });
};

// One box in the sentence, or two stacked as a time signature, the same
// width.
Fill.prototype.boxes = function (p) {
  var self = this;
  if (p.field) { var one = this.field(String(p.field.id)); return this.box(one, Fill.width(one.size)); }
  var st = document.createElement('span'); st.className = 'tl-fi-stack';
  var fs = p.stack.map(function (f) { return self.field(String(f.id)); });
  var w = Math.max.apply(null, fs.map(function (f) { return Fill.width(f.size); }));
  fs.forEach(function (f) { st.appendChild(self.box(f, w)); });
  return st;
};

Fill.prototype.box = function (f, w) {
  var el = document.createElement('span');
  el.className = 'tl-fi-field';
  el.dataset.id = f.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'textbox');
  el.style.width = w + 'px';
  el.innerHTML = '<span class="tl-fi-ink" aria-hidden="true"></span><span class="tl-fi-caret" aria-hidden="true"></span>';
  this.fieldEls[f.id] = el;
  return el;
};

// Keys are all one size; they go in one row when it fits, else in rows
// of nearly equal length.
Fill.prototype.layoutPad = function () {
  var W = this.padWrap.clientWidth - 4 - 2 * Fill.PAD_INSET, G = Fill.KEY_GAP, n = this.keys.length;
  var kw = Fill.KEY_W, fit = function (w) { return Math.max(1, Math.floor((W + G) / (w + G))); };
  var max = fit(kw);
  if (max < n && fit(Fill.KEY_W_NARROW) >= n) { kw = Fill.KEY_W_NARROW; max = n; }
  var rows = Math.ceil(n / max), cols = Math.ceil(n / rows);
  this.cols = cols;
  this.pad.style.setProperty('--kc', String(cols));
  this.pad.style.setProperty('--kw', kw + 'px');
};

// Boxes under a score stand where the workflow says (centres in pixels
// from the fill-in's left edge); without places they spread evenly.
// Places closer than the boxes are wide push the boxes apart, in order,
// as little as needed, keeping them inside the strip.
Fill.prototype.placeBoxes = function () {
  if (this.isLine()) return;
  var self = this, W = this.strip.clientWidth, n = this.list.length, xs = this.xs, G = Fill.BOX_GAP;
  var ws = this.list.map(function (f) { return Fill.width(f.size); });
  var at = this.list.map(function (f, i) { var x = xs && xs[i] !== undefined ? xs[i] : W * (i + .5) / n; return x - ws[i] / 2; });
  var i;
  for (i = 0; i < n; i++) at[i] = Math.max(at[i], i ? at[i - 1] + ws[i - 1] + G : 0);
  for (i = n - 1; i >= 0; i--) at[i] = Math.min(at[i], i < n - 1 ? at[i + 1] - ws[i] - G : W - ws[i]);
  for (i = 0; i < n; i++) at[i] = Math.max(at[i], i ? at[i - 1] + ws[i - 1] + G : 0);
  this.list.forEach(function (f, j) { self.fieldEls[f.id].style.left = at[j].toFixed(1) + 'px'; });
};

// Applies the state to what is drawn. Ink already on the paper stays;
// only what changed is written (or fades) now, and only when animated.
Fill.prototype.apply = function (animated) {
  var self = this, move = animated && !Fill.still();
  this.host.classList.toggle('tl-fi-locked', this.locked);
  this.list.forEach(function (f, i) {
    var el = self.fieldEls[f.id], id = f.id;
    self.ink(el, id, move);
    var v = self.verdict[id], seal = v === true ? 'yes' : v === false ? 'no' : null;
    if (self.sealed[id] !== seal) { self.seal(el, seal, move); self.sealed[id] = seal; }
    var badge = self.labels[id] || null;
    if (self.badged[id] !== badge) { self.badge(el, badge, move); self.badged[id] = badge; }
    el.classList.toggle('tl-fi-cur', id === self.cur && !self.locked);
    el.classList.toggle('tl-fi-right', v === true);
    el.classList.toggle('tl-fi-wrong', v === false);
    el.classList.toggle('tl-lit', self.held.indexOf(id) >= 0);
    el.classList.toggle('tl-dim', !!self.spot && self.spot.indexOf(id) < 0);
    var said = v === true ? ', right' : v === false ? ', wrong' : '';
    el.setAttribute('aria-label', (badge ? badge + ': ' : '') + (f.name || 'Answer ' + (i + 1)) + ': ' + (self.text(id) || 'empty') + said);
    el.setAttribute('aria-readonly', String(self.locked));
  });
  this.showPad(!this.locked, move);
};

// What is written in a box, piece by piece: pieces already there stay,
// new ones are written left to right like a pen, deleted ones fade.
Fill.prototype.ink = function (el, id, move) {
  var want = this.values[id], have = this.inked[id] || [], k = 0;
  while (k < have.length && k < want.length && have[k].tok === want[k]) k++;
  have.slice(k).forEach(function (h) {
    if (move) { h.node.classList.add('tl-fi-erase'); setTimeout(function () { h.node.remove(); }, 200); }
    else h.node.remove();
  });
  var ink = el.querySelector('.tl-fi-ink'), kept = have.slice(0, k);
  want.slice(k).forEach(function (t) {
    var s = document.createElement('span'); s.className = 'tl-fi-tok' + (move ? ' tl-fi-write' : '');
    s.textContent = t;
    ink.appendChild(s);
    kept.push({ tok: t, node: s });
  });
  this.inked[id] = kept;
};

Fill.prototype.seal = function (el, seal, move) {
  var old = el.querySelector(':scope > .tl-fi-seal'); if (old) old.remove();
  if (!seal) return;
  var s = document.createElement('span');
  s.className = 'tl-fi-seal tl-fi-' + seal + (move ? ' tl-fi-pop' : '');
  s.innerHTML = seal === 'yes' ? Fill.SEAL_YES : Fill.SEAL_NO;
  el.appendChild(s);
};

Fill.prototype.badge = function (el, text, move) {
  var old = el.querySelector(':scope > .tl-fi-badge'); if (old) old.remove();
  if (!text) return;
  var b = document.createElement('span');
  b.className = 'tl-fi-badge' + (move ? ' tl-fi-pop' : '');
  b.setAttribute('aria-hidden', 'true');
  b.textContent = text;
  el.appendChild(b);
};

// The tray of keys folds away once the answer is handed in and opens
// again when it is unlocked: its height glides and its keys fade.
Fill.prototype.showPad = function (show, move) {
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
  var a = w.animate([{ height: from + 'px', opacity: show ? 0 : 1 }, { height: to + 'px', opacity: show ? 1 : 0 }], { duration: Fill.MOVE_MS, easing: Fill.EASE });
  if (!show) a.onfinish = function () { if (!self.padShown) w.style.visibility = 'hidden'; };
};

// Taps: a key (the nearest within a few pixels, so the gaps between keys
// count), else a box (the nearest within reach), else the blank.
Fill.prototype.onPointer = function (ev) {
  var self = this, x = ev.clientX, y = ev.clientY;
  this.host.classList.remove('kbd');
  var near = function (els, reach) {
    var best = null, dist = Infinity;
    els.forEach(function (e) {
      var b = e.getBoundingClientRect();
      var d = Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
      if (d < dist) { dist = d; best = e; }
    });
    return dist <= reach ? best : null;
  };
  if (this.padShown) {
    var key = near(this.keys.map(function (k) { return self.keyEls[k.id]; }), Fill.KEY_REACH_PX);
    if (key) { ev.preventDefault(); this.pressKey(key.dataset.key, ev); return; }
  }
  var box = near(this.list.map(function (f) { return self.fieldEls[f.id]; }), this.isLine() ? Fill.FIELD_REACH_PX : Fill.ROW_REACH_PX);
  if (box) { ev.preventDefault(); this.tapField(box.dataset.id, ev); return; }
  this.emit('blankTap', {});
};

// A box focused from the keyboard becomes the one the keys write into.
Fill.prototype.onFocus = function (ev) {
  var f = ev.target.closest && ev.target.closest('.tl-fi-field');
  if (!f || this.locked || f.dataset.id === this.cur) return;
  this.cur = f.dataset.id;
  this.apply(true);
};

Fill.prototype.onKey = function (ev) {
  var t = ev.target, k = ev.key;
  if (t.classList.contains('tl-fi-key')) {
    var i = this.keys.map(function (x) { return x.id; }).indexOf(t.dataset.key), j = null;
    if (k === 'Enter' || k === ' ') { ev.preventDefault(); this.pressKey(t.dataset.key, null); return; }
    if (k === 'ArrowRight') j = Math.min(this.keys.length - 1, i + 1);
    else if (k === 'ArrowLeft') j = Math.max(0, i - 1);
    else if (k === 'ArrowDown') j = Math.min(this.keys.length - 1, i + this.cols);
    else if (k === 'ArrowUp') j = Math.max(0, i - this.cols);
    else if (k === 'Escape') { this.emit('blankTap', {}); return; }
    if (j === null || j === i) return;
    ev.preventDefault();
    var next = this.keyEls[this.keys[j].id];
    t.tabIndex = -1; next.tabIndex = 0; next.focus();
    return;
  }
  var f = t.closest('.tl-fi-field'); if (!f) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  var ids = this.ids(), at = ids.indexOf(f.dataset.id);
  if (k === 'Backspace' || k === 'Delete') { ev.preventDefault(); this.pressKey(Fill.BACK, null); return; }
  if (k === 'Enter') { ev.preventDefault(); if (this.list.length > 1) this.pressKey(Fill.NEXT, null); return; }
  if (k === 'ArrowRight' || k === 'ArrowLeft') {
    var to = ids[k === 'ArrowRight' ? Math.min(ids.length - 1, at + 1) : Math.max(0, at - 1)];
    ev.preventDefault();
    if (to !== f.dataset.id) { this.fieldEls[to].focus({ preventScroll: true }); this.emit('fieldTap', { id: to, index: ids.indexOf(to), value: this.text(to) }); }
    return;
  }
  if (k === 'Escape') { this.emit('blankTap', {}); return; }
  if (k.length !== 1) return;
  var key = this.typed(k);
  if (!key) return;
  ev.preventDefault();
  this.pressKey(key, null);
};

// The key a typed character stands for: a key with that label (any
// case), else a key whose label holds that character, written as one
// piece (typing I then V gives IV).
Fill.prototype.typed = function (ch) {
  var up = ch.toUpperCase(), lo = ch.toLowerCase(), labels = this.o.keys.map(String), i;
  for (i = 0; i < labels.length; i++) if (labels[i] === ch) return 'k:' + labels[i];
  for (i = 0; i < labels.length; i++) if (labels[i].toUpperCase() === up) return 'k:' + labels[i];
  for (i = 0; i < labels.length; i++) {
    if (labels[i].indexOf(ch) >= 0) return 'c:' + ch;
    if (labels[i].indexOf(up) >= 0) return 'c:' + up;
    if (labels[i].indexOf(lo) >= 0) return 'c:' + lo;
  }
  return null;
};

// A tap on a box makes it the one the keys write into. Locked, nothing
// changes.
Fill.prototype.tapField = function (id, ev) {
  if (this.locked) return;
  var el = this.fieldEls[id];
  el.classList.add('tl-fi-down'); setTimeout(function () { el.classList.remove('tl-fi-down'); }, 160);
  if (ev) this.ripple(ev.clientX, ev.clientY);
  this.cur = id;
  el.focus({ preventScroll: true });
  this.apply(true);
  this.emit('fieldTap', { id: id, index: this.ids().indexOf(id), value: this.text(id) });
};

// A key pressed by the child: it sinks, and what it writes goes into the
// current box. Locked, nothing changes.
Fill.prototype.pressKey = function (kid, ev) {
  if (this.locked) return;
  var el = this.keyEls[kid];
  if (el) { el.classList.add('tl-fi-down'); setTimeout(function () { el.classList.remove('tl-fi-down'); }, 140); }
  if (ev) this.ripple(ev.clientX, ev.clientY);
  var r = this.input(kid);
  this.emit('keyPress', { key: r.key, id: r.id, value: this.text(r.id), values: this.all(), accepted: r.accepted });
};

// What a key does to the current box: writes its label when it still
// fits (a full box hands the caret on to the next empty one), deletes the
// last piece (in an empty box, steps back to the box before), or moves
// on to the next box.
Fill.prototype.input = function (kid) {
  var ids = this.ids();
  if (!this.cur) this.cur = ids[0];
  var id = this.cur, f = this.field(id), toks = this.values[id], accepted = true, key;
  if (kid === Fill.BACK) {
    key = 'back';
    if (toks.length) toks.pop();
    else { accepted = false; var at = ids.indexOf(id); if (at > 0) this.cur = ids[at - 1]; }
  } else if (kid === Fill.NEXT) {
    key = 'next';
    this.cur = ids[(ids.indexOf(id) + 1) % ids.length];
  } else {
    key = kid.slice(2);
    if (this.text(id).length + key.length <= f.size) {
      toks.push(key);
      if (this.text(id).length >= f.size) { var n = this.nextEmpty(id); if (n) this.cur = n; }
    } else { accepted = false; this.full(id); }
  }
  this.apply(true);
  var a = document.activeElement;
  if (this.cur !== id && a && a.classList && a.classList.contains('tl-fi-field') && this.host.contains(a)) this.fieldEls[this.cur].focus({ preventScroll: true });
  return { key: key, id: id, accepted: accepted };
};

Fill.prototype.nextEmpty = function (id) {
  var ids = this.ids();
  for (var i = ids.indexOf(id) + 1; i < ids.length; i++) if (!this.values[ids[i]].length) return ids[i];
  return null;
};

Fill.prototype.full = function (id) {
  var el = this.fieldEls[id];
  el.classList.add('tl-fi-full');
  clearTimeout(this.fullTimer);
  this.fullTimer = setTimeout(function () { el.classList.remove('tl-fi-full'); }, Fill.FULL_MS);
};

Fill.prototype.ripple = function (cx, cy) {
  var rect = this.host.getBoundingClientRect(), r = document.createElement('div'); r.className = 'tl-fi-ripple';
  r.style.left = cx - rect.left + 'px'; r.style.top = cy - rect.top + 'px';
  this.layer.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

// A key pressed by the workflow in a lecture: it sinks and glows in the
// accent, with a ripple at its centre.
Fill.prototype.flash = function (kid) {
  var el = this.keyEls[kid]; if (!el || !this.padShown) return;
  el.classList.add('tl-fi-down', 'tl-fi-flash');
  setTimeout(function () { el.classList.remove('tl-fi-down'); }, 180);
  setTimeout(function () { el.classList.remove('tl-fi-flash'); }, 520);
  var b = el.getBoundingClientRect();
  this.ripple(b.left + b.width / 2, b.top + b.height / 2);
};

// The caption in state, as a dark bubble under its box. The fill-in first
// opens room under its sentence (or row), so the keys move down and
// nothing is covered; then the bubble pops up in the room. Taken away,
// the bubble fades first and then the room closes.
Fill.prototype.placeCaption = function (animated) {
  var move = animated && !Fill.still(), F = Fill;
  var c = this.cap, el = c && this.fieldEls[c.key];
  var old = this.room; this.room = null;
  if (old) {
    if (move) {
      var bub = old.querySelector('.tl-fi-bubble'); if (bub) bub.style.opacity = '0';
      old.animate([{ height: old.offsetHeight + 'px' }, { height: '0px' }], { duration: F.MOVE_MS, delay: F.BUBBLE_FADE_MS, easing: F.EASE, fill: 'forwards' }).onfinish = function () { old.remove(); };
    } else old.remove();
  }
  if (!el) return;
  var room = document.createElement('div'); room.className = 'tl-fi-room';
  var b = document.createElement('div'); b.className = 'tl-fi-bubble'; b.innerHTML = c.html;
  room.appendChild(b);
  this.host.insertBefore(room, this.anchor.nextSibling);
  var h = b.offsetHeight + 12, W = room.clientWidth, bw = b.offsetWidth;
  var rr = room.getBoundingClientRect(), er = el.getBoundingClientRect();
  var vx = er.left - rr.left + er.width / 2;
  var left = Math.max(4, Math.min(W - 4 - bw, vx - bw / 2));
  b.style.left = left + 'px';
  b.style.setProperty('--ax', Math.max(12, Math.min(bw - 12, vx - left)) + 'px');
  room.style.height = h + 'px';
  this.room = room;
  if (move) {
    room.animate([{ height: '0px' }, { height: h + 'px' }], { duration: F.MOVE_MS, easing: F.EASE });
    b.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 350, delay: F.MOVE_MS * .55, easing: 'cubic-bezier(.2, 1.4, .4, 1)', fill: 'backwards' });
  }
};

// ---------- Commands ----------
// Makes a box the one the keys write into.
Fill.prototype.focus = function (id) { var k = this.known([id]); if (!k.length) return; this.cur = k[0]; this.apply(true); };
// Writes these answers for the child (a demonstration, or the answer
// given back when a question is opened again), each cut to its box.
Fill.prototype.fill = function (map) {
  var self = this;
  Object.keys(map || {}).forEach(function (k) { if (self.known([k]).length) self.values[k] = self.fit(k, map[k]); });
  this.apply(true);
};
// Writes an answer key by key, as a lecture shows it: each key the
// workflow presses glows on the tray.
Fill.prototype.type = function (id, text, gapMs) {
  var self = this, k = this.known([id]); if (!k.length) return;
  this.stop();
  id = k[0];
  this.cur = id; this.apply(true);
  var gap = gapMs || Fill.TYPE_GAP_MS;
  this.tokens(text).forEach(function (t, i) {
    self.timers.push(setTimeout(function () {
      var kid = self.keyById('k:' + t) ? 'k:' + t : 'c:' + t;
      self.flash(kid);
      self.cur = id;
      self.input(kid);
    }, gap * (i + 1)));
  });
};
Fill.prototype.highlight = function (list) { this.held = this.known(list); this.apply(true); };
Fill.prototype.spotlight = function (list) { var f = this.known(list); this.spot = f.length ? f : null; this.apply(true); };
Fill.prototype.label = function (map) {
  var self = this; this.labels = {};
  Object.keys(map || {}).forEach(function (k) { if (self.known([k]).length) self.labels[k] = String(map[k]); });
  this.apply(true);
};
// Right or wrong, as the workflow judged it from the question file: a map
// from box to true or false; null takes a verdict away.
Fill.prototype.check = function (map) {
  var self = this;
  Object.keys(map || {}).forEach(function (k) {
    if (!self.known([k]).length) return;
    if (map[k] === true || map[k] === false) self.verdict[k] = map[k]; else delete self.verdict[k];
  });
  this.apply(true);
};
Fill.prototype.lock = function (on) { this.locked = on !== false; this.stop(); this.apply(true); };
Fill.prototype.place = function (xs) { this.xs = xs ? xs.slice() : null; this.placeBoxes(); this.placeCaption(false); };
// Shows a caption under a box; with no box, takes it away.
Fill.prototype.caption = function (key, html) {
  var k = key === null || key === undefined ? [] : this.known([key]);
  this.cap = k.length ? { key: k[0], html: html } : null;
  this.placeCaption(true);
};

// Shows exactly this state with nothing moving, the way the fill-in stood
// at the end of an act; used when the player steps back or forward or a
// question is opened again. Anything left out is cleared.
Fill.prototype.set = function (s) {
  var self = this; s = s || {};
  this.stop();
  this.list.forEach(function (f) { self.values[f.id] = []; });
  Object.keys(s.values || {}).forEach(function (k) { if (self.known([k]).length) self.values[k] = self.fit(k, s.values[k]); });
  this.verdict = {}; Object.keys(s.checks || {}).forEach(function (k) { if (self.known([k]).length && (s.checks[k] === true || s.checks[k] === false)) self.verdict[k] = s.checks[k]; });
  this.labels = {}; Object.keys(s.labels || {}).forEach(function (k) { if (self.known([k]).length) self.labels[k] = String(s.labels[k]); });
  this.held = this.known(s.highlight);
  var sp = this.known(s.spotlight); this.spot = sp.length ? sp : null;
  this.locked = !!s.locked;
  var fc = this.known([s.focus]);
  this.cur = fc.length ? fc[0] : (this.ids().filter(function (k) { return !self.values[k].length; })[0] || this.ids()[0] || null);
  var ck = s.caption ? this.known([s.caption.key]) : [];
  this.cap = ck.length ? { key: ck[0], html: s.caption.html } : null;
  this.hold();
  this.apply(false);
  this.placeCaption(false);
};

// Stops keys the workflow is still pressing; what is written stays.
Fill.prototype.stop = function () { (this.timers || []).forEach(clearTimeout); this.timers = []; };

Fill.prototype.clear = function () { this.set({}); };

