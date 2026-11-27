/* ============================================================
   Lecture player. Reads a workflow file and a question file, puts the
   component the question binds to each of the workflow's roles on the
   stage, and runs the lecture exactly as the workflow file says: the
   question's parts (小题), each part's scenes, each scene's steps (say,
   do, show, act, conclude), what happens at the end of a scene and of a
   part, review from the conclusion stack, and wrong attempts. Nothing in
   here knows a particular workflow, part kind, scene or component.

   Steps reach components only through capability interfaces: a step
   says "role R, interface call C, value V"; the player looks up the
   component bound to R and passes the call on. Whatever a step acts on
   is brought into view in the stage, so the child's eyes can follow.

   ADAPTERS is a temporary layer for the prototype: today's components
   still have their own command and event names (select, fill, optionTap,
   keyPress...). Each adapter turns interface calls into those commands
   and the component's events into interface events, and says which
   interfaces the component implements. When the interfaces are final
   and the components implement them directly, the adapters go away.
   ============================================================ */
var LecturePlayer = (function () {
  var ABORT = { aborted: true };
  var VIEW_PAD = 16, DOCK_ROOM = 84;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function arr(x) { return x === undefined || x === null ? [] : [].concat(x); }
  function notesOf(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.reduce(function (a, g) { return a.concat(notesOf(g)); }, []);
    return arr(v.notes);
  }

  /* ---------- adapters (temporary, see above) ---------- */

  function Base(env) { this.env = env; this.listeners = []; }
  Base.prototype.on = function (fn) { this.listeners.push(fn); };
  Base.prototype.emit = function (ev) { this.listeners.forEach(function (f) { f(ev); }); };
  Base.prototype.stop = function () { if (this.c && this.c.stop) this.c.stop(); };

  // Score: point, play, positions.
  function ScoreA(host, input, env) {
    Base.call(this, env);
    var self = this;
    this.c = new Score(host, Object.assign({ mode: 'lecture', sound: env.sound, onEvent: function (ev) { self.emit({ name: 'point.tap', raw: ev }); } }, input));
    this.st = { spot: null, hl: null, labels: [] };
  }
  ScoreA.prototype = Object.create(Base.prototype);
  ScoreA.interfaces = ['point', 'play', 'positions'];
  ScoreA.prototype.indices = function (v, ctx) {
    var bar = (v && v.bar) || (ctx.at && ctx.at.bar) || 1;
    var inBar = this.c.notesOfBar(bar);
    return notesOf(v).map(function (i) { return inBar[i] && inBar[i].index; }).filter(function (i) { return i !== undefined; });
  };
  ScoreA.prototype.call = function (name, v, ctx) {
    var self = this;
    if (name === 'point.spotlight') { this.c.spotlight(v && v.bar ? v.bar : null); this.st.spot = v && v.bar || null; this.st.hl = null; return; }
    if (name === 'point.highlight') { var idx = this.indices(v, ctx); this.c.highlight(idx); this.st.hl = idx; return; }
    if (name === 'point.label') {
      arr(v).forEach(function (g) { var i = self.indices(g, ctx)[0]; if (i !== undefined) { self.c.label(i, g.label); self.st.labels.push([i, g.label]); } });
      return;
    }
    if (name === 'point.clear') { this.setState({}); return; }
    throw new Error('score: ' + name);
  };
  ScoreA.prototype.getState = function () { return JSON.parse(JSON.stringify(this.st)); };
  ScoreA.prototype.setState = function (s) {
    var self = this; s = s || {};
    this.c.clear();
    if (s.spot) this.c.spotlight(s.spot);
    if (s.hl) this.c.highlight(s.hl);
    (s.labels || []).forEach(function (l) { self.c.label(l[0], l[1]); });
    this.st = { spot: s.spot || null, hl: s.hl || null, labels: (s.labels || []).slice() };
  };

  // Beat grid: point, count, meter, set, play.
  function GridA(host, input, env) {
    Base.call(this, env);
    this.host = host; this.input = input;
    this.make(input.abc);
  }
  GridA.prototype = Object.create(Base.prototype);
  GridA.interfaces = ['point', 'count', 'meter', 'set', 'play'];
  GridA.prototype.make = function (abc) {
    var self = this;
    if (this.c) this.c.stop();
    this.host.innerHTML = '';
    this.abc = abc;
    this.c = new BeatGrid(this.host, Object.assign({}, this.input, { abc: abc, mode: 'lecture', sound: this.env.sound, onEvent: function (ev) {
      if (ev.type === 'countStep' && self.counting && ev.n === ev.total) { var done = self.counting; self.counting = null; setTimeout(done, 650); }
      if (ev.type === 'tileTap' || ev.type === 'beatTap') self.emit({ name: 'point.tap', raw: ev });
    } }));
    this.st = { abc: abc, meter: null, sub: [], counts: [], labels: [], hl: null };
  };
  GridA.prototype.sig = function (m) { return typeof m === 'object' && m ? [m.sig, m.group] : [m, undefined]; };
  GridA.prototype.call = function (name, v) {
    var self = this;
    if (name === 'meter.show') { var s = this.sig(v); this.c.meter(s[0], s[1]); this.st.meter = v; this.st.sub = []; this.st.counts = []; return sleep(700); }
    if (name === 'meter.subdivide') { this.c.subdivide(v); this.st.sub.push(v); return sleep(400); }
    if (name === 'count.run') {
      this.st.counts.push(v);
      return new Promise(function (res) { self.counting = res; self.c.count(v); setTimeout(function () { if (self.counting === res) { self.counting = null; res(); } }, 15000); });
    }
    if (name === 'point.highlight') { var idx = notesOf(v); this.c.highlight(idx); this.st.hl = idx; return; }
    if (name === 'point.label') { arr(v).forEach(function (g) { var i = notesOf(g)[0]; if (i !== undefined) { self.c.label(i, g.label); self.st.labels.push([i, g.label]); } }); return sleep(500); }
    if (name === 'point.spotlight') { var n = notesOf(v); this.c.spotlight(n.length ? { tiles: [Math.min.apply(null, n), Math.max.apply(null, n)] } : null); return; }
    if (name === 'point.clear') { this.c.clear(); return; }
    if (name === 'set') { this.make(v); return sleep(300); }
    throw new Error('beat-grid: ' + name);
  };
  GridA.prototype.stop = function () { this.c.stop(); if (this.counting) { var r = this.counting; this.counting = null; r(); } };
  GridA.prototype.getState = function () { return JSON.parse(JSON.stringify(this.st)); };
  GridA.prototype.setState = function (s) {
    var self = this; s = s || {};
    this.stop();
    if (s.abc && s.abc !== this.abc) this.make(s.abc); else { this.c.clear(); this.c.meter(this.input.meter || '?'); }
    if (s.meter) { var m = this.sig(s.meter); this.c.meter(m[0], m[1]); }
    (s.sub || []).forEach(function (u) { self.c.subdivide(u); });
    (s.counts || []).forEach(function (u) { self.c.count(u, undefined, undefined, true); });
    (s.labels || []).forEach(function (l) { self.c.label(l[0], l[1], true); });
    if (s.hl) this.c.highlight(s.hl);
    this.st = JSON.parse(JSON.stringify(Object.assign({ abc: this.abc, meter: null, sub: [], counts: [], labels: [], hl: null }, s)));
  };

  // Choice: answer, point, strike, set, play, positions.
  function ChoiceA(host, input, env) {
    Base.call(this, env);
    var self = this;
    this.c = new Choice(host, Object.assign({}, input, { mode: 'lecture', sound: env.sound, onEvent: function (ev) {
      if (ev.type === 'optionTap') { self.st.selected = ev.selected.slice(); if (ev.on && !ev.struck) self.emit({ name: 'answer.given', item: null, value: ev.id }); }
      if (ev.type === 'boxTap') { self.st.values = ev.values.slice(); if (ev.value) self.emit({ name: 'answer.given', item: ev.index, value: ev.value }); }
    } }));
    this.st = { selected: [], values: [], struck: [], checks: {}, spotlight: [] };
  }
  ChoiceA.prototype = Object.create(Base.prototype);
  ChoiceA.interfaces = ['answer', 'point', 'strike', 'set', 'play', 'positions'];
  ChoiceA.prototype.key = function (a) { return a.item === null || a.item === undefined ? a.value : a.item; };
  ChoiceA.prototype.call = function (name, v, ctx, ok) {
    if (name === 'point.spotlight') { this.st.spotlight = arr(v); this.c.spotlight(this.st.spotlight); return; }
    if (name === 'point.highlight') { this.c.highlight(arr(v)); return; }
    if (name === 'point.clear') { this.st.spotlight = []; this.c.spotlight([]); this.c.highlight([]); return; }
    if (name === 'strike') { this.st.struck = this.st.struck.concat(arr(v)); this.c.strike(arr(v)); return sleep(600); }
    if (name === 'answer.focus') return;
    if (name === 'answer.check') { var m = {}; m[this.key(v)] = ok; this.st.checks[this.key(v)] = ok; this.c.check(m); return; }
    if (name === 'answer.clear') {
      if (v && v.value !== undefined) delete this.st.checks[this.key(v)];
      this.st.selected = []; this.st.values = [];
      this.apply(); return;
    }
    if (name === 'answer.demo') {
      if (v.item === null || v.item === undefined) { this.st.selected = [v.value]; this.c.select([v.value]); }
      else { this.st.values[v.item] = v.value; this.c.select(this.st.values); }
      return sleep(500);
    }
    if (name === 'answer.lock') { this.c.lock(v !== false); return; }
    throw new Error('choice: ' + name);
  };
  ChoiceA.prototype.apply = function () { this.c.set({ selected: this.st.selected, values: this.st.values, struck: this.st.struck, checks: this.st.checks, spotlight: this.st.spotlight }); };
  ChoiceA.prototype.getState = function () { return JSON.parse(JSON.stringify(this.st)); };
  ChoiceA.prototype.setState = function (s) {
    this.st = JSON.parse(JSON.stringify(Object.assign({ selected: [], values: [], struck: [], checks: {}, spotlight: [] }, s || {})));
    this.apply();
  };

  // Fill-in: answer, point, set, positions.
  function FillA(host, input, env) {
    Base.call(this, env);
    var self = this;
    this.c = new Fill(host, Object.assign({}, input, { onEvent: function (ev) {
      if (ev.type !== 'keyPress') return;
      self.st.values = Object.assign({}, ev.values);
      var f = self.c.field(ev.id);
      if (ev.accepted && ev.key !== 'back' && ev.key !== 'next' && f && ev.value.length >= f.size) self.emit({ name: 'answer.given', item: ev.id, value: ev.value });
    } }));
    this.st = { values: {}, checks: {}, spotlight: [], focus: null };
  }
  FillA.prototype = Object.create(Base.prototype);
  FillA.interfaces = ['answer', 'point', 'set', 'positions'];
  FillA.prototype.call = function (name, v, ctx, ok) {
    if (name === 'point.spotlight') { this.st.spotlight = arr(v); this.c.spotlight(this.st.spotlight); return; }
    if (name === 'point.highlight') { this.c.highlight(arr(v)); return; }
    if (name === 'point.clear') { this.st.spotlight = []; this.c.spotlight([]); this.c.highlight([]); return; }
    if (name === 'answer.focus') { var id = v && typeof v === 'object' ? v.item : v; this.st.focus = id; this.c.focus(id); return; }
    if (name === 'answer.check') { var m = {}; m[v.item] = ok; this.st.checks[v.item] = ok; this.c.check(m); return; }
    if (name === 'answer.clear') {
      if (v && v.item !== undefined && v.item !== null) { this.st.values[v.item] = ''; delete this.st.checks[v.item]; this.st.focus = v.item; }
      this.apply(); return;
    }
    if (name === 'answer.demo') {
      this.st.values[v.item] = v.value;
      this.c.type(v.item, v.value);
      return sleep(Fill.TYPE_GAP_MS * (String(v.value).length + 1) + 400);
    }
    if (name === 'answer.lock') { this.c.lock(v !== false); return; }
    throw new Error('fill: ' + name);
  };
  FillA.prototype.apply = function () { this.c.set({ values: this.st.values, checks: this.st.checks, spotlight: this.st.spotlight, focus: this.st.focus }); };
  FillA.prototype.getState = function () { return JSON.parse(JSON.stringify(this.st)); };
  FillA.prototype.setState = function (s) {
    this.st = JSON.parse(JSON.stringify(Object.assign({ values: {}, checks: {}, spotlight: [], focus: null }, s || {})));
    this.apply();
  };

  // Conclusion stack: conclude, point, mask, set.
  function StackA(host, input, env) {
    Base.call(this, env);
    var self = this;
    this.c = new ConclusionStack(host, Object.assign({}, input, { mode: 'lecture', sound: env.sound, onEvent: function (ev) {
      if (ev.type === 'itemTap') self.emit({ name: 'conclude.tap', id: ev.id });
    } }));
  }
  StackA.prototype = Object.create(Base.prototype);
  StackA.interfaces = ['conclude', 'point', 'mask', 'set'];
  StackA.prototype.call = function (name, v) {
    if (name === 'conclude.push') { this.c.push(v); return sleep(ConclusionStack.SETTLE_MS + 300); }
    if (name === 'conclude.set') { this.c.set(arr(v)); return; }
    if (name === 'point.highlight') { this.c.highlight(arr(v)); return; }
    throw new Error('conclusion-stack: ' + name);
  };
  StackA.prototype.getState = function () { return { order: this.c.order.slice() }; };
  StackA.prototype.setState = function (s) { this.c.set((s && s.order) || []); };

  var ADAPTERS = { score: ScoreA, 'beat-grid': GridA, choice: ChoiceA, fill: FillA, 'conclusion-stack': StackA };

  /* ---------- 下一步: the player's part that ends a scene ---------- */

  var NEXT_CSS = [
    '.pl-next{position:absolute;right:14px;bottom:calc(100% + 12px);z-index:4;display:inline-flex;align-items:center;gap:8px;min-height:52px;padding:0 22px 0 26px;border:0;border-radius:999px;',
    'font:800 17px/1 "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent;',
    'background:radial-gradient(circle at 30% 25%,#9a7bff,#6d3cf0);box-shadow:0 14px 28px -12px #6d3cf0,0 0 0 4px rgba(255,255,255,.55);',
    'transform:translateY(10px) scale(.96);opacity:0;visibility:hidden;transition:transform .52s cubic-bezier(.6,0,.25,1),opacity .4s,visibility 0s .52s}',
    '.pl-next.pl-next-on{transform:none;opacity:1;visibility:visible;transition:transform .52s cubic-bezier(.6,0,.25,1),opacity .4s,visibility 0s}',
    '.pl-next.pl-next-on::after{content:"";position:absolute;inset:-4px;border-radius:inherit;box-shadow:0 0 0 0 rgba(169,139,255,.6);animation:pl-next-ring 2.2s ease-out 1s infinite}',
    '@keyframes pl-next-ring{0%{box-shadow:0 0 0 0 rgba(169,139,255,.55)}70%,100%{box-shadow:0 0 0 14px rgba(169,139,255,0)}}',
    '.pl-next svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}',
    '.pl-next:active{transform:scale(.96)}',
    '.pl-next:focus{outline:none}.pl-next:focus-visible{outline:3px solid #a98bff;outline-offset:3px}',
    '@media (prefers-reduced-motion:reduce){.pl-next,.pl-next.pl-next-on{transition-duration:.01ms}.pl-next.pl-next-on::after{animation:none}}'
  ].join('');

  function NextStep(host) {
    if (!document.getElementById('pl-next-style')) { var s = document.createElement('style'); s.id = 'pl-next-style'; s.textContent = NEXT_CSS; document.head.appendChild(s); }
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pl-next';
    b.innerHTML = '<span>下一步</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
    host.appendChild(b);
    this.b = b; this.resolve = null;
    var self = this;
    b.addEventListener('click', function () { if (self.resolve) { var r = self.resolve; self.hide(); r(); } });
  }
  NextStep.prototype.wait = function () {
    var self = this;
    this.b.classList.add('pl-next-on');
    return new Promise(function (res) { self.resolve = res; });
  };
  NextStep.prototype.hide = function () { this.resolve = null; this.b.classList.remove('pl-next-on'); };

  /* ---------- the player ---------- */

  function Player(opts) {
    var self = this, onTrace = opts.onTrace || function () {};
    this.wf = opts.workflow; this.q = opts.question;
    this.stage = opts.stage; this.sound = opts.sound;
    this.trace = function (kind, text) { if (!self.destroyed) onTrace(kind, text); };
    this.lines = opts.lines;
    this.inst = {}; this.keys = {};
    this.snap = {}; this.snapEnd = {}; this.concludedAt = {};
    this.token = null; this.reviewing = null; this.done = false; this.destroyed = false;
    this.problems = this.check();
    if (this.problems.length) return;
    this.layout(opts);
  }

  // What `task content` will check: every role the workflow needs has a
  // component that implements its interfaces, every part is a kind the
  // workflow offers and fills what that kind requires, and nothing else.
  Player.prototype.check = function () {
    var wf = this.wf, q = this.q, out = [];
    var parts = q.parts || [];
    Object.keys(wf.roles).forEach(function (role) {
      var r = wf.roles[role];
      var binds = [q.bind && q.bind[role]].concat(parts.map(function (p) { return p.bind && p.bind[role]; })).filter(Boolean);
      if (!binds.length && !r.optional) out.push('角色「' + r.title + '」没有指定组件');
      binds.forEach(function (b) {
        var A = ADAPTERS[b];
        if (!A) { out.push('角色「' + r.title + '」指定的组件 ' + b + ' 不存在'); return; }
        arr(r.needs).forEach(function (i) { if (A.interfaces.indexOf(i) < 0) out.push('组件 ' + b + ' 没有实现角色「' + r.title + '」要的接口 ' + i); });
      });
    });
    parts.forEach(function (p, i) {
      var k = wf.parts[p.kind];
      if (!k) { out.push('第 ' + (i + 1) + ' 个小题的种类 ' + p.kind + ' 不是这个流程提供的'); return; }
      arr(k.required).forEach(function (name) { if (p[name] === undefined && !(k.fixed && name in k.fixed)) out.push('小题 ' + (p.tag || i + 1) + ' 没有填必填的属性 ' + name); });
      Object.keys(p).forEach(function (name) {
        if (['kind', 'tag', 'bind', 'inputs'].indexOf(name) >= 0) return;
        if (arr(k.required).indexOf(name) < 0 && arr(k.optional).indexOf(name) < 0) out.push('小题 ' + (p.tag || i + 1) + ' 填了「' + k.title + '」没有声明的属性 ' + name);
      });
    });
    return out;
  };

  Player.prototype.layout = function (opts) {
    var self = this, wf = this.wf;
    this.stage.innerHTML =
      '<div class="lx-scroll"><div class="lx-region" data-place="top"></div><div class="lx-region" data-place="main"></div><div class="lx-region" data-place="bottom"></div></div>' +
      '<div class="lx-dock"><div class="lx-bar"></div></div>';
    this.scroll = this.stage.querySelector('.lx-scroll');
    this.slots = {};
    Object.keys(wf.roles).forEach(function (role) {
      var r = wf.roles[role];
      var region = self.stage.querySelector('.lx-region[data-place="' + (r.place === 'popup' ? 'bottom' : r.place) + '"]');
      var slot = document.createElement('div');
      slot.className = 'lx-role'; slot.setAttribute('data-role', role); slot.hidden = true;
      slot.innerHTML = '<div class="lx-host"></div>';
      region.appendChild(slot);
      self.slots[role] = slot;
    });
    var dock = this.stage.querySelector('.lx-dock');
    this.next = new NextStep(dock);
    this.bar = new NarrationBar(this.stage.querySelector('.lx-bar'), {
      portrait: opts.portrait, controls: wf.player.narration || [], lines: this.lines,
      onEvent: function (ev) { self.trace('bar', ev.type + (ev.id ? ' ' + ev.id : '') + (ev.value ? ' ' + ev.value : '')); }
    });
    this.stackRole = Object.keys(wf.roles).filter(function (r) { return arr(wf.roles[r].needs).indexOf('conclude') >= 0; })[0];
  };

  // Scrolls the stage, and only the stage, the least it takes for a role
  // to be in view above the dock; a role taller than the view shows its top.
  Player.prototype.reveal = function (role) {
    var slot = this.slots[role], sc = this.scroll;
    if (!slot || slot.hidden) return;
    var view = sc.getBoundingClientRect(), r = slot.getBoundingClientRect();
    var top = r.top - view.top + sc.scrollTop, bottom = top + r.height;
    var room = sc.clientHeight - DOCK_ROOM;
    var target = null;
    if (r.height > room - VIEW_PAD || top < sc.scrollTop + VIEW_PAD) target = top - VIEW_PAD;
    else if (bottom > sc.scrollTop + room) target = bottom - room;
    if (target === null) return;
    sc.scrollTo({ top: Math.max(0, target), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  // The stack holds every part's conclusions, with ids made unique per part.
  Player.prototype.stackItems = function () {
    var items = {};
    (this.q.parts || []).forEach(function (p, pi) {
      function add(key, c, prefix) {
        items[prefix + key] = Object.assign({}, c, { from: arr(c.from).map(function (f) { return 'p' + pi + '.' + f; }) });
      }
      Object.keys(p.conclusions || {}).forEach(function (k) { add(k, p.conclusions[k], 'p' + pi + '.'); });
      (p.items || []).forEach(function (it) { Object.keys(it.conclusions || {}).forEach(function (k) { add(k, it.conclusions[k], 'p' + pi + '.' + it.id + '.'); }); });
    });
    return items;
  };

  Player.prototype.mount = function (role, binding, input) {
    var self = this, slot = this.slots[role];
    var key = binding ? binding + '|' + JSON.stringify(input || {}) : '';
    if (this.keys[role] === key) return;
    if (this.inst[role]) this.inst[role].stop();
    this.keys[role] = key;
    var host = slot.querySelector('.lx-host'); host.innerHTML = '';
    if (!binding) { slot.hidden = true; this.inst[role] = null; return; }
    slot.hidden = false;
    slot.setAttribute('data-label', this.wf.roles[role].title + ' · ' + binding);
    var A = ADAPTERS[binding];
    var a = new A(host, input || {}, { sound: this.sound });
    a.binding = binding; a.interfaces = A.interfaces;
    a.on(function (ev) { self.trace('event', role + ' → ' + ev.name + (ev.value !== undefined ? ' ' + JSON.stringify(ev.value) : '') + (ev.id ? ' ' + ev.id : '')); self.onEvent(role, ev); });
    this.inst[role] = a;
  };

  Player.prototype.setupPart = function (pi) {
    var self = this, q = this.q, p = q.parts[pi];
    Object.keys(this.wf.roles).forEach(function (role) {
      var binding = (p.bind && p.bind[role]) || (q.bind && q.bind[role]) || null;
      var input = (p.inputs && p.inputs[role]) || (q.inputs && q.inputs[role]) || (role === self.stackRole ? { items: self.stackItems() } : null);
      self.mount(role, binding, input);
    });
    this.trace('part', '小题 ' + (p.tag || pi + 1) + '：' + this.wf.parts[p.kind].title);
  };

  // The scenes of a part, in order: scenes whose `when` does not hold are
  // left out, and a scene that repeats over the answer points becomes one
  // scene per point.
  Player.prototype.scenesOf = function (pi) {
    var self = this, p = this.q.parts[pi], kind = this.wf.parts[p.kind], out = [];
    arr(kind.scenes).forEach(function (e) {
      var name = typeof e === 'string' ? e : e.scene, def = self.wf.scenes[name];
      var params = {};
      Object.keys(def.params || {}).forEach(function (k) { params[k] = def.params[k].default; });
      Object.assign(params, (typeof e === 'object' && e.with) || {});
      var base = { pi: pi, name: name, def: def, params: params, part: Object.assign({}, kind.fixed || {}, p) };
      if (def.when && !self.holds(def.when, base)) return;
      if (def.repeat === 'items') (p.items || []).forEach(function (it, ii) { out.push(Object.assign({}, base, { item: it, ii: ii })); });
      else out.push(base);
    });
    out.forEach(function (s, i) { s.si = i; });
    return out;
  };

  Player.prototype.value = function (v, sc) {
    if (typeof v !== 'string' || v.charAt(0) !== '$') return v;
    var path = v.slice(1).split('.'), root = path.shift(), cur;
    if (root === 'item') cur = sc.item;
    else if (sc.params && root in sc.params) cur = sc.params[root];
    else cur = sc.part[root];
    path.forEach(function (k) { cur = cur === undefined || cur === null ? undefined : cur[k]; });
    return cur;
  };
  Player.prototype.holds = function (when, sc) {
    var self = this;
    return Object.keys(when).every(function (k) {
      if (k === 'has') return self.value('$' + when.has, sc) !== undefined;
      return self.value('$' + k, sc) === when[k];
    });
  };
  Player.prototype.lineId = function (key, sc) {
    if (!key) return null;
    if (sc.item && sc.item.lines && sc.item.lines[key] !== undefined) return 'p' + sc.pi + '.' + sc.item.id + '.' + key;
    if (sc.part.lines && sc.part.lines[key] !== undefined) return 'p' + sc.pi + '.' + key;
    return null;
  };
  Player.prototype.conclusionId = function (key, sc) {
    if (sc.item && sc.item.conclusions && sc.item.conclusions[key]) return 'p' + sc.pi + '.' + sc.item.id + '.' + key;
    if (sc.part.conclusions && sc.part.conclusions[key]) return 'p' + sc.pi + '.' + key;
    return null;
  };

  Player.prototype.guard = function (p, token) {
    if (token.aborted) return Promise.reject(ABORT);
    return Promise.race([Promise.resolve(p), token.abortP]);
  };
  Player.prototype.newToken = function () {
    var t = { aborted: false };
    t.abortP = new Promise(function (res, rej) { t.abort = function () { t.aborted = true; rej(ABORT); }; });
    t.abortP.catch(function () {});
    return t;
  };

  // Passes one interface call to the component bound to a role. A call
  // marked optional, on a role that may be absent, or to an interface the
  // role only uses when present, is skipped when it cannot be made.
  Player.prototype.callRole = function (spec, sc, extra) {
    var role = this.value(spec.role, sc), r = this.wf.roles[role], a = this.inst[role];
    var iface = spec.call.split('.')[0];
    var v = spec.with !== undefined ? this.value(spec.with, sc) : undefined;
    if (!a) { if (spec.optional || (r && r.optional)) return null; throw new Error('角色 ' + role + ' 没有组件'); }
    if (spec.with !== undefined && v === undefined) { if (spec.optional) return null; throw new Error(spec.call + ' 缺少 ' + spec.with); }
    if (a.interfaces.indexOf(iface) < 0) { if (spec.optional || arr(r.uses).indexOf(iface) >= 0) return null; throw new Error(a.binding + ' 没有接口 ' + iface); }
    this.trace('call', role + '（' + a.binding + '）. ' + spec.call + (v !== undefined ? ' ' + JSON.stringify(v) : ''));
    this.reveal(role);
    return a.call(spec.call, v, { at: sc.part.at }, extra);
  };

  Player.prototype.say = function (key, sc, token) {
    var id = this.lineId(key, sc);
    if (!id) return Promise.resolve();
    this.trace('say', id + '：' + this.lineText(id));
    var self = this;
    return this.guard(this.bar.say(id), token).then(function () { return self.guard(self.bar.whenRunning(), token); });
  };
  Player.prototype.lineText = function (id) { for (var i = 0; i < this.lines.length; i++) if (this.lines[i].id === id) return this.lines[i].text; return ''; };

  Player.prototype.runScene = function (sc, token, review) {
    var self = this, steps = sc.def.steps || [], i = 0;
    this.trace('scene', '幕：' + sc.def.title + (sc.item ? '（' + sc.item.id + '）' : '') + (review ? '，回看' : ''));
    function nextStep() {
      if (i >= steps.length) return Promise.resolve();
      var s = steps[i++];
      if (s.when && !self.holds(s.when, sc)) return nextStep();
      return self.guard(self.bar.whenRunning(), token).then(function () { return self.runStep(s, sc, token, review); }).then(nextStep);
    }
    return nextStep();
  };

  Player.prototype.runStep = function (s, sc, token, review) {
    if (s.act) return this.runAct(s.act, sc, token, review);
    if (s.show) return this.guard(this.callRole(s.show, sc), token);
    if (s.conclude) {
      var key = this.value(s.conclude, sc), id = this.conclusionId(key, sc);
      if (!id) { if (s.optional) return Promise.resolve(); throw new Error('没有结论 ' + key); }
      this.concludedAt[id] = { pi: sc.pi, si: sc.si };
      return this.guard(this.callRole({ role: this.stackRole, call: 'conclude.push', with: id }, sc), token);
    }
    var jobs = [];
    if (s.do) jobs.push(this.guard(this.callRole(s.do, sc), token));
    if (s.say) jobs.push(this.say(s.say, sc, token));
    return Promise.all(jobs);
  };

  // The child's turn. Waits for the role's answer event, accepts any of
  // the answers the question lists; a wrong answer is marked, then the
  // workflow's wrong-attempt order runs (a hint line, then a
  // demonstration), and the lecture goes on. In review, the answer is
  // shown instead of asked again.
  Player.prototype.runAct = function (act, sc, token, review) {
    var self = this, role = act.wait.role, a = this.inst[role];
    var item = act.wait.item !== undefined ? this.value(act.wait.item, sc) : null;
    var accept = arr(this.value(act.accept, sc)).map(String);
    var demo = act.demo !== undefined && this.value(act.demo, sc) !== undefined ? this.value(act.demo, sc) : accept[0];
    var lines = act.lines || {}, order = arr(this.wf.player.wrong), attempts = 0;
    this.reveal(role);
    if (review) {
      return this.guard(a.call('answer.demo', { item: item, value: demo }), token).then(function () { a.call('answer.check', { item: item, value: demo }, null, true); });
    }
    a.call('answer.clear', { item: item });
    function once() {
      self.bar.turn(true);
      self.trace('act', '等孩子：' + role + ' 的 answer.given' + (item !== null ? '（' + item + '）' : '') + '，算对：' + accept.join(' / '));
      return self.guard(self.waitFor(role, 'answer.given', item), token).then(function (ev) {
        self.bar.turn(false);
        var value = String(ev.value);
        if (accept.indexOf(value) >= 0) {
          a.call('answer.check', { item: item, value: ev.value }, null, true);
          self.trace('act', '答对了：' + value);
          return self.say(lines.right, sc, token);
        }
        attempts++;
        a.call('answer.check', { item: item, value: ev.value }, null, false);
        var what = order[attempts - 1] || 'demo';
        self.trace('act', '第 ' + attempts + ' 次答错：' + value + '，' + (what === 'hint' ? '说提示' : '演示'));
        if (what === 'hint') {
          return self.say(lines.hint, sc, token).then(function () { a.call('answer.clear', { item: item, value: ev.value }); }).then(once);
        }
        return self.guard(sleep(600), token).then(function () {
          a.call('answer.clear', { item: item, value: ev.value });
          return self.say(lines.demo, sc, token);
        }).then(function () { return self.guard(a.call('answer.demo', { item: item, value: demo }), token); })
          .then(function () { a.call('answer.check', { item: item, value: demo }, null, true); });
      });
    }
    return once();
  };

  Player.prototype.waitFor = function (role, name, item) {
    var self = this;
    return new Promise(function (res) { self.waiting = { role: role, name: name, item: item, resolve: res }; });
  };
  Player.prototype.onEvent = function (role, ev) {
    var w = this.waiting;
    if (w && w.role === role && w.name === ev.name && (w.item === null || w.item === undefined || String(w.item) === String(ev.item))) { this.waiting = null; w.resolve(ev); return; }
    if (ev.name === 'conclude.tap' && this.wf.player.review) this.review(ev.id);
  };

  Player.prototype.snapshot = function () {
    var self = this, s = {};
    Object.keys(this.inst).forEach(function (r) { if (self.inst[r]) s[r] = self.inst[r].getState(); });
    return { roles: s, line: this.bar.current };
  };
  Player.prototype.restore = function (snap) {
    var self = this;
    Object.keys(snap.roles).forEach(function (r) { if (self.inst[r]) self.inst[r].setState(snap.roles[r]); });
    this.bar.set({ line: snap.line });
  };
  Player.prototype.stopAll = function () {
    var self = this;
    this.waiting = null;
    this.bar.stop(); this.bar.turn(false); this.next.hide();
    Object.keys(this.inst).forEach(function (r) { if (self.inst[r]) self.inst[r].stop(); });
  };

  // Review: the child tapped a conclusion already reached in this part.
  // The stage goes back to how it stood when that scene began, the scene
  // is said again, then the stage returns to where the child was: the
  // 下一步 they were at, or the start of the scene they were in.
  Player.prototype.review = function (id) {
    var self = this, at = this.concludedAt[id];
    if (!at || at.pi !== this.cursor.pi || this.reviewing || this.done) return;
    var back = { pi: this.cursor.pi, si: this.cursor.si, phase: this.cursor.phase };
    this.trace('review', '回看 ' + id + '，回来时到「' + (back.phase === 'end' ? '下一步' : '这一幕的开头') + '」');
    var token = this.newToken();
    this.reviewing = Promise.resolve().then(function () {
      self.restore(self.snap[at.pi][at.si]);
      self.bar.flag('回看');
      return self.runScene(self.scenes[at.si], token, true).catch(function (e) { if (e !== ABORT) throw e; });
    }).then(function () {
      self.bar.flag(null);
      self.restore(back.phase === 'end' ? self.snapEnd[back.pi][back.si] : self.snap[back.pi][back.si]);
      self.cursor = back;
      self.trace('review', '回到原处');
      self.reviewing = null;
    });
    if (this.token) this.token.abort();
    this.stopAll();
  };

  Player.prototype.start = function () {
    var self = this;
    this.cursor = { pi: 0, si: 0, phase: 'run' };
    this.setupPart(0); this.scenes = this.scenesOf(0);
    this.snap = { 0: {} }; this.snapEnd = { 0: {} };
    return this.loop().catch(function (e) {
      if (e === ABORT) return;
      self.trace('error', String(e && e.stack || e));
      throw e;
    });
  };

  Player.prototype.isLast = function () {
    return this.cursor.pi === this.q.parts.length - 1 && this.cursor.si === this.scenes.length - 1;
  };

  Player.prototype.loop = function () {
    var self = this, wf = this.wf;
    if (this.done) return Promise.resolve();
    if (this.cursor.pi >= this.q.parts.length) { this.finish(); return Promise.resolve(); }
    var token = this.token = this.newToken();
    var c = this.cursor;
    var work;
    if (c.phase === 'run') {
      this.snap[c.pi][c.si] = this.snapshot();
      work = this.runScene(this.scenes[c.si], token).then(function () {
        self.snapEnd[c.pi][c.si] = self.snapshot();
        c.phase = 'end';
      });
    } else if (wf.player.sceneEnd === 'wait-next' && !this.isLast()) {
      this.trace('next', '这一幕讲完了，等孩子点「下一步」');
      work = this.guard(this.next.wait(), token).then(function () { self.advance(); });
    } else work = Promise.resolve().then(function () { self.advance(); });
    return work.then(function () { return self.loop(); }, function (e) {
      if (e !== ABORT) throw e;
      if (self.destroyed || self.done) return;
      return Promise.resolve(self.reviewing).then(function () { return self.loop(); });
    });
  };

  Player.prototype.advance = function () {
    var c = this.cursor;
    if (c.si + 1 < this.scenes.length) { this.cursor = { pi: c.pi, si: c.si + 1, phase: 'run' }; return; }
    var pi = c.pi + 1;
    if (pi >= this.q.parts.length) { this.cursor = { pi: pi, si: 0, phase: 'run' }; return; }
    if (this.wf.player.partEnd === 'clear-stack' && this.inst[this.stackRole]) this.inst[this.stackRole].call('conclude.set', []);
    this.bar.set({});
    this.setupPart(pi); this.scenes = this.scenesOf(pi);
    this.snap[pi] = {}; this.snapEnd[pi] = {};
    this.cursor = { pi: pi, si: 0, phase: 'run' };
  };

  Player.prototype.finish = function () {
    this.bar.flag('讲完了');
    this.trace('done', '这道讲题讲完了');
    this.done = true;
  };

  Player.prototype.destroy = function () {
    this.destroyed = true; this.done = true;
    if (this.token) this.token.abort();
    if (this.bar) this.stopAll();
  };

  Player.ADAPTERS = ADAPTERS;
  return Player;
})();
