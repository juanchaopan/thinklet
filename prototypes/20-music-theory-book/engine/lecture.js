/* ============================================================
   Lecture engine. Executes a workflow file for an item file, full
   screen: checks both (and the theme) before anything starts, expands the
   workflow's `sequence` into the lecture's scenes, puts on each
   placeholder (`controls`) the component the item or the workflow names
   with the inputs the placeholder takes from the parameters, lays the
   stage out by each scene's layout (StageLayout), and runs each scene's
   steps (do, together, await, exit, enter). The theme's constants are set
   on the stage, so every component draws in them.

   LectureEngine.componentsOf(workflow, item) names the components an
   item puts on stage; the page loads those (LessonComponents.load) and
   what they preload. prepare(progress) then lets each component prepare
   what the inputs it will be given name (a component with `prepare`),
   before start() puts the first scene on stage. Whatever those
   components need, such as a sound or an instrument, they use
   themselves; the engine makes no sound.

   The item's folder and file parameters are paths inside the item's
   folder; the engine hands them to components as full addresses, from
   the item's own address (`base`).

   Nothing in here knows a workflow, a scene, a parameter or a component.
   It reaches components only through the registry's contract (create,
   prepare, call, on, getState, setState, stop, fit) and its own
   vocabulary of interfaces: `narrate`, which it speaks through
   (narrate.say settles when the line is over, narrate.wait while the
   child has paused it, narrate.turn marks the child's turn, narrate.flag
   shows a note; speech is skipped when a scene is run in a hurry);
   `answer`, which an await uses (answer.clear, .check, .demo); the
   navigation interfaces it keeps up to date and listens to (leave,
   questions, parts, back, forward, restart); `positions`, which finds
   an item inside a control; and the event `go.origin`, which any control
   may send with the path of a value to go back to the scene that used it.

   Where the child may go: back always; on only past scenes that are done
   or that may be left before they are done (`forward: done` holds a scene
   until it has been done once), so a scene that asks the child to answer
   is never passed unanswered.
   ============================================================ */
