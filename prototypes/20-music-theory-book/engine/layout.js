/* ============================================================
   Stage layout and motion. Executes a workflow's `screens` and
   `layouts`: picks the variant of a layout whose screen condition holds,
   divides the stage into its regions (columns, rows and an area map, as
   a CSS grid), puts each control the scene places in a region into it,
   and sizes what a region holds by the region's settings: a control's
   own size (fit none), stretched to the region (fit fill), or scaled as
   a whole into it (fit contain, between the zoom bounds; drawn first at
   `width`); a region with a maxHeight is as tall as what it holds. What
   does not fit at the smallest zoom turns into a wheel when the region
   says so (several controls), or is asked to fit its box (one control).
   Between two arrangements every control that stays glides from where it
   was to where it is; one that comes in rises or grows out of a target;
   one that leaves fades or flies into a target.

   Nothing here knows a workflow, a control or a component: controls are
   named slots the lecture engine hands over.

   new StageLayout(frame, { layouts, screens, slot(name), present(name),
     fluid(name), relayout(name), box(name, size), itemRect(name, ref),
     trace(name, motion, hit), problem(text) })
     arrange(layout, place, how)   how: { animate, enter, exit }
     leave(name, motion)           one control leaves the stage now
     focus(name)                   turns a region's wheel to that control
     rectOf(target)                a target's rect on screen
     fit()                         sizes every region again
   ============================================================ */
