/* ============================================================
   Conclusion stack component. Keeps the conclusions a lecture has
   reached and shows them as a wheel: the one in focus stands in the
   middle at full size, the ones before and after shrink and fade with
   their distance from it. The wheel turns under a finger, a mouse wheel
   or a mouse drag and comes to rest on the nearest conclusion; in a
   short wide place it turns sideways. A tap on a conclusion turns the
   wheel to it and reports it; what follows (going to the scene it came
   from) is the player's.
   A conclusion pushed with the place on screen it was reached flies from
   there: a lifted copy of its slip crosses to its place on the wheel
   while the wheel turns to it, and the slip shows once the copy lands.
   Without that place it grows in its place while the wheel turns to it.
   Colours come from the theme constants (--th-<name>) set around it.
   Inputs: items ({id: {parts: [{text} | {term} | {op} | {abc} | {gloss}],
   from: [ids], final}}), mode ('lecture' | 'practice').
   Commands: push, pushMs, set, focus, highlight, spotlight, mask,
   reveal, stop, clear. Events (via onEvent): itemTap, blankTap.
   ============================================================ */
function ConclusionStack(host, options) {
  var self = this;
  this.host = host;
  this.o = Object.assign({ items: {}, mode: 'lecture', onEvent: function () {} }, options);
  this.order = []; this.els = {}; this.size = {};
  this.masked = {}; this.held = []; this.spot = null; this.flash = [];
  this.p = 0; this.anim = null; this.flight = null; this.press = null; this.raf = 0;
  this.wheelTimer = 0;
  host.classList.add('tl-cs');
  host.classList.toggle('tl-cs-practice', this.o.mode !== 'lecture');
  host.innerHTML = '<div class="tl-cs-view" tabindex="0" role="list" aria-label="结论"></div><div class="tl-cs-over" aria-hidden="true"></div>';
  this.view = host.querySelector('.tl-cs-view'); this.over = host.querySelector('.tl-cs-over');
  var v = this.view;
  v.addEventListener('pointerdown', function (e) { self.onDown(e); });
  v.addEventListener('pointermove', function (e) { self.onMove(e); });
  v.addEventListener('pointerup', function (e) { self.onUp(e); });
  v.addEventListener('pointercancel', function () { self.cancelPress(); });
  v.addEventListener('wheel', function (e) { self.onWheel(e); }, { passive: false });
  v.addEventListener('keydown', function (e) { self.onKey(e); });
  if (window.ResizeObserver) new ResizeObserver(function () { self.measure(); self.frame(); }).observe(v);
}
// How big and how clear a conclusion is at a distance of 0, 1, 2, 3... from
// the focus (in conclusions), read between the steps.
ConclusionStack.SCALE = [1, .8, .68, .6];
ConclusionStack.ALPHA = [1, .82, .55, .3, 0];
ConclusionStack.GAP = 10;
ConclusionStack.PAD = 10;
ConclusionStack.MAX_W = 300;
ConclusionStack.X_W = 230;
// A board wider than this many times its height turns sideways.
ConclusionStack.SIDEWAYS = 1.6;
// A press that moves less than this is a tap; more, and it turns the wheel.
ConclusionStack.DRAG_PX = 6;
// Past either end the wheel gives only this much of the hand's movement.
ConclusionStack.RUBBER = .35;
// How far ahead a flick carries the wheel, in ms of its speed.
ConclusionStack.FLICK_MS = 180;
ConclusionStack.WHEEL_PX = 140;
ConclusionStack.WHEEL_IDLE_MS = 140;
ConclusionStack.MOVE_MS = 520;
ConclusionStack.FLY_MS = 800;
ConclusionStack.FLY_FADE = .14;
ConclusionStack.ARC = .16;
ConclusionStack.ARC_MAX = 64;
ConclusionStack.FLASH_MS = 2000;
ConclusionStack.OPS = {
  '=': '<path d="M3 6h10M3 10h10"/>',
  '≠': '<path d="M3 6h10M3 10h10M10.5 2.5l-5 11"/>',
  '+': '<path d="M8 3v10M3 8h10"/>',
  '→': '<path d="M2 8h11M9 4l4 4-4 4"/>'
};
ConclusionStack.OP_WORDS = { '=': '等于', '≠': '不等于', '+': '加', '→': '得出' };

