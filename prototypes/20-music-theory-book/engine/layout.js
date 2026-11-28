/* ============================================================
   Stage layout and motion. Executes a workflow's `screens` and
   `layouts`: picks the variant of a layout whose screen condition holds,
   divides the stage into its regions (columns, rows and an area map, as
   a CSS grid), puts the one control a scene places in each region into
   it, sizes and aligns it by the region's settings, and paints the
   regions in the order they are written, each one over those before it.
   Between two arrangements every control that stays glides from where it
   was to where it is; one that comes in rises or grows out of a target;
   one that leaves fades or flies into a target.

   A region holds one control. A region of the area map may instead be
   split into regions in a row or a column (`regions: [names]`), each of
   which holds one; they share the split region's settings, so controls
   that must line up (a ruler and what is compared with it) are scaled
   as one. A region that holds nothing, or a control that hides itself,
   takes no room among its row or column.

   A region's settings:
     fit       none     the control at its own size (the default)
               fill     stretched over the region
               contain  scaled as a whole to fit both the width and the
                        height, between the zoom bounds
               width    scaled to fill the width; a control taller than
                        the region at that scale is asked to fit its view
               height   scaled to fill the height, drawn as wide as the
                        region allows at that scale; a control that needs
                        more width handles it in its view
     width     the width a scaled control is drawn at (at most the
               region's; for fit height, at most what fits)
     zoom      [smallest, largest] scale (fit contain, width, height)
     align     where it stands across: start, center (default), end
     valign    where it stands up and down: start, center (default), end
     maxWidth  the region is at most this wide, centred in its cell
     maxHeight the region is as tall as what it holds, at most this
     over      laid over another region's cell instead of a cell of its own
     regions, flow (row or column), grow (the one that takes the free
               length), overflow (wheel: when its regions do not fit at
               the smallest zoom they turn as a wheel)
   A scaled control is given its view ({width, height} in its own pixels:
   the most room it may take at the smallest zoom the region allows) and
   lays itself out to stay inside it; what it does when its content does
   not fit is its own. Several controls scaled together are not given a
   view; the wheel shows them one at a time.

   Nothing here knows a workflow, a control or a component: controls are
   named slots the lecture engine hands over.

   new StageLayout(frame, { layouts, screens, slot(name), present(name),
     fluid(name), relayout(name), fit(name, view), itemRect(name, ref),
     trace(name, motion, hit), problem(text) })
     arrange(layout, place, how)   place: region → control; how: { animate, enter, exit }
     leave(name, motion)           one control leaves the stage now
     focus(name)                   turns a wheel to that control
     rectOf(target)                a target's rect on screen
     topOf(region)                 the region of the area map it is in
     forget(name)                  a control drawn afresh is given its view again
     fit()                         sizes every region again
   StageLayout.order(variant) names a variant's regions of the area map
   in the order they are painted.
   ============================================================ */