var StageLayout = (function () {
  var MOVE_MS = 520, FADE_MS = 300, FLY_MS = 700, ENTER_DELAY = 140, STAGGER = 110, EASE = 'cubic-bezier(.6, 0, .25, 1)';
  var WINGS_W = 760, GAP = 10, FIT_GAP = 16, RELAYOUT_MS = 220;
  var CSS = [
    '.lx-stage{position:fixed;inset:0;overflow:hidden;overflow:clip;isolation:isolate;overscroll-behavior:none;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;',
    'background:radial-gradient(80% 70% at 50% 40%,var(--th-backdrop-a),var(--th-backdrop-b) 70%,var(--th-backdrop-c))}',
    '.lx-frame{position:absolute;inset:max(10px,env(safe-area-inset-top,0px)) max(10px,env(safe-area-inset-right,0px)) max(10px,env(safe-area-inset-bottom,0px)) max(10px,env(safe-area-inset-left,0px));display:grid;gap:8px 12px;padding:10px 12px 12px;box-sizing:border-box;border-radius:26px;overflow:hidden;overflow:clip;',
    'background:radial-gradient(70% 60% at 18% 8%,color-mix(in srgb,var(--th-frame-glow-a) 55%,transparent),transparent 70%),radial-gradient(60% 55% at 88% 12%,color-mix(in srgb,var(--th-frame-glow-b) 45%,transparent),transparent 70%),radial-gradient(90% 70% at 50% 110%,color-mix(in srgb,var(--th-frame-glow-c) 70%,transparent),transparent 70%),var(--th-frame);',
    'box-shadow:0 30px 80px -20px color-mix(in srgb,var(--th-dark) 70%,transparent),0 0 0 1px color-mix(in srgb,var(--th-frame-glow-c) 12%,transparent)}',
    '.lx-frame::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 140px 20px color-mix(in srgb,var(--th-frame-shade) 14%,transparent);border-radius:inherit;z-index:8}',
    '@media (max-width:600px){.lx-frame{inset:max(6px,env(safe-area-inset-top,0px)) max(6px,env(safe-area-inset-right,0px)) max(6px,env(safe-area-inset-bottom,0px)) max(6px,env(safe-area-inset-left,0px));gap:6px 8px;padding:8px;border-radius:20px}}',
    // A region is only a frame for what it holds: it never takes a touch
    // itself, so a region laid over another (a popup) lets touches through
    // where it holds nothing.
    '.lx-region{position:relative;min-width:0;min-height:0;display:flex;gap:' + GAP + 'px;align-items:center;pointer-events:none}',
    '.lx-region[data-flow="column"]{flex-direction:column}',
    '.lx-region[data-fit="fill"]{display:grid;grid-template:minmax(0,1fr)/minmax(0,1fr);align-items:stretch;justify-items:stretch}',
    '.lx-region[data-fit="fill"] > .lx-slot,.lx-region[data-fit="fill"] .lx-mover,.lx-region[data-fit="fill"] .lx-host{height:100%;min-height:0}',
    '.lx-region[data-fit="contain"]{display:block}',
    '.lx-region[hidden]{display:none}',
    '.lx-fit{position:absolute;left:0;top:0;display:flex;flex-direction:column;gap:' + FIT_GAP + 'px;transform-origin:0 0}',
    '.lx-fit[data-flow="row"]{flex-direction:row;align-items:center}',
    '.lx-fit.wheel-on{overflow:hidden;overflow:clip;pointer-events:auto}',
    '.lx-slot{position:relative;min-width:0;flex:0 1 auto;display:flex;flex-direction:column;pointer-events:auto}',
    '.lx-slot.lx-grow{flex:1 1 auto}',
    '.lx-slot:has(> .lx-mover > .lx-host > :only-child[hidden]){display:none}',
    '.lx-mover{position:relative;min-width:0;display:flex;flex-direction:column}',
    '.lx-host{position:relative;min-width:0}',
    '.lx-wings{position:absolute;left:0;top:0;width:' + WINGS_W + 'px;visibility:hidden;pointer-events:none}',
    '.lx-wings .lx-slot{pointer-events:none}',
    '.lx-fx{position:absolute;inset:0;pointer-events:none;z-index:9}',
    '.lx-ghost{position:absolute;margin:0;transform-origin:0 0;pointer-events:none}'
  ].join('');

  function still() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function rect(el) { var r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
  function inject() { if (document.getElementById('lx-layout-style')) return; var s = document.createElement('style'); s.id = 'lx-layout-style'; s.textContent = CSS; document.head.appendChild(s); }
  function arr(x) { return x === undefined || x === null ? [] : [].concat(x); }
  function merge(a, b) {
    var out = Object.assign({}, a);
    Object.keys(b || {}).forEach(function (k) { out[k] = Object.assign({}, a && a[k], b[k]); });
    return out;
  }
  function px(v, of) {
    if (v === undefined || v === null) return null;
    var s = String(v);
    return /%$/.test(s) ? parseFloat(s) / 100 * of : parseFloat(s);
  }
  // A slot as it stands in plain flow, without what a wheel set on it;
  // the wheel of the region it goes to sets its own again.
  function bare(s) { s.style.transform = ''; s.style.opacity = ''; s.style.visibility = ''; s.style.zIndex = ''; }

  function StageLayout(frame, o) {
    var self = this;
    inject();
    this.frame = frame; this.o = o;
    this.regions = {}; this.fits = {}; this.wheels = {}; this.focused = {};
    this.where = {}; this.cur = null; this.timer = 0;
    this.wings = document.createElement('div'); this.wings.className = 'lx-wings'; this.wings.setAttribute('aria-hidden', 'true');
    this.fx = document.createElement('div'); this.fx.className = 'lx-fx';
    frame.appendChild(this.wings); frame.appendChild(this.fx);
    this.ro = new ResizeObserver(function () { self.fit(); });
    this.ro.observe(frame);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self.fit(); });
  }

  // A layout's variants with the layout's shared region settings and
  // placement folded into each.
  StageLayout.prototype.variants = function (name) {
    var L = this.o.layouts[name];
    return arr(L.variants).map(function (v, i) {
      return { index: i, when: v.when, columns: v.columns, rows: v.rows, areas: v.areas, regions: merge(L.regions || {}, v.regions || {}), place: L.place || {} };
    });
  };
  StageLayout.prototype.holds = function (when) {
    if (when === undefined) return true;
    var c = typeof when === 'string' ? this.o.screens[when] || {} : when;
    var w = this.frame.parentNode.clientWidth, h = this.frame.parentNode.clientHeight, a = w / Math.max(1, h);
    return !(c.minWidth !== undefined && w < c.minWidth) && !(c.maxWidth !== undefined && w > c.maxWidth) &&
      !(c.minHeight !== undefined && h < c.minHeight) && !(c.maxHeight !== undefined && h > c.maxHeight) &&
      !(c.minAspect !== undefined && a < c.minAspect) && !(c.maxAspect !== undefined && a > c.maxAspect);
  };
  StageLayout.prototype.pick = function (name) {
    var vs = this.variants(name);
    for (var i = 0; i < vs.length; i++) if (this.holds(vs[i].when)) return vs[i];
    return vs[vs.length - 1];
  };

  StageLayout.prototype.region = function (name) {
    var el = this.regions[name];
    if (!el) {
      el = document.createElement('div'); el.className = 'lx-region'; el.setAttribute('data-region', name);
      this.frame.insertBefore(el, this.wings);
      this.regions[name] = el;
    }
    return el;
  };
  StageLayout.prototype.container = function (name, spec) {
    var el = this.region(name);
    if (spec.fit !== 'contain') return el;
    var f = this.fits[name];
    if (!f) {
      f = document.createElement('div'); f.className = 'lx-fit'; el.appendChild(f); this.fits[name] = f;
      this.wheels[name] = new Wheel(f, { axis: spec.flow === 'row' ? 'x' : 'y', items: function () { return [].slice.call(f.children); } });
      this.ro.observe(f);
    }
    f.setAttribute('data-flow', spec.flow === 'row' ? 'row' : 'column');
    return f;
  };

  // Where each control on stage stands on screen now.
  StageLayout.prototype.rects = function () {
    var self = this, out = {};
    Object.keys(this.where).forEach(function (n) {
      var s = self.o.slot(n); if (!s || s.parentNode === self.wings) return;
      var m = s.querySelector('.lx-mover'); if (m && m.offsetWidth) out[n] = { r: rect(m), w: m.offsetWidth };
    });
    return out;
  };

  // Lays the stage out by a layout and a placement (region → controls)
  // and moves what changed. A control placed nowhere waits offstage,
  // still laid out, so it can be drawn before it comes in.
  StageLayout.prototype.arrange = function (layout, place, how) {
    var self = this, o = this.o; how = how || {};
    var move = how.animate && !still();
    var before = move ? this.rects() : {};
    var v = this.pick(layout);
    this.cur = { layout: layout, place: place, v: v };
    var cols = arr(v.columns).join(' '), rows = arr(v.rows).join(' ');
    this.frame.style.gridTemplateColumns = cols;
    this.frame.style.gridTemplateRows = rows;
    this.frame.style.gridTemplateAreas = arr(v.areas).map(function (r) { return '"' + String(r).trim().split(/\s+/).join(' ') + '"'; }).join(' ');
    if (o.problem && ((cols && !this.frame.style.gridTemplateColumns) || (rows && !this.frame.style.gridTemplateRows) || (v.areas && !this.frame.style.gridTemplateAreas))) o.problem('排法 ' + layout + ' 的行、列或区域图不是合法的网格写法');
    var names = {};
    arr(v.areas).forEach(function (r) { String(r).trim().split(/\s+/).forEach(function (n) { if (n !== '.') names[n] = true; }); });
    Object.keys(v.regions).forEach(function (n) { if (v.regions[n].over && names[v.regions[n].over]) names[n] = true; });
    Object.keys(this.regions).forEach(function (n) { if (!names[n]) self.regions[n].hidden = true; });
    var placed = {};
    Object.keys(names).forEach(function (n) {
      var spec = v.regions[n] || {}, el = self.region(n), box = self.container(n, spec), fit = spec.fit || 'none';
      el.hidden = false;
      el.style.gridArea = spec.over || n;
      el.style.zIndex = String(spec.layer || 0);
      el.setAttribute('data-fit', fit);
      el.setAttribute('data-flow', spec.flow || 'column');
      el.style.justifyContent = fit === 'none' ? ({ start: 'flex-start', end: 'flex-end' }[spec.align] || 'center') : '';
      el.style.maxWidth = spec.maxWidth ? spec.maxWidth + 'px' : '';
      el.style.width = spec.maxWidth ? '100%' : '';
      el.style.justifySelf = spec.maxWidth ? 'center' : '';
      el.style.height = '';
      arr(place[n]).forEach(function (c) {
        if (placed[c] || !o.present(c)) return;
        var s = o.slot(c); if (!s) return;
        placed[c] = n;
        s.classList.toggle('lx-grow', spec.grow === c);
        bare(s);
        box.appendChild(s);
        self.ro.observe(s);
      });
    });
    Object.keys(this.where).concat(Object.keys(placed)).forEach(function (c) {
      if (placed[c]) return;
      var s = o.slot(c); if (s && s.parentNode !== self.wings) { bare(s); self.wings.appendChild(s); }
    });
    var entering = Object.keys(placed).filter(function (c) { return !self.where[c]; });
    this.where = placed;
    this.fit(entering);
    if (!move) return;
    var after = this.rects(), order = 0;
    Object.keys(before).forEach(function (c) {
      if (placed[c]) return;
      self.ghostOut(c, before[c], (how.exit && how.exit[c]) || { kind: 'fade' });
    });
    Object.keys(placed).forEach(function (c) {
      var m = o.slot(c).querySelector('.lx-mover'), a = after[c]; if (!a) return;
      if (before[c]) { self.flip(m, before[c].r, a.r); return; }
      self.comeIn(m, (how.enter && how.enter[c]) || { kind: 'rise' }, order++);
    });
  };

  // A control still on stage glides from its old rect to its new one.
  StageLayout.prototype.flip = function (m, b, a) {
    if (Math.abs(a.left - b.left) < .5 && Math.abs(a.top - b.top) < .5 && Math.abs(a.width - b.width) < .5) return;
    var k = a.width / (m.offsetWidth || 1) || 1;
    m.animate([{ transformOrigin: '0 0', transform: 'translate(' + ((b.left - a.left) / k).toFixed(1) + 'px,' + ((b.top - a.top) / k).toFixed(1) + 'px) scale(' + (b.width / a.width).toFixed(4) + ')' }, { transformOrigin: '0 0', transform: 'none' }], { duration: MOVE_MS, easing: EASE });
  };
  // A control coming in rises into place, or grows out of its target.
  StageLayout.prototype.comeIn = function (m, motion, order) {
    if (motion.kind === 'cut') return;
    if (motion.kind === 'fly' && motion.from) {
      var t = this.rectOf(motion.from), a = rect(m);
      if (t && a.width) {
        this.flip(m, { left: t.left + t.width / 2 - a.width * .05, top: t.top + t.height / 2 - a.height * .05, width: a.width * .1 }, a);
        m.animate([{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 1 }], { duration: MOVE_MS, easing: 'linear' });
        return;
      }
    }
    m.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: MOVE_MS, delay: ENTER_DELAY + order * STAGGER, easing: EASE, fill: 'backwards' });
  };
  // A copy of a control that has left, where it stood, fading there or
  // flying into its target and shrinking to the target's size.
  StageLayout.prototype.ghostOut = function (c, b, motion) {
    if (motion.kind === 'cut') return;
    var s = this.o.slot(c), m = s && s.querySelector('.lx-mover'); if (!m) return;
    var fr = rect(this.frame), g = m.cloneNode(true), k = b.r.width / (b.w || 1);
    g.classList.add('lx-ghost'); g.setAttribute('aria-hidden', 'true'); g.removeAttribute('id');
    g.style.left = (b.r.left - fr.left) + 'px'; g.style.top = (b.r.top - fr.top) + 'px'; g.style.width = b.w + 'px';
    g.style.transform = 'scale(' + k.toFixed(4) + ')';
    this.fx.appendChild(g);
    var t = motion.kind === 'fly' && motion.to ? this.rectOf(motion.to) : null, anim;
    if (t) {
      var sc = Math.min(t.width / b.r.width, t.height / b.r.height);
      var dx = t.left + t.width / 2 - (b.r.left + b.r.width * sc / 2), dy = t.top + t.height / 2 - (b.r.top + b.r.height * sc / 2);
      anim = g.animate([
        { transform: 'scale(' + k.toFixed(4) + ')', opacity: 1 },
        { transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + (k * sc).toFixed(4) + ')', opacity: .85, offset: .8 },
        { transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + (k * sc).toFixed(4) + ')', opacity: 0 }
      ], { duration: FLY_MS, easing: EASE, fill: 'forwards' });
    } else {
      anim = g.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(' + (k * .96).toFixed(4) + ')' }], { duration: FADE_MS, easing: 'ease-in', fill: 'forwards' });
    }
    anim.onfinish = function () { g.remove(); };
    if (this.o.trace) this.o.trace(c, motion, !!t);
  };

  // One control leaves the stage now (a step's exit), the others close up.
  StageLayout.prototype.leave = function (name, motion) {
    if (!this.cur || !this.where[name]) return;
    var place = {}, cur = this.cur;
    Object.keys(cur.place).forEach(function (r) { place[r] = arr(cur.place[r]).filter(function (c) { return c !== name; }); });
    var ex = {}; ex[name] = motion || { kind: 'fade' };
    this.arrange(cur.layout, place, { animate: true, exit: ex });
  };

  // A target's rect on screen: a control, a region, or one item inside a
  // control ({control, item}), found by that control's positions.
  StageLayout.prototype.rectOf = function (t) {
    if (!t) return null;
    if (typeof t === 'object') {
      var r = t.item !== undefined && this.o.itemRect ? this.o.itemRect(t.control, t.item) : null;
      return r || this.rectOf(t.control);
    }
    var s = this.where[t] && this.o.slot(t);
    if (s) return rect(s.querySelector('.lx-mover') || s);
    if (this.regions[t] && !this.regions[t].hidden) return rect(this.regions[t]);
    return null;
  };

  StageLayout.prototype.focus = function (name) {
    var r = this.where[name]; if (!r) return;
    this.focused[r] = name;
    var w = this.wheels[r], f = this.fits[r];
    if (w && w.active) { var i = [].slice.call(f.children).indexOf(this.o.slot(name)); if (i >= 0) w.focus(i); }
  };

  // Sizes every scaled region by its settings; `now` lists controls whose
  // drawing width must be right at once (they are about to come in).
  StageLayout.prototype.fit = function (now) {
    var self = this; if (!this.cur) return;
    var v = this.cur.v, fh = this.frame.clientHeight;
    Object.keys(this.fits).forEach(function (n) {
      var spec = v.regions[n] || {}, el = self.regions[n], f = self.fits[n], w = self.wheels[n];
      if (!el || el.hidden || spec.fit !== 'contain') return;
      var items = [].slice.call(f.children).filter(function (s) { return getComputedStyle(s).display !== 'none'; });
      var cap = px(spec.maxHeight, fh), availW = el.clientWidth, availH = cap !== null ? cap : el.clientHeight;
      var zoom = arr(spec.zoom).length ? spec.zoom : [1, 1], zmin = zoom[0], zmax = zoom[1];
      var wl = Math.round(Math.min(availW, spec.width || availW));
      if (!availW || (!availH && cap === null)) return;
      if (f.style.width !== wl + 'px') f.style.width = wl + 'px';
      items.forEach(function (s) { self.checkWidth(s.getAttribute('data-ctl'), wl, now); });
      if (!items.length) { w.on(false); f.style.transform = ''; if (cap !== null) el.style.height = '0px'; return; }
      var row = spec.flow === 'row';
      var sizes = items.map(function (s) { return row ? s.offsetWidth : s.offsetHeight; });
      var h0 = row ? Math.max.apply(null, items.map(function (s) { return s.offsetHeight; })) : sizes.reduce(function (a, b) { return a + b; }, 0) + FIT_GAP * (items.length - 1);
      var s = Math.min(zmax, availW / wl, availH / Math.max(1, h0));
      if (s < zmin && items.length === 1 && self.o.box) {
        self.o.box(items[0].getAttribute('data-ctl'), { width: wl, height: Math.floor(availH / zmin) });
        h0 = items[0].offsetHeight;
        s = Math.min(zmax, availW / wl, availH / Math.max(1, h0));
      }
      if (s < zmin && items.length > 1 && spec.overflow === 'wheel') {
        var big = Math.max.apply(null, items.map(function (x) { return x.offsetHeight; }));
        s = Math.min(zmax, availW / wl, availH / Math.max(1, big));
        f.style.height = (availH / s).toFixed(1) + 'px';
        f.style.transform = 'translate(' + ((availW - wl * s) / 2).toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')';
        w.on(true);
        var fi = items.indexOf(self.o.slot(self.focused[n]));
        w.focus(fi >= 0 ? fi : w.focusIndex(), false);
      } else {
        w.on(false);
        f.style.height = '';
        var y = cap !== null ? 0 : (availH - h0 * s) / 2;
        f.style.transform = 'translate(' + ((availW - wl * s) / 2).toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
        if (cap !== null) el.style.height = Math.ceil(h0 * s) + 'px';
      }
      f.setAttribute('data-scale', s.toFixed(3));
    });
  };

  // A control drawn at another width than its region gives it is drawn
  // again at that width, at once when it is about to come in, a moment
  // later when the screen is still changing size. A fluid control
  // follows its width by itself.
  StageLayout.prototype.checkWidth = function (name, wl, now) {
    var s = this.o.slot(name); if (!s || this.o.fluid(name)) return;
    if (Math.abs(Number(s.getAttribute('data-w') || 0) - wl) <= 2) return;
    if (now && now.indexOf(name) >= 0) { this.o.relayout(name); return; }
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () {
      var r = self.where[name], f = r && self.fits[r];
      if (f && Math.abs(Number(s.getAttribute('data-w') || 0) - parseFloat(f.style.width)) > 2) self.o.relayout(name);
    }, RELAYOUT_MS);
  };
  StageLayout.prototype.scaleOf = function (region) { var f = this.fits[region]; return f ? Number(f.getAttribute('data-scale') || 1) : 1; };

  StageLayout.prototype.destroy = function () {
    var self = this;
    this.ro.disconnect(); clearTimeout(this.timer);
    Object.keys(this.wheels).forEach(function (n) { self.wheels[n].destroy(); });
  };

  StageLayout.MOVE_MS = MOVE_MS;
  return StageLayout;
})();