var LectureEngine = (function () {
  var ABORT = { aborted: true };
  var U = LessonComponents.util, arr = U.arr, sleep = U.sleep;
  var P = LessonParams;
  var NAV = ['leave', 'questions', 'parts', 'back', 'forward', 'restart'];
  var REGION_KEYS = ['fit', 'width', 'zoom', 'align', 'valign', 'maxWidth', 'maxHeight', 'over', 'regions', 'flow', 'grow', 'overflow'];
  var FITS = ['none', 'fill', 'contain', 'width', 'height'];
  var FADE_OUT_MS = 300, FADE_IN_MS = 420, FADE_IN_DELAY = 180, EASE = 'cubic-bezier(.6, 0, .25, 1)';

  function still() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function isRef(v) { return typeof v === 'string' && v.charAt(0) === '$'; }
  // A placeholder's component: the item's choice, else the workflow's.
  function componentOf(wf, item, name) {
    var c = (wf.controls || {})[name] || {};
    return (item.components || {})[name] || c.component || null;
  }
  // A layout variant's region settings: the layout's, each region's
  // settings changed by what the variant writes for it.
  function settings(L, v) {
    var out = Object.assign({}, L.regions);
    Object.keys(v.regions || {}).forEach(function (k) { out[k] = Object.assign({}, (L.regions || {})[k], v.regions[k]); });
    return out;
  }
  // The regions of a layout variant a control can be placed in, and the
  // split ones, which hold regions rather than a control.
  function regionsOf(L, v) {
    var regions = settings(L, v), leaves = {}, split = {};
    StageLayout.order({ regions: regions, areas: v.areas }).forEach(function (n) {
      var parts = arr((regions[n] || {}).regions);
      if (!parts.length) { leaves[n] = true; return; }
      split[n] = true;
      parts.forEach(function (p) { leaves[p] = true; });
    });
    return { regions: regions, leaves: leaves, split: split };
  }

  function Engine(opts) {
    var self = this, onTrace = opts.onTrace || function () {};
    this.opts = opts;
    this.wf = opts.workflow; this.item = opts.item; this.stage = opts.stage;
    this.trace = function (kind, text) { if (!self.destroyed) onTrace(kind, text); };
    this.inst = {}; this.keys = {}; this.slots = {}; this.snap = {}; this.done = {}; this.origin = {}; this.left = {};
    this.token = null; this.finished = false; this.destroyed = false; this.cursor = null; this.bar = null;
    this.problems = this.check();
    if (this.problems.length) return;
    this.base = this.baseScope();
    this.plan = this.expand();
  }

  // Every component an item puts on stage, each once.
  Engine.componentsOf = function (wf, item) {
    var out = [];
    Object.keys(wf.controls || {}).forEach(function (n) { var id = componentOf(wf, item, n); if (id && out.indexOf(id) < 0) out.push(id); });
    return out;
  };

  /* ---------- reading the files ---------- */

  // The names a reference can start from: the item's parameters (with
  // their paths, folders and files as full addresses), and the context
  // the engine gives: $item (its name and number in the book), $book (the
  // book's items) and $paths (every value of a declared type, by path,
  // e.g. $paths.speech).
  Engine.prototype.baseScope = function () {
    var self = this, s = {}, wf = this.wf;
    var params = P.locate(wf.params, this.item.params || {}, this.opts.base || location.href);
    Object.keys(params).forEach(function (k) { s[k] = { value: params[k], path: k }; });
    var me = arr(this.opts.book).filter(function (b) { return b.name === self.opts.name; })[0] || {};
    s.item = { value: { name: this.opts.name, no: me.no }, path: null };
    s.book = { value: { items: arr(this.opts.book).map(function (b) { return { id: b.name, no: b.no, title: b.title }; }) }, path: null };
    var types = {};
    (function scan(decl) { Object.keys(decl || {}).forEach(function (k) { var d = decl[k]; types[P.typeOf(d)] = true; if (typeof d.of === 'string') types[d.of] = true; scan(d.each); }); })(wf.params);
    var paths = {};
    Object.keys(types).forEach(function (t) { paths[t] = P.paths(wf.params, params, t); });
    s.paths = { value: paths, path: null };
    return s;
  };
  Engine.prototype.ref = function (v, scope) { return P.ref(v, scope || this.base); };
  Engine.prototype.val = function (v, scope) { return isRef(v) ? this.ref(v, scope).value : v; };

  Engine.prototype.componentOf = function (name) { return componentOf(this.wf, this.item, name); };
  // A placeholder's inputs in a scope. With references none of which
  // resolve, the placeholder has nothing to show there and is not on stage.
  Engine.prototype.inputsOf = function (name, scope) {
    var self = this, spec = (this.wf.controls[name] || {}).inputs, refs = 0, missing = 0;
    function one(v) { if (!isRef(v)) return v; refs++; var r = self.ref(v, scope).value; if (r === undefined) missing++; return r; }
    var value;
    if (isRef(spec)) value = one(spec);
    else { value = {}; Object.keys(spec || {}).forEach(function (k) { var x = one(spec[k]); if (x !== undefined) value[k] = x; }); }
    return { value: value || {}, absent: refs > 0 && missing === refs };
  };

  // What `task content` will check, and the engine checks before it starts.
  Engine.prototype.check = function () {
    var self = this, wf = this.wf, item = this.item, out = [];
    out = out.concat(ThemeConstants.check(this.opts.theme));
    out = out.concat(P.check(wf.params, item.params));
    var controls = wf.controls || {};
    Object.keys(item.components || {}).forEach(function (n) { if (!controls[n]) out.push('题目选的占位 ' + n + ' 不是流程声明的'); });
    var talk = false;
    Object.keys(controls).forEach(function (n) {
      var c = controls[n], id = self.componentOf(n);
      if (!id) return;
      var d = LessonComponents.get(id);
      if (!d) { out.push('占位 ' + n + ' 的组件 ' + id + ' 没有加载'); return; }
      if (!d.create) { out.push('占位 ' + n + ' 的组件 ' + id + ' 不在舞台上画东西，不能放进占位'); return; }
      arr(c.needs).forEach(function (i) { if (d.interfaces.indexOf(i) < 0) out.push('组件 ' + id + ' 没有实现占位 ' + n + ' 要的接口 ' + i); });
      if (d.interfaces.indexOf('narrate') >= 0) talk = true;
    });
    if (!talk) out.push('流程里没有实现 narrate 的占位（字幕）');
    var layouts = wf.layouts || {};
    Object.keys(layouts).forEach(function (ln) {
      var L = layouts[ln];
      arr(L.variants).forEach(function (v, vi) {
        var where = '排法 ' + ln + ' 第 ' + (vi + 1) + ' 种', regions = settings(L, v), cols = -1;
        arr(v.areas).forEach(function (r) { var cells = String(r).trim().split(/\s+/); if (cols >= 0 && cells.length !== cols) out.push(where + '的区域图每行列数不同'); cols = cells.length; });
        Object.keys(regions).forEach(function (r) {
          Object.keys(regions[r]).forEach(function (k) { if (REGION_KEYS.indexOf(k) < 0) out.push(where + '的区域 ' + r + ' 有不认识的设置 ' + k); });
          if (regions[r].fit !== undefined && FITS.indexOf(regions[r].fit) < 0) out.push(where + '的区域 ' + r + ' 的 fit 应该是 ' + FITS.join('、') + ' 之一');
        });
        if (typeof v.when === 'string' && !(wf.screens || {})[v.when]) out.push('排法 ' + ln + ' 用的屏幕 ' + v.when + ' 没有定义');
      });
      var vs = arr(L.variants), last = vs[vs.length - 1];
      if (last && last.when !== undefined) out.push('排法 ' + ln + ' 的最后一种具体排法要不写条件，兜底');
    });
    Object.keys(wf.scenes || {}).forEach(function (sn) {
      var s = wf.scenes[sn], L = layouts[s.layout];
      if (!L) { out.push('幕 ' + sn + ' 的排法 ' + s.layout + ' 不存在'); return; }
      var place = Object.assign({}, L.place, s.place);
      Object.keys(place).forEach(function (r) {
        var list = arr(place[r]);
        if (list.length > 1) out.push('幕 ' + sn + ' 往区域 ' + r + ' 放了 ' + list.length + ' 个组件，一个区域只放一个');
        list.forEach(function (c) { if (!isRef(c) && !controls[c]) out.push('幕 ' + sn + ' 放的 ' + c + ' 不是流程声明的占位'); });
      });
      arr(L.variants).forEach(function (v, vi) {
        var R = regionsOf(L, v);
        Object.keys(place).forEach(function (r) {
          if (!arr(place[r]).length) return;
          if (R.split[r]) out.push('幕 ' + sn + ' 往区域 ' + r + ' 放东西，排法 ' + s.layout + ' 第 ' + (vi + 1) + ' 种把它分成了几个区域，要放进其中一个');
          else if (!R.leaves[r]) out.push('幕 ' + sn + ' 往区域 ' + r + ' 放东西，排法 ' + s.layout + ' 第 ' + (vi + 1) + ' 种没有这个区域');
        });
      });
      Object.keys(s.exit || {}).forEach(function (c) { var to = s.exit[c].to, t = to && typeof to === 'object' ? to.control : to; if (t && !controls[t]) out.push('幕 ' + sn + ' 的动作目标 ' + t + ' 不存在'); });
    });
    (function scan(list) { arr(list).forEach(function (e) { var n = typeof e === 'string' ? e : e.scene; if (n && !(wf.scenes || {})[n]) out.push('顺序里的幕 ' + n + ' 不存在'); if (e && e.sequence) scan(e.sequence); }); })(wf.sequence);
    return out;
  };

  // The lecture's scenes in order. A `for` entry repeats its scenes for
  // each element of a list, the element bound to its `as` name; entries
  // whose `when` does not hold are left out; a scene whose own `when`
  // does not hold is left out too. An entry with `segment` starts a new
  // segment; its `start` steps run as its first scene begins.
  Engine.prototype.expand = function () {
    var self = this, wf = this.wf, out = [], segments = [];
    function newSegment(label, scope) { segments.push({ label: String(self.val(label, scope) || segments.length + 1) }); return segments.length - 1; }
    function visit(list, scope, seg, start) {
      arr(list).forEach(function (e) {
        if (typeof e === 'string') e = { scene: e };
        if (e.when && !P.holds(e.when, scope)) return;
        if (e.for) {
          var r = self.ref(e.for, scope);
          arr(r.value).forEach(function (el, i) {
            var sc = Object.assign({}, scope);
            sc[e.as || 'each'] = { value: el, path: r.path === null ? null : r.path + '.' + i };
            var s2 = e.segment !== undefined ? newSegment(e.segment, sc) : seg;
            visit(e.sequence, sc, s2, arr(e.start).length ? arr(e.start) : start);
            start = null;
          });
          return;
        }
        var s = e.segment !== undefined ? newSegment(e.segment, scope) : seg;
        var def = wf.scenes[e.scene], sc = Object.assign({}, scope);
        Object.keys(def.params || {}).forEach(function (k) { sc[k] = { value: def.params[k].default, path: null }; });
        Object.keys(e.with || {}).forEach(function (k) { sc[k] = { value: e.with[k], path: null }; });
        if (def.when && !P.holds(def.when, sc)) return;
        out.push({ name: e.scene, def: def, scope: sc, segment: s, start: start || [] });
        start = null;
      });
    }
    visit(wf.sequence, this.base, -1, null);
    out.forEach(function (s, g) { s.g = g; });
    this.segments = segments;
    return out;
  };

  // Lets every component prepare what its inputs name, for each set of
  // inputs a scene of the lecture will give it; progress(fraction 0..1 or
  // null when unknown, text) adds them up.
  Engine.prototype.prepare = function (progress) {
    var self = this, tell = progress || function () {}, jobs = [], seen = {};
    if (this.problems.length) return Promise.resolve();
    this.plan.forEach(function (sc) {
      Object.keys(self.wf.controls).forEach(function (n) {
        var id = self.componentOf(n), d = id && LessonComponents.get(id);
        if (!d || !d.prepare) return;
        var inp = self.inputsOf(n, sc.scope), key = id + '|' + JSON.stringify(inp.value);
        if (inp.absent || seen[key]) return;
        seen[key] = true;
        jobs.push(function (part) { return d.prepare(inp.value, part); });
      });
    });
    if (!jobs.length) { tell(1); return Promise.resolve(); }
    var parts = jobs.map(function () { return 0; });
    return Promise.all(jobs.map(function (job, i) {
      return job(function (f, text) {
        if (f === null || f === undefined) { tell(null, text); return; }
        parts[i] = f / jobs.length;
        tell(parts.reduce(function (a, b) { return a + b; }, 0), text);
      });
    }));
  };

  /* ---------- the stage ---------- */

  Engine.prototype.build = function () {
    var self = this;
    this.stage.classList.add('lx-stage');
    ThemeConstants.apply(this.stage, this.opts.theme);
    this.stage.innerHTML = '<div class="lx-frame"></div>';
    this.frame = this.stage.querySelector('.lx-frame');
    this.layout = new StageLayout(this.frame, {
      layouts: this.wf.layouts, screens: this.wf.screens || {},
      slot: function (n) { return self.slots[n] || null; },
      present: function (n) { return !!self.inst[n] && !self.left[n]; },
      fluid: function (n) { var d = LessonComponents.get(self.componentOf(n)); return !!(d && d.fluid); },
      relayout: function (n) { self.redraw(n); },
      fit: function (n, view) { var a = self.inst[n]; if (a) a.fit(view); },
      itemRect: function (n, ref) { var a = self.inst[n]; if (!a || a.interfaces.indexOf('positions') < 0) return null; return a.call('positions.rect', ref); },
      trace: function (n, m, hit) { self.trace('call', n + ' 下台：' + (m.kind === 'fly' ? '飞向' + (typeof m.to === 'object' ? m.to.control + ' 里的一项' : m.to) + (hit ? '' : '（找不到目标，淡出）') : '淡出')); },
      problem: function (t) { self.trace('error', t); }
    });
    Object.keys(this.wf.controls).forEach(function (n) {
      var s = document.createElement('div');
      s.className = 'lx-slot'; s.setAttribute('data-ctl', n);
      s.innerHTML = '<div class="lx-mover"><div class="lx-host"></div></div>';
      self.layout.wings.appendChild(s);
      self.slots[n] = s;
    });
    // A placeholder the child is asked to answer on can be touched only
    // while an await waits on it.
    this.waitedOn = {};
    (function scan(steps) {
      arr(steps).forEach(function (st) {
        if (st.together) scan(st.together);
        if (st.await) { self.waitedOn[st.await.control] = true; scan(st.await.right); arr(st.await.wrong).forEach(function (w) { scan(w.steps); }); }
      });
    })([].concat.apply([], Object.keys(this.wf.scenes).map(function (k) { return self.wf.scenes[k].steps || []; })));
  };

  // Mounts each placeholder's component for a scene: drawn again when its
  // inputs differ from what it shows, removed when it has nothing to show.
  Engine.prototype.mountFor = function (sc) {
    var self = this;
    Object.keys(this.wf.controls).forEach(function (n) {
      var id = self.componentOf(n);
      var inp = id ? self.inputsOf(n, sc.scope) : { absent: true, value: {} };
      var key = inp.absent ? '' : id + '|' + JSON.stringify(inp.value);
      if (self.keys[n] === key) return;
      self.keys[n] = key;
      self.mount(n, inp.absent ? null : id, inp.value);
    });
  };
  Engine.prototype.mount = function (n, id, input) {
    var self = this, slot = this.slots[n], host = slot.querySelector('.lx-host');
    if (this.inst[n]) { this.inst[n].stop(); if (this.inst[n] === this.bar) this.bar = null; this.inst[n] = null; }
    host.innerHTML = '';
    this.layout.forget(n);
    if (!id) return;
    var def = LessonComponents.get(id);
    var a = def.create(host, Object.assign({}, input), { moveMs: StageLayout.MOVE_MS, swap: function (fn) { return self.crossfade(n, fn); } });
    a.binding = id; a.interfaces = def.interfaces; a.inputs = input;
    a.on(function (ev) { self.onEvent(n, ev); });
    this.inst[n] = a;
    slot.setAttribute('data-w', String(slot.clientWidth));
    slot.setAttribute('data-label', n + ' · ' + id);
    if (this.waitedOn[n]) slot.inert = true;
    if (def.interfaces.indexOf('narrate') >= 0) this.bar = a;
  };
  // Draws a component again at its slot's width and puts back what it showed.
  Engine.prototype.redraw = function (n) {
    var a = this.inst[n]; if (!a) return;
    var state = a.getState();
    this.mount(n, a.binding, a.inputs);
    this.inst[n].setState(state);
    this.layout.fit();
    this.trace('screen', n + ' 按新的宽度重画');
  };
  // New content for a component on stage: the old drawing lifts a little
  // and fades where it stood, the new one rises into place a moment later.
  Engine.prototype.crossfade = function (n, change) {
    var slot = this.slots[n], m = slot.querySelector('.lx-mover');
    if (still() || !this.layout.where[n] || !m.offsetWidth) return change();
    var fr = this.frame.getBoundingClientRect(), r = m.getBoundingClientRect(), k = r.width / m.offsetWidth;
    var g = m.cloneNode(true);
    g.classList.add('lx-ghost'); g.setAttribute('aria-hidden', 'true');
    g.style.left = (r.left - fr.left) + 'px'; g.style.top = (r.top - fr.top) + 'px'; g.style.width = m.offsetWidth + 'px';
    g.style.transform = 'scale(' + k.toFixed(4) + ')';
    this.layout.fx.appendChild(g);
    var out = change();
    g.animate([{ opacity: 1, transform: 'scale(' + k.toFixed(4) + ')' }, { opacity: 0, transform: 'translateY(-10px) scale(' + k.toFixed(4) + ')' }], { duration: FADE_OUT_MS, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).onfinish = function () { g.remove(); };
    m.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: FADE_IN_MS, delay: FADE_IN_DELAY, easing: EASE, fill: 'backwards' });
    return out;
  };

  // A scene's placement: the layout's, with the scene's regions over it;
  // a name may be a scene parameter ($on).
  Engine.prototype.placeOf = function (sc) {
    var self = this, L = this.wf.layouts[sc.def.layout], place = Object.assign({}, L.place, sc.def.place), out = {};
    Object.keys(place).forEach(function (r) { out[r] = arr(place[r]).map(function (c) { return self.val(c, sc.scope); }); });
    return out;
  };
  // Puts a scene on stage: its components, its placement, the state its
  // controls start in; what the scene before it lets go leaves as it says.
  Engine.prototype.compose = function (sc, animated, prev) {
    var self = this;
    this.mountFor(sc);
    this.left = {};
    var exit = {}, enter = {};
    if (prev) Object.keys(prev.def.exit || {}).forEach(function (c) { exit[c] = self.motion(prev.def.exit[c], prev.scope); });
    Object.keys(sc.def.enter || {}).forEach(function (c) { enter[c] = self.motion(sc.def.enter[c], sc.scope); });
    this.layout.arrange(sc.def.layout, this.placeOf(sc), { animate: animated, exit: exit, enter: enter });
    Object.keys(this.wf.controls).forEach(function (n) {
      var c = self.wf.controls[n], a = self.inst[n];
      if (!a || (!c.state && !(sc.def.state || {})[n])) return;
      a.call(a.interfaces[0] + '.set', Object.assign({}, c.state, (sc.def.state || {})[n]));
    });
  };
  // A motion with its target resolved: an item target names a value, and
  // its path is what the target component knows it by.
  Engine.prototype.motion = function (m, scope) {
    var out = Object.assign({}, m);
    ['to', 'from'].forEach(function (k) {
      var t = m[k];
      if (t && typeof t === 'object') { var r = P.ref(t.item, scope); out[k] = { control: t.control, item: r.path || r.value }; }
    });
    return out;
  };

  // Asks the browser for the full screen; the tap that starts the lecture
  // lets it. Where it cannot, the stage still fills the whole window.
  Engine.prototype.fullscreen = function () {
    var self = this, el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) { this.trace('screen', '已经是全屏'); return; }
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { this.trace('screen', '这个浏览器不能让网页全屏，画面占满整个窗口'); return; }
    var no = function (e) { self.trace('screen', '浏览器没有让它全屏（' + ((e && e.message) || e || '没有说原因') + '），画面占满整个窗口'); };
    try { var p = req.call(el, { navigationUI: 'hide' }); if (p && p.then) p.then(function () { self.trace('screen', '全屏了'); }, no); } catch (e) { no(e); }
  };

  /* ---------- the narrator ---------- */

  Engine.prototype.narrate = function (cmd, v) { return this.bar ? this.bar.call('narrate.' + cmd, v) : Promise.resolve(); };

  /* ---------- where the child may go ---------- */

  Engine.prototype.ctl = function (iface) {
    var self = this;
    return Object.keys(this.inst).map(function (n) { return self.inst[n]; }).filter(function (a) { return a && a.interfaces.indexOf(iface) >= 0; })[0] || null;
  };
  Engine.prototype.firstOfSegment = function (i) { for (var g = 0; g < this.plan.length; g++) if (this.plan[g].segment === i) return g; return -1; };
  Engine.prototype.leavable = function (g) { return this.plan[g].def.forward !== 'done'; };
  Engine.prototype.canLeave = function (g) {
    if (this.done[g]) return true;
    return this.leavable(g) && !(this.waiting && this.cursor && this.cursor.g === g);
  };
  Engine.prototype.canGo = function (a, b) {
    if (b === a) return true;
    if (b < a) return this.plan[a].def.back !== false;
    for (var k = a; k < b; k++) if (k === a ? !this.canLeave(k) : !(this.done[k] || this.leavable(k))) return false;
    return true;
  };
  Engine.prototype.updateNav = function () {
    var self = this, c = this.cursor; if (!c) return;
    var g = c.g, isLast = g >= this.plan.length - 1, ended = c.phase === 'end', f = this.ctl('forward'), b = this.ctl('back'), r = this.ctl('restart'), ps = this.ctl('parts');
    if (f) f.call('forward.set', { enabled: ended ? !isLast : this.canLeave(g), ready: ended && !isLast, shown: !(ended && isLast) });
    if (b) b.call('back.set', { enabled: g > 0 && this.canGo(g, g - 1) });
    if (r) r.call('restart.set', { shown: this.finished });
    if (ps) {
      var cur = this.plan[g].segment;
      ps.call('parts.set', { current: cur, items: this.segments.map(function (s, i) { var t = self.firstOfSegment(i); return { label: s.label, enabled: i === cur || (t >= 0 && self.canGo(g, t)) }; }) });
    }
  };
  Engine.prototype.forward = function () {
    var c = this.cursor; if (!c) return;
    if (c.phase === 'end') { if (this.resolveNext) { var r = this.resolveNext; this.resolveNext = null; r(); } return; }
    if (!this.canLeave(c.g)) return;
    this.trace('nav', '跳过这一幕：' + this.plan[c.g].def.title);
    this.go(c.g, 'skip');
  };
  Engine.prototype.back = function () {
    var c = this.cursor; if (!c || c.g === 0 || !this.canGo(c.g, c.g - 1)) return;
    this.trace('nav', '回到上一幕：' + this.plan[c.g - 1].def.title);
    this.go(c.g - 1, 'back');
  };
  Engine.prototype.jumpSegment = function (i) {
    var c = this.cursor, t = this.firstOfSegment(i); if (!c || t < 0 || !this.canGo(c.g, t)) return;
    this.trace('nav', '换到：' + this.segments[i].label);
    this.go(t, this.snap[t] ? 'back' : 'jump');
  };
  Engine.prototype.toOrigin = function (ref) {
    var g = this.origin[ref], c = this.cursor;
    if (g === undefined || !c || !this.canGo(c.g, g)) return;
    this.trace('nav', '点了一项，回到用它的那一幕：' + this.plan[g].def.title);
    this.go(g, 'back');
  };
  Engine.prototype.restart = function () {
    this.trace('nav', '从头再讲一遍');
    this.finished = false; this.done = {};
    this.go(0, this.snap[0] ? 'back' : 'jump');
  };

  /* ---------- events ---------- */

  Engine.prototype.onEvent = function (n, ev) {
    var name = ev.name;
    if (name === 'leave.press') { this.trace('nav', '关闭，回到书本'); if (this.opts.onLeave) this.opts.onLeave(); return; }
    if (name === 'back.press') { this.back(); return; }
    if (name === 'forward.press') { this.forward(); return; }
    if (name === 'restart.press') { this.restart(); return; }
    if (name === 'questions.pick') { this.trace('nav', '换一道题：' + ev.id); if (this.opts.onPick) this.opts.onPick(ev.id); return; }
    if (name === 'parts.pick') { this.jumpSegment(ev.index); return; }
    if (name === 'go.origin') { this.toOrigin(ev.ref); return; }
    if (name.indexOf('narrate.') === 0) { this.trace('bar', name.slice(8) + (ev.id ? ' ' + ev.id : '') + (ev.value ? ' ' + ev.value : '')); return; }
    this.trace('event', n + ' → ' + name + (ev.value !== undefined ? ' ' + JSON.stringify(ev.value) : '') + (ev.item !== undefined && ev.item !== null ? ' ' + ev.item : ''));
    var w = this.waiting;
    if (w && w.control === n && w.event === name && (w.item === null || w.item === undefined || String(w.item) === String(ev.item))) { this.waiting = null; w.resolve(ev); }
  };

  /* ---------- running a scene ---------- */

  Engine.prototype.guard = function (p, token) { if (token.aborted) return Promise.reject(ABORT); return Promise.race([Promise.resolve(p), token.abortP]); };
  Engine.prototype.newToken = function (hurry) {
    var t = { aborted: false, hurry: !!hurry };
    t.abortP = new Promise(function (res, rej) { t.abort = function () { t.aborted = true; rej(ABORT); }; });
    t.abortP.catch(function () {});
    return t;
  };

  // Steps run one after another; before each, the lecture waits while
  // the child has paused the narrator.
  Engine.prototype.runSteps = function (steps, sc, token) {
    var self = this, i = 0, list = arr(steps);
    function next() {
      if (i >= list.length) return Promise.resolve();
      var s = list[i++];
      if (s.when && !P.holds(s.when, sc.scope)) return next();
      var gate = token.hurry ? Promise.resolve() : self.narrate('wait');
      return self.guard(gate, token).then(function () { return self.runStep(s, sc, token); }).then(next);
    }
    return next();
  };
  Engine.prototype.runStep = function (s, sc, token) {
    var self = this;
    if (s.together) return Promise.all(arr(s.together).map(function (t) { return t.when && !P.holds(t.when, sc.scope) ? null : self.runStep(t, sc, token); }));
    if (s.await) return this.runAwait(s.await, sc, token);
    if (s.exit !== undefined) {
      var n = this.val(s.exit, sc.scope); if (!this.inst[n] || this.left[n]) return Promise.resolve();
      var m = token.hurry || still() ? { kind: 'cut' } : this.motion(s.motion || { kind: 'fade' }, sc.scope);
      this.left[n] = true;
      this.layout.leave(n, m);
      return this.guard(sleep(m.kind === 'cut' ? 0 : 400), token);
    }
    if (s.enter !== undefined) {
      var e = this.val(s.enter, sc.scope); if (!this.left[e]) return Promise.resolve();
      delete this.left[e];
      var en = {}; en[e] = this.motion(s.motion || { kind: 'rise' }, sc.scope);
      this.layout.arrange(sc.def.layout, this.placeOf(sc), { animate: !token.hurry, enter: en });
      return Promise.resolve();
    }
    if (s.do) return this.runDo(s.do, sc, token);
    return Promise.resolve();
  };

  // One interface command. A call to a placeholder with nothing on stage,
  // or whose argument is a reference that resolves to nothing, is not
  // made. The value's path goes along (ctx.ref), and the scene is
  // remembered as where that value was used. A narrate command is
  // skipped in a hurry; one about a value says which by its path, the
  // name the narrator knows its recording by. A region turning as a
  // wheel turns to the placeholder a step acts on.
  Engine.prototype.runDo = function (d, sc, token) {
    var n = this.val(d.control, sc.scope), a = this.inst[n];
    if (!a) return Promise.resolve();
    var r = 'with' in d ? (isRef(d.with) ? this.ref(d.with, sc.scope) : { value: d.with, path: null }) : { value: undefined, path: null };
    if (isRef(d.with) && r.value === undefined) return Promise.resolve();
    if (r.path) this.origin[r.path] = sc.g;
    var ctx = { hurry: token.hurry, ref: r.path };
    if (d.call.indexOf('narrate.') === 0) {
      if (token.hurry) return Promise.resolve();
      this.trace('say', (r.path || d.call) + '：' + (typeof r.value === 'string' ? r.value : r.value && r.value.text || ''));
      var said = a.call(d.call, r.path || r.value, ctx);
      return d.wait ? this.guard(said, token) : Promise.resolve();
    }
    var fromName = d.from ? this.val(d.from, sc.scope) : null, from = fromName ? this.layout.rectOf(fromName) : null;
    this.layout.focus(n);
    this.trace('call', n + '（' + a.binding + '）. ' + d.call + (r.value !== undefined ? ' ' + JSON.stringify(r.value).slice(0, 120) : '') + (from && !token.hurry ? '，从 ' + fromName + ' 飞过来' : ''));
    ctx.from = from && !token.hurry ? from : null;
    var p = a.call(d.call, r.value, ctx);
    return d.wait ? this.guard(p, token) : Promise.resolve();
  };

  // The child's turn on a control that implements `answer`. It can be
  // touched only now. A wrong answer is marked, then the workflow's
  // `wrong` entry for this attempt runs (the last one repeats) and either
  // waits again (retry) or shows the answer (show). Run in a hurry, the
  // answer is shown at once.
  Engine.prototype.runAwait = function (w, sc, token) {
    var self = this, n = this.val(w.control, sc.scope), a = this.inst[n], slot = this.slots[n];
    if (!a) return Promise.resolve();
    var item = w.item !== undefined ? this.val(w.item, sc.scope) : null;
    var accept = arr(this.val(w.accept, sc.scope)).map(String);
    var shown = w.show !== undefined && this.val(w.show, sc.scope) !== undefined ? this.val(w.show, sc.scope) : accept[0];
    var ctx = { hurry: token.hurry }, attempts = 0, wrong = arr(w.wrong);
    this.layout.focus(n);
    function show() {
      return self.guard(a.call('answer.demo', { item: item, value: shown }, ctx), token).then(function () { a.call('answer.check', { item: item, value: shown }, ctx, true); });
    }
    if (token.hurry) return show();
    a.call('answer.clear', { item: item });
    var live = function (on) { slot.inert = !on; self.updateNav(); };
    function once() {
      self.narrate('turn', true);
      self.trace('act', '等孩子：' + n + ' 的 ' + w.event + (item !== null ? '（' + item + '）' : '') + '，算对：' + accept.join(' / '));
      var waiting = new Promise(function (res) { self.waiting = { control: n, event: w.event, item: item, resolve: res }; });
      live(true);
      return self.guard(waiting, token).then(function (ev) {
        live(false);
        self.narrate('turn', false);
        var value = String(ev.value);
        if (accept.indexOf(value) >= 0) {
          a.call('answer.check', { item: item, value: ev.value }, ctx, true);
          self.trace('act', '答对了：' + value);
          return self.runSteps(w.right, sc, token);
        }
        attempts++;
        a.call('answer.check', { item: item, value: ev.value }, ctx, false);
        var entry = wrong[Math.min(attempts, wrong.length) - 1] || { then: 'show' };
        self.trace('act', '第 ' + attempts + ' 次答错：' + value + '，' + (entry.then === 'retry' ? '再答一次' : '演示'));
        if (entry.then === 'retry') return self.runSteps(entry.steps, sc, token).then(function () { a.call('answer.clear', { item: item, value: ev.value }); }).then(once);
        return self.guard(sleep(600), token).then(function () {
          a.call('answer.clear', { item: item, value: ev.value });
          return self.runSteps(entry.steps, sc, token);
        }).then(show);
      }, function (e) { live(false); throw e; });
    }
    return once();
  };

  /* ---------- snapshots ---------- */

  // What every control shows as a scene begins; the navigation controls
  // are set by where the child is, so they are left out.
  Engine.prototype.snapshot = function () {
    var self = this, s = {};
    Object.keys(this.inst).forEach(function (n) {
      var a = self.inst[n];
      if (a && !a.interfaces.some(function (i) { return NAV.indexOf(i) >= 0; })) s[n] = a.getState();
    });
    return s;
  };
  // Sets the stage straight to how a scene began; the picture brightens
  // from a dim, so the jump is not a cut.
  Engine.prototype.restore = function (snap, sc) {
    var self = this;
    this.compose(sc, false);
    Object.keys(snap).forEach(function (n) { if (self.inst[n]) self.inst[n].setState(snap[n]); });
    if (!still()) this.frame.animate([{ opacity: .55 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: EASE });
  };
  Engine.prototype.stopAll = function () {
    var self = this;
    this.waiting = null; this.resolveNext = null;
    Object.keys(this.inst).forEach(function (n) { if (self.inst[n]) self.inst[n].stop(); });
    this.narrate('turn', false);
  };

  /* ---------- the lecture's course ---------- */

  Engine.prototype.start = function () {
    if (this.problems.length) return;
    this.build();
    this.fullscreen();
    this.go(0, 'start');
  };

  // Moves to scene g and runs from there. 'start' and 'next' play it in
  // turn; 'back' (and a jump to a scene seen before) sets the stage
  // straight to how that scene began; 'jump' to a scene not seen yet sets
  // it up afresh; 'skip' sets the scene back to its start and runs it in a
  // hurry, without speech and with every mark drawn at once, then goes on.
  Engine.prototype.go = function (g, how) {
    var self = this, sc = this.plan[g], prev = this.cursor ? this.plan[this.cursor.g] : null;
    if (this.token) this.token.abort();
    this.stopAll();
    this.narrate('flag', null);
    var token = this.token = this.newToken(how === 'skip');
    this.cursor = { g: g, phase: 'run' };
    if (how === 'back' || (how === 'skip' && this.snap[g])) this.restore(this.snap[g], sc);
    else this.compose(sc, how === 'next', how === 'next' ? prev : null);
    if (!this.snap[g]) this.snap[g] = this.snapshot();
    this.updateNav();
    this.trace('scene', '幕：' + sc.def.title + (token.hurry ? '，跳过' : ''));
    var pause = how === 'start' && !still() ? StageLayout.MOVE_MS : 0;
    this.guard(sleep(token.hurry ? 0 : pause), token)
      .then(function () { return self.runSteps(sc.start, sc, token); })
      .then(function () { return self.runSteps(sc.def.steps, sc, token); })
      .then(function () {
        self.done[g] = true;
        self.cursor.phase = 'end';
        if (g >= self.plan.length - 1) { self.finish(); return; }
        if (token.hurry) { self.go(g + 1, 'next'); return; }
        self.updateNav();
        if (sc.def.end === 'go') { self.go(g + 1, 'next'); return; }
        self.trace('next', '这一幕讲完了，等孩子点「下一幕」');
        return self.guard(new Promise(function (res) { self.resolveNext = res; }), token).then(function () { self.go(g + 1, 'next'); });
      }).catch(function (e) {
        if (e === ABORT || self.destroyed) return;
        self.trace('error', String(e && e.stack || e));
      });
  };

  // The end of the lecture: the subtitle says so and the replay control
  // comes in. The stage stays as it is; the close control leads back.
  Engine.prototype.finish = function () {
    this.finished = true;
    this.narrate('flag', '讲完了');
    this.updateNav();
    this.trace('done', '这道讲题讲完了');
  };

  Engine.prototype.destroy = function () {
    var self = this;
    this.destroyed = true;
    if (this.token) this.token.abort();
    if (this.layout) this.layout.destroy();
    Object.keys(this.inst).forEach(function (n) { if (self.inst[n]) self.inst[n].stop(); });
  };

  return Engine;
})();