var StageLayout = (function () {
  var MOVE_MS = 520, FADE_MS = 300, FLY_MS = 700, ENTER_DELAY = 140, STAGGER = 110, EASE = 'cubic-bezier(.6, 0, .25, 1)';
  var WINGS_W = 760, GAP = 10, FIT_GAP = 16, RELAYOUT_MS = 220;
  var SCALED = { contain: true, width: true, height: true };
  var FLEX = { start: 'flex-start', center: 'center', end: 'flex-end' };
  var CSS = [
    '.lx-stage{position:fixed;inset:0;overflow:hidden;overflow:clip;isolation:isolate;overscroll-behavior:none;font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;',
    'background:radial-gradient(80% 70% at 50% 40%,var(--th-backdrop-a),var(--th-backdrop-b) 70%,var(--th-backdrop-c))}',
    '.lx-frame{position:absolute;inset:max(10px,env(safe-area-inset-top,0px)) max(10px,env(safe-area-inset-right,0px)) max(10px,env(safe-area-inset-bottom,0px)) max(10px,env(safe-area-inset-left,0px));display:grid;gap:8px 12px;padding:10px 12px 12px;box-sizing:border-box;border-radius:26px;overflow:hidden;overflow:clip;isolation:isolate;',
    'background:radial-gradient(70% 60% at 18% 8%,color-mix(in srgb,var(--th-frame-glow-a) 55%,transparent),transparent 70%),radial-gradient(60% 55% at 88% 12%,color-mix(in srgb,var(--th-frame-glow-b) 45%,transparent),transparent 70%),radial-gradient(90% 70% at 50% 110%,color-mix(in srgb,var(--th-frame-glow-c) 70%,transparent),transparent 70%),var(--th-frame);',
    'box-shadow:0 30px 80px -20px color-mix(in srgb,var(--th-dark) 70%,transparent),0 0 0 1px color-mix(in srgb,var(--th-frame-glow-c) 12%,transparent)}',
    // The vignette and the flights lie over every region.
    '.lx-frame::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 140px 20px color-mix(in srgb,var(--th-frame-shade) 14%,transparent);border-radius:inherit;z-index:1000}',
    '@media (max-width:600px){.lx-frame{inset:max(6px,env(safe-area-inset-top,0px)) max(6px,env(safe-area-inset-right,0px)) max(6px,env(safe-area-inset-bottom,0px)) max(6px,env(safe-area-inset-left,0px));gap:6px 8px;padding:8px;border-radius:20px}}',
    // A region is only a frame for what it holds: it never takes a touch
    // itself, so a region laid over another lets touches through where it
    // holds nothing. Each is its own layer, painted in the written order.
    '.lx-region{position:relative;min-width:0;min-height:0;display:flex;gap:' + GAP + 'px;align-items:center;pointer-events:none}',
    '.lx-region[data-flow="column"]{flex-direction:column}',
    '.lx-region[data-fit="fill"]{display:grid;grid-template:minmax(0,1fr)/minmax(0,1fr);align-items:stretch;justify-items:stretch}',
    '.lx-region[data-fit="fill"] > .lx-slot,.lx-region[data-fit="fill"] .lx-mover,.lx-region[data-fit="fill"] .lx-host{height:100%;min-height:0}',
    '.lx-region[data-scaled]{display:block}',
    '.lx-region[hidden]{display:none}',
    // A region inside a split one: as long as its control, gone when
    // empty; scaled together, each keeps its whole height.
    '.lx-region.lx-part{flex:0 1 auto;flex-direction:column;justify-content:center;align-items:stretch;gap:0}',
    '.lx-region.lx-part.lx-grow{flex:1 1 auto}',
    '.lx-fit > .lx-region.lx-part{flex-shrink:0;min-height:auto}',
    '.lx-region.lx-part:empty,.lx-region.lx-part:has(> .lx-slot > .lx-mover > .lx-host > :only-child[hidden]){display:none}',
    '.lx-fit{position:absolute;left:0;top:0;display:flex;flex-direction:column;gap:' + FIT_GAP + 'px;transform-origin:0 0}',
    '.lx-fit[data-flow="row"]{flex-direction:row;align-items:center}',
    '.lx-fit[hidden]{display:none}',
    '.lx-fit.wheel-on{overflow:hidden;overflow:clip;pointer-events:auto}',
    '.lx-slot{position:relative;min-width:0;max-width:100%;flex:0 1 auto;display:flex;flex-direction:column;pointer-events:auto}',
    '.lx-region:not([data-scaled]) > .lx-slot{max-height:100%}',
    '.lx-part > .lx-slot{flex:1 1 auto}',
    '.lx-slot:has(> .lx-mover > .lx-host > :only-child[hidden]){display:none}',
    '.lx-mover{position:relative;min-width:0;display:flex;flex-direction:column}',
    '.lx-host{position:relative;min-width:0}',
    '.lx-wings{position:absolute;left:0;top:0;width:' + WINGS_W + 'px;visibility:hidden;pointer-events:none}',
    '.lx-wings .lx-slot{pointer-events:none}',
    '.lx-fx{position:absolute;inset:0;pointer-events:none;z-index:1001}',
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
  function shown(el) { return getComputedStyle(el).display !== 'none'; }
  // Where a length stands in the room it has: start, center or end.
  function offset(room, len, at) { return at === 'start' ? 0 : at === 'end' ? room - len : (room - len) / 2; }
  // A slot or a region as it stands in plain flow, without what a wheel
  // set on it; a wheel sets its own again.
  function bare(s) { s.style.transform = ''; s.style.opacity = ''; s.style.visibility = ''; s.style.zIndex = ''; }
  function ctlOf(item) { var s = item.classList.contains('lx-slot') ? item : item.querySelector('.lx-slot'); return s ? s.getAttribute('data-ctl') : null; }

  function StageLayout(frame, o) {
    var self = this;
    inject();
    this.frame = frame; this.o = o;
    this.regions = {}; this.fits = {}; this.wheels = {}; this.focused = {}; this.views = {};
    this.where = {}; this.tops = {}; this.cur = null; this.timer = 0;
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

  // The regions of the area map a variant shows (with those laid over
  // one of them), in paint order: as the settings write them, then any
  // the settings do not name, in the order of the area map.
  StageLayout.order = function (v) {
    var names = {}, inMap = [], parts = {};
    Object.keys(v.regions).forEach(function (n) { arr(v.regions[n].regions).forEach(function (p) { parts[p] = true; }); });
    arr(v.areas).forEach(function (r) { String(r).trim().split(/\s+/).forEach(function (n) { if (n !== '.' && !names[n]) { names[n] = true; inMap.push(n); } }); });
    Object.keys(v.regions).forEach(function (n) { if (v.regions[n].over && names[v.regions[n].over]) names[n] = true; });
    var out = Object.keys(v.regions).filter(function (n) { return names[n] && !parts[n]; });
    return out.concat(inMap.filter(function (n) { return out.indexOf(n) < 0; }));
  };

  StageLayout.prototype.el = function (name) {
    var el = this.regions[name];
    if (!el) { el = document.createElement('div'); el.className = 'lx-region'; el.setAttribute('data-region', name); this.regions[name] = el; }
    return el;
  };
  // What a region of the area map holds its controls or regions in: the
  // region itself, or the scaled box inside it.
  StageLayout.prototype.container = function (name, spec) {
    var el = this.regions[name], f = this.fits[name];
    if (!SCALED[spec.fit]) { if (f) f.hidden = true; return el; }
    if (!f) {
      f = document.createElement('div'); f.className = 'lx-fit'; el.appendChild(f); this.fits[name] = f;
      this.wheels[name] = new Wheel(f, { axis: 'y', items: function () { return [].slice.call(f.children).filter(shown); } });
      this.ro.observe(f);
    }
    f.hidden = false;
    f.setAttribute('data-flow', spec.flow === 'row' ? 'row' : 'column');
    this.wheels[name].o.axis = spec.flow === 'row' ? 'x' : 'y';
    return f;
  };
  // A region of the area map: its cell, its layer, how it stands in it.
  StageLayout.prototype.dress = function (el, n, spec, layer) {
    var fit = spec.fit || 'none', row = spec.flow ? spec.flow === 'row' : !arr(spec.regions).length;
    el.classList.remove('lx-part', 'lx-grow');
    el.hidden = false;
    el.style.gridArea = spec.over || n;
    el.style.zIndex = String(layer);
    el.setAttribute('data-fit', fit);
    el.setAttribute('data-flow', row ? 'row' : 'column');
    if (SCALED[fit]) el.setAttribute('data-scaled', ''); else el.removeAttribute('data-scaled');
    var across = FLEX[spec.align] || 'center', down = FLEX[spec.valign] || 'center', loose = fit === 'none';
    el.style.justifyContent = loose ? (row ? across : down) : '';
    el.style.alignItems = loose ? (row ? down : across) : '';
    el.style.maxWidth = spec.maxWidth ? spec.maxWidth + 'px' : '';
    el.style.width = spec.maxWidth ? '100%' : '';
    el.style.justifySelf = spec.maxWidth ? 'center' : '';
    el.style.height = '';
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

  // Lays the stage out by a layout and a placement (region → control)
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
    var tops = StageLayout.order(v), holder = {}, on = {};
    this.tops = {};
    tops.forEach(function (n, i) {
      var spec = v.regions[n] || {}, el = self.el(n), parts = arr(spec.regions);
      if (el.parentNode !== self.frame) self.frame.insertBefore(el, self.wings);
      self.dress(el, n, spec, i + 1);
      on[n] = true;
      var box = self.container(n, spec);
      if (!parts.length) { holder[n] = box; self.tops[n] = n; return; }
      parts.forEach(function (p, k) {
        var pe = self.el(p);
        pe.className = 'lx-region lx-part' + (spec.grow === p ? ' lx-grow' : '');
        pe.removeAttribute('data-scaled'); pe.removeAttribute('data-fit'); pe.removeAttribute('data-flow');
        pe.hidden = false; pe.style.cssText = ''; pe.style.zIndex = String(k + 1);
        box.appendChild(pe);
        on[p] = true; holder[p] = pe; self.tops[p] = n;
      });
    });
    Object.keys(this.regions).forEach(function (n) { if (!on[n]) self.regions[n].hidden = true; });
    var placed = {};
    Object.keys(holder).forEach(function (r) {
      var c = arr(place[r])[0];
      if (!c || placed[c] || !o.present(c)) return;
      var s = o.slot(c); if (!s) return;
      placed[c] = r;
      bare(s);
      holder[r].appendChild(s);
      self.ro.observe(s);
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
  StageLayout.prototype.topOf = function (region) { return this.tops[region] || null; };

  StageLayout.prototype.focus = function (name) {
    var r = this.where[name], top = r && this.tops[r]; if (!top) return;
    this.focused[top] = name;
    var w = this.wheels[top], f = this.fits[top];
    if (w && w.active) { var i = [].slice.call(f.children).filter(shown).indexOf(this.itemOf(name)); if (i >= 0) w.focus(i); }
  };

  // Gives a control its view when it differs from the last one it was given.
  StageLayout.prototype.give = function (name, view) {
    var key = view ? view.width + 'x' + view.height : '';
    if ((this.views[name] || '') === key) return;
    if (key) this.views[name] = key; else delete this.views[name];
    if (this.o.fit) this.o.fit(name, view);
  };
  StageLayout.prototype.forget = function (name) { delete this.views[name]; };

  // Sizes every scaled region by its settings; `now` lists controls whose
  // drawing width must be right at once (they are about to come in).
  StageLayout.prototype.fit = function (now) {
    var self = this; if (!this.cur) return;
    var v = this.cur.v, fh = this.frame.clientHeight, viewed = {};
    Object.keys(this.fits).forEach(function (n) {
      var spec = v.regions[n] || {}, el = self.regions[n], f = self.fits[n], w = self.wheels[n], mode = spec.fit;
      if (!el || el.hidden || f.hidden || !SCALED[mode] || el.parentNode !== self.frame) return;
      var cap = px(spec.maxHeight, fh), availW = el.clientWidth, availH = cap !== null ? cap : el.clientHeight;
      if (!availW || (!availH && cap === null)) return;
      var zoom = arr(spec.zoom).length ? spec.zoom : [1, 1], zmin = zoom[0], zmax = zoom[1];
      var clamp = function (s) { return Math.max(zmin, Math.min(zmax, s)); };
      var row = spec.flow === 'row';
      var items = [].slice.call(f.children).filter(shown);
      var extent = function () {
        var ws = items.map(function (s) { return s.offsetWidth; }), hs = items.map(function (s) { return s.offsetHeight; });
        var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) + FIT_GAP * (a.length - 1); };
        return row ? { w: sum(ws), h: Math.max.apply(null, hs) } : { w: Math.max.apply(null, ws), h: sum(hs) };
      };
      var W = Math.round(Math.min(availW, spec.width || availW));
      if (mode === 'height' && items.length) W = Math.round(Math.min(spec.width || Infinity, availW / clamp(availH / Math.max(1, extent().h))));
      if (f.style.width !== W + 'px') f.style.width = W + 'px';
      items.forEach(function (s) { self.checkWidth(ctlOf(s), W, now); });
      if (!items.length) { w.on(false); f.style.transform = ''; if (cap !== null) el.style.height = '0px'; return; }
      if (items.length === 1) {
        var view = { width: W, height: Math.floor(availH / (mode === 'width' ? clamp(availW / W) : zmin)) };
        var c = ctlOf(items[0]);
        self.give(c, view); viewed[c] = true;
      }
      var e = extent();
      var s = mode === 'width' ? Math.min(clamp(availW / e.w), availW / e.w) : mode === 'height' ? Math.min(clamp(availH / e.h), availW / e.w) : Math.min(zmax, availW / e.w, availH / e.h);
      if (s < zmin && items.length > 1 && spec.overflow === 'wheel') {
        var big = Math.max.apply(null, items.map(function (x) { return row ? x.offsetWidth : x.offsetHeight; }));
        s = Math.min(zmax, row ? availH / e.h : availW / e.w, (row ? availW : availH) / Math.max(1, big));
        f.style.height = (availH / s).toFixed(1) + 'px';
        f.style.transform = 'translate(' + offset(availW, e.w * s, spec.align).toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')';
        w.on(true);
        var fi = items.indexOf(self.itemOf(self.focused[n]));
        w.focus(fi >= 0 ? fi : w.focusIndex(), false);
      } else {
        w.on(false);
        [].slice.call(f.children).forEach(bare);
        f.style.height = '';
        var y = cap !== null ? 0 : offset(availH, e.h * s, spec.valign);
        f.style.transform = 'translate(' + offset(availW, e.w * s, spec.align).toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
        if (cap !== null) el.style.height = Math.ceil(e.h * s) + 'px';
      }
      f.setAttribute('data-scale', s.toFixed(3));
    });
    Object.keys(this.views).forEach(function (c) { if (!viewed[c]) self.give(c, null); });
  };
  // What a wheel turns for a control: its region inside a split one, or its slot.
  StageLayout.prototype.itemOf = function (name) {
    var r = this.where[name];
    if (!r) return null;
    return this.tops[r] === r ? this.o.slot(name) : this.regions[r];
  };

  // A control drawn at another width than its region gives it is drawn
  // again at that width, at once when it is about to come in, a moment
  // later when the screen is still changing size. A fluid control
  // follows its width by itself.
  StageLayout.prototype.checkWidth = function (name, wl, now) {
    var s = name && this.o.slot(name); if (!s || this.o.fluid(name)) return;
    if (Math.abs(Number(s.getAttribute('data-w') || 0) - wl) <= 2) return;
    if (now && now.indexOf(name) >= 0) { this.o.relayout(name); return; }
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () {
      var r = self.where[name], f = r && self.fits[self.tops[r]];
      if (f && Math.abs(Number(s.getAttribute('data-w') || 0) - parseFloat(f.style.width)) > 2) self.o.relayout(name);
    }, RELAYOUT_MS);
  };
  StageLayout.prototype.scaleOf = function (region) { var f = this.fits[this.tops[region] || region]; return f ? Number(f.getAttribute('data-scale') || 1) : 1; };

  StageLayout.prototype.destroy = function () {
    var self = this;
    this.ro.disconnect(); clearTimeout(this.timer);
    Object.keys(this.wheels).forEach(function (n) { self.wheels[n].destroy(); });
  };

  StageLayout.MOVE_MS = MOVE_MS;
  return StageLayout;
})();
