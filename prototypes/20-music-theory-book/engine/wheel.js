/* ============================================================
   Wheel. Turns a row or a column of items that does not fit its view
   into a wheel: the item in focus stands in the middle at full size,
   the ones before and after shrink and fade with their distance from
   it, packed against each other. A finger, a mouse wheel or a mouse
   drag turns it, it comes to rest on the nearest item, it gives a
   little past either end, and a flick carries it on. The items stay in
   the view's normal flow; the wheel only moves and scales them, so the
   component that owns them keeps laying them out. Regions of the stage
   and components that hold more than fits use this one wheel.

   new Wheel(view, { axis: 'y' | 'x', items: () => [elements],
                     onTurn: (index) => {} })
     on(active)       turns the wheel on (items move) or off (natural flow)
     focus(i, anim)   turns to item i
     layout()         measures again after the items or the view changed
     destroy()
   The view must be the items' offset parent (position relative or
   absolute) and clip what it holds.
   ============================================================ */
var Wheel = (function () {
  var SCALE = [1, .8, .68, .6], ALPHA = [1, .82, .55, .3, 0];
  var DRAG_PX = 6, RUBBER = .35, FLICK_MS = 180, WHEEL_PX = 140, IDLE_MS = 140;

  function still() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function table(t, d) { d = Math.abs(d); var i = Math.floor(d); if (i >= t.length - 1) return t[t.length - 1]; return t[i] + (t[i + 1] - t[i]) * (d - i); }
  // The motion curve the stage uses everywhere, cubic-bezier(.6, 0, .25, 1).
  function ease(t) {
    var bx = function (u) { return 3 * u * (1 - u) * (1 - u) * .6 + 3 * u * u * (1 - u) * .25 + u * u * u; };
    var by = function (u) { return 3 * u * u * (1 - u) + u * u * u; };
    var lo = 0, hi = 1, u = t;
    for (var i = 0; i < 24; i++) { u = (lo + hi) / 2; if (bx(u) < t) lo = u; else hi = u; }
    return by(u);
  }

  function Wheel(view, opts) {
    var self = this;
    this.view = view; this.o = Object.assign({ axis: 'y', items: function () { return []; }, onTurn: function () {} }, opts);
    this.active = false; this.p = 0; this.anim = null; this.press = null; this.raf = 0; this.timer = 0;
    this.down = function (e) { self.onDown(e); };
    this.move = function (e) { self.onMove(e); };
    this.up = function (e) { self.onUp(e); };
    this.wheel = function (e) { self.onWheel(e); };
    view.addEventListener('pointerdown', this.down);
    view.addEventListener('pointermove', this.move);
    view.addEventListener('pointerup', this.up);
    view.addEventListener('pointercancel', this.up);
    view.addEventListener('wheel', this.wheel, { passive: false });
  }

  Wheel.prototype.items = function () { return this.o.items().filter(function (el) { return el && !el.hidden; }); };
  Wheel.prototype.last = function () { return Math.max(0, this.items().length - 1); };
  Wheel.prototype.focusIndex = function () { return Math.max(0, Math.min(this.last(), Math.round(this.p))); };

  Wheel.prototype.on = function (active) {
    if (active === this.active) { if (active) this.layout(); return; }
    this.active = active;
    this.view.classList.toggle('wheel-on', active);
    if (!active) { this.anim = null; this.items().forEach(function (el) { el.style.transform = ''; el.style.opacity = ''; el.style.zIndex = ''; el.style.visibility = ''; }); return; }
    this.p = Math.max(0, Math.min(this.last(), this.p));
    this.layout();
  };

  // Each item's natural middle and length along the axis, read from the
  // flow (transforms do not change offsets).
  Wheel.prototype.measure = function () {
    var y = this.o.axis === 'y';
    return this.items().map(function (el) {
      var len = y ? el.offsetHeight : el.offsetWidth, at = y ? el.offsetTop : el.offsetLeft;
      return { el: el, len: len, mid: at + len / 2 };
    });
  };

  Wheel.prototype.layout = function () {
    if (!this.active) return;
    var y = this.o.axis === 'y', items = this.measure(), n = items.length, p = this.p;
    if (!n) return;
    var gaps = [];
    for (var g = 0; g < n - 1; g++) gaps.push(Math.max(0, items[g + 1].mid - items[g].mid - (items[g].len + items[g + 1].len) / 2));
    var s = items.map(function (it, i) { return table(SCALE, i - p); });
    var D = function (i) { return (items[i].len * s[i] + items[i + 1].len * s[i + 1]) / 2 + gaps[i] * (s[i] + s[i + 1]) / 2; };
    var mid = (y ? this.view.clientHeight : this.view.clientWidth) / 2;
    var f = Math.max(0, Math.min(n - 1, Math.floor(p))), t = p - f, c = [];
    c[f] = mid - t * (f < n - 1 ? D(f) : 0);
    for (var i = f + 1; i < n; i++) c[i] = c[i - 1] + D(i - 1);
    for (var j = f - 1; j >= 0; j--) c[j] = c[j + 1] - D(j);
    items.forEach(function (it, i) {
      var d = (c[i] - it.mid).toFixed(1), a = table(ALPHA, i - p);
      it.el.style.transformOrigin = 'center';
      it.el.style.transform = (y ? 'translateY(' + d + 'px)' : 'translateX(' + d + 'px)') + ' scale(' + s[i].toFixed(4) + ')';
      it.el.style.opacity = a.toFixed(3);
      it.el.style.visibility = a < .02 ? 'hidden' : '';
      it.el.style.zIndex = String(100 - Math.round(Math.abs(i - p) * 10));
    });
  };

  Wheel.prototype.kick = function () {
    var self = this;
    if (this.raf) return;
    this.raf = requestAnimationFrame(function tick(now) {
      self.raf = 0;
      var a = self.anim; if (!a) return;
      var t = Math.min(1, (now - a.t0) / a.ms);
      self.p = a.from + (a.to - a.from) * ease(t);
      self.layout();
      if (t >= 1) { self.anim = null; self.o.onTurn(self.focusIndex()); return; }
      self.raf = requestAnimationFrame(tick);
    });
  };
  Wheel.prototype.focus = function (i, animated) {
    var to = Math.max(0, Math.min(this.last(), i));
    if (!this.active || animated === false || still() || Math.abs(to - this.p) < .001) { this.anim = null; this.p = to; this.layout(); this.o.onTurn(this.focusIndex()); return; }
    this.anim = { from: this.p, to: to, t0: performance.now(), ms: Math.min(620, 260 + 140 * Math.abs(to - this.p)) };
    this.kick();
  };

  // The distance between neighbouring middles near the focus, so the
  // wheel follows the hand one for one.
  Wheel.prototype.unit = function () {
    var items = this.measure(), f = this.focusIndex();
    if (items.length < 2) return 80;
    var a = items[Math.max(0, f - 1)], b = items[Math.min(items.length - 1, Math.max(1, f))];
    return Math.max(30, Math.abs(b.mid - a.mid) * table(SCALE, 0.5) || 80);
  };
  Wheel.prototype.pos = function (e) { return this.o.axis === 'y' ? e.clientY : e.clientX; };
  Wheel.prototype.k = function () { var r = this.view.getBoundingClientRect(); return (this.o.axis === 'y' ? r.height / (this.view.offsetHeight || 1) : r.width / (this.view.offsetWidth || 1)) || 1; };
  Wheel.prototype.onDown = function (e) {
    if (!this.active || e.button > 0) return;
    this.anim = null;
    this.press = { x: e.clientX, y: e.clientY, at: this.pos(e), p0: this.p, unit: this.unit() * this.k(), drag: false, id: e.pointerId, samples: [{ t: performance.now(), v: this.pos(e) }] };
  };
  Wheel.prototype.onMove = function (e) {
    var pr = this.press; if (!pr) return;
    if (!pr.drag && (Math.abs(e.clientX - pr.x) > DRAG_PX || Math.abs(e.clientY - pr.y) > DRAG_PX)) {
      pr.drag = true;
      try { this.view.setPointerCapture(pr.id); } catch (err) { /* the pointer is already gone */ }
    }
    if (!pr.drag) return;
    e.preventDefault();
    var np = pr.p0 - (this.pos(e) - pr.at) / pr.unit, last = this.last();
    if (np < 0) np *= RUBBER; else if (np > last) np = last + (np - last) * RUBBER;
    this.p = np;
    pr.samples.push({ t: performance.now(), v: this.pos(e) });
    if (pr.samples.length > 6) pr.samples.shift();
    this.layout();
  };
  // A drag ends in a glide to the nearest item (further for a flick) and
  // the click it would make is swallowed; a tap goes through to the item.
  Wheel.prototype.onUp = function (e) {
    var pr = this.press; if (!pr) return;
    this.press = null;
    if (!pr.drag) return;
    var s = pr.samples, a = s[0], b = s[s.length - 1];
    var speed = b.t > a.t ? -(b.v - a.v) / (b.t - a.t) / pr.unit : 0;
    this.focus(Math.round(this.p + speed * FLICK_MS));
    var v = this.view, swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); v.removeEventListener('click', swallow, true); };
    v.addEventListener('click', swallow, true);
    setTimeout(function () { v.removeEventListener('click', swallow, true); }, 0);
  };
  Wheel.prototype.onWheel = function (e) {
    if (!this.active) return;
    e.preventDefault();
    var self = this, d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (e.deltaMode === 1) d *= 16;
    this.anim = null;
    this.p = Math.max(-.3, Math.min(this.last() + .3, this.p + d / WHEEL_PX));
    this.layout();
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.focus(Math.round(self.p)); }, IDLE_MS);
  };

  Wheel.prototype.destroy = function () {
    this.on(false);
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.view.removeEventListener('pointerdown', this.down);
    this.view.removeEventListener('pointermove', this.move);
    this.view.removeEventListener('pointerup', this.up);
    this.view.removeEventListener('pointercancel', this.up);
    this.view.removeEventListener('wheel', this.wheel);
  };

  return Wheel;
})();