ConclusionStack.esc = function (t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
ConclusionStack.still = function () { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
ConclusionStack.hasZh = function (t) { return /[\u3400-\u9fff]/.test(String(t)); };
ConclusionStack.table = function (t, d) {
  d = Math.abs(d);
  var i = Math.floor(d);
  if (i >= t.length - 1) return t[t.length - 1];
  return t[i] + (t[i + 1] - t[i]) * (d - i);
};
// The theme's easing curve, cubic-bezier(.6, 0, .25, 1), for motion moved
// frame by frame.
ConclusionStack.ease = function (t) {
  var x1 = .6, y1 = 0, x2 = .25, y2 = 1;
  var bx = function (u) { return 3 * u * (1 - u) * (1 - u) * x1 + 3 * u * u * (1 - u) * x2 + u * u * u; };
  var by = function (u) { return 3 * u * (1 - u) * (1 - u) * y1 + 3 * u * u * (1 - u) * y2 + u * u * u; };
  var lo = 0, hi = 1, u = t;
  for (var i = 0; i < 26; i++) { u = (lo + hi) / 2; if (bx(u) < t) lo = u; else hi = u; }
  return by(u);
};

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
// Text as HTML, every ♯ ♭ ♮ swapped for the library glyph, sized in em.
ConclusionStack.inline = function (text) {
  var G = ConclusionStack.glyphs(), s = 0.034, band = 14;
  return String(text).split(/([♯♭♮])/).map(function (part) {
    var acc = part === '♯' ? 1 : part === '♭' ? -1 : part === '♮' ? 0 : null;
    if (acc === null) return ConclusionStack.esc(part);
    var g = G[acc]; if (!g) return part;
    return '<svg class="tl-cs-acc" viewBox="' + (g.x - .5) + ' ' + (G.lineY - band) + ' ' + (g.w + 1) + ' ' + band * 2 + '" style="width:' + ((g.w + 1) * s).toFixed(3) + 'em;height:' + (band * 2 * s).toFixed(3) + 'em;vertical-align:' + (0.33 - band * s).toFixed(3) + 'em;margin:0 1px" aria-hidden="true"><path d="' + g.d + '"/></svg>';
  }).join('');
};
// A part's ABC as a whole tune: header lines from the part with defaults,
// K: last, then the music.
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
    return p.text || p.term || p.gloss || '';
  }).join(' ');
};

ConclusionStack.prototype.emit = function (type, data) { this.o.onEvent(Object.assign({ type: type }, data || {})); };
ConclusionStack.prototype.item = function (id) { return this.o.items[id] || { parts: [] }; };
ConclusionStack.prototype.known = function (list) {
  var self = this;
  return [].concat(list || []).filter(function (id) { return self.order.indexOf(id) >= 0; });
};
ConclusionStack.prototype.last = function () { return Math.max(0, this.order.length - 1); };
ConclusionStack.prototype.focusIndex = function () { return Math.max(0, Math.min(this.last(), Math.round(this.p))); };

/* ---------- drawing a slip ---------- */

// One conclusion as a slip: its step number (a seal for the answer), the
// steps it is built on as rings on its top edge, then its parts in a row
// that wraps by words, a second-language line under them.
ConclusionStack.prototype.slip = function (id) {
  var self = this, it = this.item(id), n = this.order.indexOf(id) + 1;
  var el = document.createElement('div');
  el.className = 'tl-cs-slip' + (it.final ? ' tl-cs-final' : '');
  el.dataset.id = id; el.setAttribute('role', 'listitem');
  var refs = this.known(it.from).filter(function (f) { return f !== id; }).map(function (f) { return self.order.indexOf(f) + 1; });
  el.innerHTML = (refs.length ? '<span class="tl-cs-refs" aria-hidden="true">' + refs.map(function (r) { return '<span class="tl-cs-ref">' + r + '</span>'; }).join('') + '</span>' : '') +
    (it.final ? '<span class="tl-cs-seal" aria-hidden="true"><span>∴</span></span>' : '<span class="tl-cs-num" aria-hidden="true">' + n + '</span>') + '<div class="tl-cs-body"></div>';
  var body = el.querySelector('.tl-cs-body');
  (it.parts || []).forEach(function (p) {
    if (p.abc) { body.appendChild(self.staff(p.abc)); return; }
    var s = document.createElement('span');
    if (p.op) { s.className = 'tl-cs-op'; s.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' + (ConclusionStack.OPS[p.op] || '') + '</svg>'; }
    else if (p.gloss) { s.className = 'tl-cs-gloss'; s.setAttribute('lang', 'en'); s.innerHTML = ConclusionStack.inline(p.gloss); }
    else {
      var t = p.term || p.text || '';
      s.className = 'tl-cs-text' + (p.term ? ' tl-cs-term' : '') + (ConclusionStack.hasZh(t) ? ' tl-cs-zh' : '');
      s.innerHTML = ConclusionStack.inline(t);
    }
    body.appendChild(s);
  });
  el.setAttribute('aria-label', (it.final ? '答案：' : '第 ' + n + ' 步：') + ConclusionStack.words(it));
  return el;
};

// A part's ABC on a short stave cropped to what is drawn (clef, key and
// time signature, notes; not the bare stave lines).
ConclusionStack.prototype.staff = function (abc) {
  var holder = document.createElement('span'); holder.className = 'tl-cs-staff';
  var box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:700px;visibility:hidden';
  document.body.appendChild(box);
  ABCJS.renderAbc(box, ConclusionStack.tune(abc), { add_classes: true, staffwidth: 560, paddingleft: 0, paddingright: 0, paddingtop: 0, paddingbottom: 0 });
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
  svg.style.width = (w * .8).toFixed(1) + 'px';
  holder.appendChild(svg);
  box.remove();
  return holder;
};

/* ---------- the wheel ---------- */

// Reads the board's size: which way the wheel turns, how wide a slip is,
// and each slip's length along the wheel at full size.
ConclusionStack.prototype.measure = function () {
  var self = this, C = ConclusionStack, v = this.view, W = v.clientWidth, H = v.clientHeight;
  if (!W || !H) return;
  this.W = W; this.H = H;
  this.axis = W > H * C.SIDEWAYS ? 'x' : 'y';
  this.host.classList.toggle('tl-cs-x', this.axis === 'x');
  this.host.classList.toggle('tl-cs-y', this.axis === 'y');
  this.w = this.axis === 'y' ? Math.min(C.MAX_W, W - 2 * C.PAD) : Math.min(C.X_W, Math.round(W * .62));
  this.order.forEach(function (id) {
    var el = self.els[id];
    el.style.width = self.w + 'px';
    var h = el.offsetHeight;
    var fit = self.axis === 'x' ? Math.min(1, (H - 2 * 6) / h) : Math.min(1, (H * .7) / h);
    self.size[id] = { len: self.axis === 'y' ? h : self.w, cross: self.axis === 'y' ? self.w : h, fit: fit };
  });
};

// Where every slip stands for a wheel position p (a conclusion's index,
// between two while it turns): the focus at the middle, each neighbour
// packed against the next by its shrunken length.
ConclusionStack.prototype.geometry = function (p) {
  var self = this, C = ConclusionStack, n = this.order.length, out = [];
  if (!n || !this.W) return out;
  this.order.forEach(function (id, i) {
    var sz = self.size[id], el = self.els[id], g = el._grow === undefined ? 1 : el._grow;
    if (!sz) { self.measure(); sz = self.size[id]; }
    var s = sz.fit * C.table(C.SCALE, i - p);
    out.push({ id: id, el: el, sz: sz, s: s * (.85 + .15 * g), ext: sz.len * s * g, gap: C.GAP * s * g, a: C.table(C.ALPHA, i - p) * g });
  });
  var D = function (i) { return (out[i].ext + out[i + 1].ext) / 2 + (out[i].gap + out[i + 1].gap) / 2; };
  var mid = (this.axis === 'y' ? this.H : this.W) / 2;
  var f = Math.max(0, Math.min(n - 1, Math.floor(p))), t = p - f;
  var step = t >= 0 && f < n - 1 ? D(f) : out[f].ext + out[f].gap;
  out[f].c = mid - t * step;
  for (var i = f + 1; i < n; i++) out[i].c = out[i - 1].c + D(i - 1);
  for (var j = f - 1; j >= 0; j--) out[j].c = out[j + 1].c - D(j);
  return out;
};

// Puts every slip where it stands now; the nearest the focus paints on top.
ConclusionStack.prototype.frame = function () {
  var self = this, G = this.geometry(this.p), fi = this.focusIndex(), lit = this.held.concat(this.flash);
  G.forEach(function (g, i) {
    var el = g.el, len = g.sz.len, cross = g.sz.cross;
    var dim = self.spot && self.spot.indexOf(g.id) < 0 ? .35 : 1;
    var x = self.axis === 'y' ? (self.W - cross) / 2 : g.c - len / 2;
    var y = self.axis === 'y' ? g.c - len / 2 : (self.H - cross) / 2;
    el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + g.s.toFixed(4) + ')';
    el.style.opacity = (g.a * dim).toFixed(3);
    el.style.visibility = g.a < .02 ? 'hidden' : '';
    el.style.zIndex = String(100 - Math.round(Math.abs(i - self.p) * 10));
    el.classList.toggle('tl-cs-focus', i === fi);
    el.classList.toggle('tl-lit', lit.indexOf(g.id) >= 0);
  });
};

// The wheel's motion, one frame at a time: a glide to a conclusion, a
// slip growing into its place, a slip flying in. Whatever starts one of
// them calls kick, so it runs even when the others have nothing to do.
ConclusionStack.prototype.kick = function () {
  var self = this;
  if (this.raf) return;
  this.raf = requestAnimationFrame(function tick(now) {
    self.raf = 0;
    var busy = false, C = ConclusionStack;
    if (self.anim) {
      var a = self.anim, t = Math.min(1, (now - a.t0) / a.ms);
      self.p = a.from + (a.to - a.from) * C.ease(t);
      if (t >= 1) self.anim = null; else busy = true;
    }
    self.order.forEach(function (id) {
      var el = self.els[id]; if (el._growT0 === undefined) return;
      var t = Math.min(1, (now - el._growT0) / C.MOVE_MS);
      el._grow = C.ease(t);
      if (t >= 1) { delete el._growT0; delete el._grow; } else busy = true;
    });
    self.frame();
    if (self.flight) { self.flyFrame(now); busy = busy || !!self.flight; }
    if (busy) self.raf = requestAnimationFrame(tick);
  });
};
ConclusionStack.prototype.glide = function (to, ms) {
  to = Math.max(0, Math.min(this.last(), to));
  if (ConclusionStack.still() || Math.abs(to - this.p) < .001) { this.anim = null; this.p = to; this.frame(); return; }
  this.anim = { from: this.p, to: to, t0: performance.now(), ms: ms || Math.min(620, 260 + 140 * Math.abs(to - this.p)) };
  this.kick();
};
// The distance between two neighbours' middles near the focus, so the
// wheel follows the hand one for one.
ConclusionStack.prototype.unit = function () {
  var G = this.geometry(this.p), f = this.focusIndex();
  if (G.length < 2) return 80;
  var a = G[Math.max(0, f - 1)], b = G[Math.min(G.length - 1, Math.max(1, f))];
  return Math.max(30, Math.abs(b.c - a.c) || 80);
};

/* ---------- flying in ---------- */

// A lifted copy of the new slip rises from the middle of the place it was
// reached (a rect in screen pixels) and travels on a shallow bow to the
// slip's place on the wheel, read on screen every frame while the wheel
// turns; places are worked out in the stack's own pixels, so a scaled
// stage does not throw the flight off.
ConclusionStack.prototype.fly = function (el, from) {
  var host = this.host, k = this.k(), hr = host.getBoundingClientRect();
  el.classList.add('tl-cs-landing');
  var flyer = el.cloneNode(true);
  flyer.classList.remove('tl-cs-landing', 'tl-cs-focus'); flyer.classList.add('tl-cs-flyer');
  flyer.removeAttribute('role'); flyer.removeAttribute('data-id'); flyer.removeAttribute('aria-label');
  flyer.style.cssText = 'width:' + this.w + 'px;opacity:0;z-index:9';
  this.over.appendChild(flyer);
  this.flight = { el: el, flyer: flyer, t0: performance.now(), sx: (from.left + from.width / 2 - hr.left) / k, sy: (from.top + from.height / 2 - hr.top) / k, fw: flyer.offsetWidth, fh: flyer.offsetHeight };
  this.kick();
};
ConclusionStack.prototype.k = function () { var r = this.host.getBoundingClientRect(); return r.width / (this.host.offsetWidth || 1) || 1; };
ConclusionStack.prototype.flyFrame = function (now) {
  var C = ConclusionStack, f = this.flight, t = Math.min(1, (now - f.t0) / C.FLY_MS), e = C.ease(t);
  var k = this.k(), h = this.host.getBoundingClientRect(), r = f.el.getBoundingClientRect();
  var tx = (r.left + r.width / 2 - h.left) / k, ty = (r.top + r.height / 2 - h.top) / k, ts = (r.width / k) / f.fw;
  var dx = tx - f.sx, dy = ty - f.sy, dist = Math.sqrt(dx * dx + dy * dy) || 1;
  var nx = -dy / dist, ny = dx / dist;
  if (nx < 0) { nx = -nx; ny = -ny; }
  var bow = Math.min(C.ARC_MAX, dist * C.ARC) * Math.sin(Math.PI * e);
  var cx = f.sx + dx * e + nx * bow, cy = f.sy + dy * e + ny * bow, sc = .9 + (ts - .9) * e;
  f.flyer.style.transform = 'translate(' + (cx - f.fw / 2).toFixed(1) + 'px,' + (cy - f.fh / 2).toFixed(1) + 'px) scale(' + sc.toFixed(4) + ')';
  f.flyer.style.opacity = String(Math.min(1, t / C.FLY_FADE));
  if (t >= 1) this.land(true);
};
// Ends a flight: the copy goes and the slip shows where it landed; on a
// real landing the answer's seal stamps and the steps it is built on
// light for a moment.
ConclusionStack.prototype.land = function (landed) {
  var f = this.flight; if (!f) return;
  this.flight = null;
  f.flyer.remove();
  f.el.classList.remove('tl-cs-landing');
  if (landed) this.settled(f.el.dataset.id, true);
};
ConclusionStack.prototype.settled = function (id, animated) {
  var self = this, el = this.els[id]; if (!el) return;
  var seal = el.querySelector('.tl-cs-seal');
  if (seal && animated && !ConclusionStack.still()) seal.animate([{ transform: 'scale(1.7) rotate(-20deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.2, 1.5, .4, 1)', fill: 'backwards' });
  this.flash = this.known(this.item(id).from).filter(function (f) { return f !== id; });
  this.frame();
  clearTimeout(this.flashTimer);
  this.flashTimer = setTimeout(function () { self.flash = []; self.frame(); }, ConclusionStack.FLASH_MS);
};

/* ---------- the child's hand ---------- */

ConclusionStack.prototype.pos = function (e) { return this.axis === 'x' ? e.clientX : e.clientY; };
ConclusionStack.prototype.onDown = function (e) {
  if (e.button > 0 || !this.order.length) return;
  this.anim = null;
  this.press = { x: e.clientX, y: e.clientY, at: this.pos(e), p0: this.p, unit: this.unit(), drag: false, samples: [{ t: performance.now(), v: this.pos(e) }] };
  try { this.view.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
};
ConclusionStack.prototype.onMove = function (e) {
  var pr = this.press; if (!pr) return;
  if (!pr.drag && (Math.abs(e.clientX - pr.x) > ConclusionStack.DRAG_PX || Math.abs(e.clientY - pr.y) > ConclusionStack.DRAG_PX)) { pr.drag = true; this.view.classList.add('tl-cs-grab'); }
  if (!pr.drag) return;
  e.preventDefault();
  var C = ConclusionStack, np = pr.p0 - (this.pos(e) - pr.at) / (pr.unit * this.k()), last = this.last();
  if (np < 0) np *= C.RUBBER; else if (np > last) np = last + (np - last) * C.RUBBER;
  this.p = np;
  pr.samples.push({ t: performance.now(), v: this.pos(e) });
  if (pr.samples.length > 6) pr.samples.shift();
  this.frame();
};
ConclusionStack.prototype.onUp = function (e) {
  var pr = this.press; if (!pr) return;
  this.press = null; this.view.classList.remove('tl-cs-grab');
  if (!pr.drag) { this.tapAt(e); return; }
  var s = pr.samples, a = s[0], b = s[s.length - 1], speed = b.t > a.t ? -(b.v - a.v) / (b.t - a.t) / (pr.unit * this.k()) : 0;
  this.glide(Math.round(this.p + speed * ConclusionStack.FLICK_MS));
};
ConclusionStack.prototype.cancelPress = function () {
  if (!this.press) return;
  this.press = null; this.view.classList.remove('tl-cs-grab');
  this.glide(Math.round(this.p));
};
ConclusionStack.prototype.onWheel = function (e) {
  if (!this.order.length) return;
  e.preventDefault();
  var self = this, C = ConclusionStack, d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (e.deltaMode === 1) d *= 16;
  this.anim = null;
  this.p = Math.max(-.3, Math.min(this.last() + .3, this.p + d / C.WHEEL_PX));
  this.frame();
  clearTimeout(this.wheelTimer);
  this.wheelTimer = setTimeout(function () { self.glide(Math.round(self.p)); }, C.WHEEL_IDLE_MS);
};
ConclusionStack.prototype.onKey = function (e) {
  var d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (d) { e.preventDefault(); this.glide(this.focusIndex() + d); return; }
  if ((e.key === 'Enter' || e.key === ' ') && this.order.length) { e.preventDefault(); this.tap(this.order[this.focusIndex()], null); }
};
// A tap goes to the slip under the finger that is nearest the focus; a
// slip turned out of sight cannot be tapped.
ConclusionStack.prototype.tapAt = function (e) {
  var self = this, vr = this.view.getBoundingClientRect(), x = e.clientX, y = e.clientY, best = null, bd = Infinity;
  if (x >= vr.left && x <= vr.right && y >= vr.top && y <= vr.bottom) {
    this.order.forEach(function (id, i) {
      var el = self.els[id];
      if (el.style.visibility === 'hidden' || parseFloat(el.style.opacity) < .15) return;
      var r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      var d = Math.abs(i - self.p); if (d < bd) { bd = d; best = id; }
    });
  }
  if (!best) { this.emit('blankTap', {}); return; }
  this.tap(best, e);
};
ConclusionStack.prototype.tap = function (id, e) {
  var el = this.els[id], it = this.item(id); if (!el) return;
  if (this.o.mode !== 'lecture') return;
  el.classList.add('tl-cs-down'); setTimeout(function () { el.classList.remove('tl-cs-down'); }, 200);
  if (e) this.ripple(e);
  this.glide(this.order.indexOf(id));
  var hidden = !!this.masked[id];
  this.emit('itemTap', { id: id, step: this.order.indexOf(id) + 1, final: !!it.final, text: hidden ? null : ConclusionStack.words(it), hidden: hidden });
};
ConclusionStack.prototype.ripple = function (e) {
  var rect = this.host.getBoundingClientRect(), k = this.k(), r = document.createElement('div'); r.className = 'tl-cs-ripple';
  r.style.left = (e.clientX - rect.left) / k + 'px'; r.style.top = (e.clientY - rect.top) / k + 'px';
  this.over.appendChild(r);
  setTimeout(function () { r.remove(); }, 600);
};

/* ---------- masks ---------- */

ConclusionStack.prototype.applyMasks = function (animated) {
  var self = this;
  this.order.forEach(function (id) {
    var el = self.els[id], body = el.querySelector('.tl-cs-body'), on = !!self.masked[id];
    var cover = body.querySelector(':scope > .tl-cs-cover');
    if (on && !cover) {
      cover = document.createElement('span'); cover.className = 'tl-cs-cover'; cover.innerHTML = '<span class="tl-cs-q">?</span>';
      body.appendChild(cover); body.classList.add('tl-cs-hidden');
    } else if (!on && cover) {
      body.classList.remove('tl-cs-hidden');
      if (animated && !ConclusionStack.still()) {
        body.querySelectorAll(':scope > :not(.tl-cs-cover)').forEach(function (c) { c.classList.remove('tl-cs-ink'); void c.offsetWidth; c.classList.add('tl-cs-ink'); });
        cover.classList.add('off'); setTimeout(function () { cover.remove(); }, 480);
      } else cover.remove();
    }
  });
};

/* ---------- commands ---------- */

// The conclusion of this act joins the wheel after the others, and the
// wheel turns to it. With opts.from (a rect on screen) it flies there
// from that place; without, it grows in its place, and the frame loop is
// kicked for the growth itself, since the wheel may already stand where
// it is going (the first conclusion) and then has no glide to run.
ConclusionStack.prototype.push = function (id, opts) {
  var self = this, from = opts && opts.from;
  if (!this.o.items[id] || this.order.indexOf(id) >= 0) return;
  this.land(true);
  this.order.push(id);
  var el = this.slip(id);
  this.els[id] = el; this.view.appendChild(el);
  this.applyMasks(false);
  this.measure();
  if (ConclusionStack.still()) { this.anim = null; this.p = this.last(); this.frame(); this.settled(id, false); return; }
  if (from && from.width >= 0) this.fly(el, from);
  else {
    el._grow = 0; el._growT0 = performance.now();
    this.kick();
    setTimeout(function () { self.settled(id, true); }, ConclusionStack.MOVE_MS);
  }
  this.glide(this.last(), ConclusionStack.MOVE_MS);
};
// How long a push takes to come to rest, so whoever pushed can wait.
ConclusionStack.prototype.pushMs = function (opts) {
  if (ConclusionStack.still()) return 0;
  return opts && opts.from ? ConclusionStack.FLY_MS + 60 : ConclusionStack.MOVE_MS + 60;
};
// Shows exactly these conclusions, turned to the last, with no motion;
// used when the player goes back a scene, skips one, or opens a lecture
// again at a scene. A flight under way lands at once.
ConclusionStack.prototype.set = function (ids) {
  var self = this, seen = {};
  this.land(false); this.anim = null;
  this.order = [].concat(ids || []).filter(function (id) { if (!self.o.items[id] || seen[id]) return false; seen[id] = true; return true; });
  this.view.innerHTML = ''; this.els = {}; this.size = {};
  this.order.forEach(function (id) { var el = self.slip(id); self.els[id] = el; self.view.appendChild(el); });
  this.applyMasks(false);
  this.flash = [];
  this.measure();
  this.p = this.last();
  this.frame();
};
ConclusionStack.prototype.focus = function (id) { var i = this.order.indexOf(id); if (i >= 0) this.glide(i); };
ConclusionStack.prototype.highlight = function (ids) { this.held = this.known(ids); this.frame(); };
ConclusionStack.prototype.spotlight = function (ids) { this.spot = ids && ids.length ? this.known(ids) : null; this.frame(); };
ConclusionStack.prototype.mask = function (ids) { var self = this; [].concat(ids || []).forEach(function (id) { self.masked[id] = true; }); this.applyMasks(false); };
ConclusionStack.prototype.reveal = function (ids) { var self = this; [].concat(ids || []).forEach(function (id) { delete self.masked[id]; }); this.applyMasks(true); };
// Stops anything moving: a glide ends where it was going, a flight lands.
ConclusionStack.prototype.stop = function () {
  if (this.anim) { this.p = this.anim.to; this.anim = null; }
  this.land(true);
  this.frame();
};
ConclusionStack.prototype.clear = function () { this.held = []; this.spot = null; this.masked = {}; this.set([]); };

