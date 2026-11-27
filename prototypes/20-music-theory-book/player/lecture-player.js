/* ============================================================
   Lecture player. Reads a workflow file and a question file, puts the
   component the question binds to each of the workflow's roles on the
   stage, and runs the lecture exactly as the workflow file says: the
   opening scene that reads the question, the question's parts (小题),
   each part's scenes, each scene's steps (say, do, show, act, conclude),
   what happens at the end of a scene and of a part, moving back and
   forward a scene, and wrong attempts. Nothing in here knows a particular
   workflow, part kind, scene or component.

   The stage is a lit frame on a dark backdrop, full screen. Along its top
   are the player's own controls: close (back to the book), the question
   and its parts in a menu, and a dot per scene. On its left (on top on a
   phone) is the conclusion board; in the middle the question's text, the
   strip with the question's material, and the centre where the roles of
   the current scene stand, large; along the bottom the narration and the
   buttons for the previous and the next scene. Each scene names the roles
   that stand in the centre; the others leave, so the eye knows where to
   look. A role in the centre can only be touched while the child is
   asked to answer on it. Nothing scrolls or slides: the frame clips what
   it holds, the middle is scaled evenly to fit, and every change moves so
   the eye can follow it.

   Steps reach components only through capability interfaces: a step
   says "role R, interface call C, value V"; the player looks up the
   component bound to R and passes the call on.

   ADAPTERS is a temporary layer for the prototype: today's components
   still have their own command and event names (select, fill, optionTap,
   keyPress...). Each adapter turns interface calls into those commands
   and the component's events into interface events, and says which
   interfaces the component implements. When the interfaces are final
   and the components implement them directly, the adapters go away.
   ============================================================ */
var LecturePlayer = (function () {
  var ABORT = { aborted: true };
  // Motion: the theme's half-second glide with its very gentle start; a
  // crossfade lets the old content go a little before the new comes in.
  var MOVE_MS = 520, EASE = 'cubic-bezier(.6, 0, .25, 1)';
  var FADE_OUT_MS = 300, FADE_IN_MS = 420, FADE_IN_DELAY = 180, ENTER_STAGGER = 110;
  // Layout: the widest the middle column gets, the space between its
  // rows, the board's width beside the middle on a wide screen and its
  // height above it on a narrow one, and when a screen counts as wide.
  var COL_MAX = 760, ROW_GAP = 16, BOARD_W = 320, BOARD_H = 112, WIDE_MIN = 900, WIDE_RATIO = 1.15;
  // A material in the strip is drawn at most this wide, so it reads as the
  // question rather than the thing being worked on.
  var STRIP_MAX = 320;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function still() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function arr(x) { return x === undefined || x === null ? [] : [].concat(x); }
  function notesOf(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.reduce(function (a, g) { return a.concat(notesOf(g)); }, []);
    return arr(v.notes);
  }
  function rectOf(el) { var r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

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

  // Beat grid: point, count, meter, set, play. Changing to another rhythm
  // goes through the player's crossfade, so the new bar comes in where the
  // old one fades. In a hurry (a skipped scene) every mark is drawn at once.
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
  GridA.prototype.call = function (name, v, ctx) {
    var self = this, hurry = ctx && ctx.hurry;
    if (name === 'meter.show') { var s = this.sig(v); this.c.meter(s[0], s[1]); this.st.meter = v; this.st.sub = []; this.st.counts = []; return hurry ? null : sleep(700); }
    if (name === 'meter.subdivide') { this.c.subdivide(v); this.st.sub.push(v); return hurry ? null : sleep(400); }
    if (name === 'count.run') {
      this.st.counts.push(v);
      if (hurry) { this.c.count(v, undefined, undefined, true); return null; }
      return new Promise(function (res) { self.counting = res; self.c.count(v); setTimeout(function () { if (self.counting === res) { self.counting = null; res(); } }, 15000); });
    }
    if (name === 'point.highlight') { var idx = notesOf(v); this.c.highlight(idx); this.st.hl = idx; return; }
    if (name === 'point.label') { arr(v).forEach(function (g) { var i = notesOf(g)[0]; if (i !== undefined) { self.c.label(i, g.label, hurry); self.st.labels.push([i, g.label]); } }); return hurry ? null : sleep(500); }
    if (name === 'point.spotlight') { var n = notesOf(v); this.c.spotlight(n.length ? { tiles: [Math.min.apply(null, n), Math.max.apply(null, n)] } : null); return; }
    if (name === 'point.clear') { this.c.clear(); return; }
    if (name === 'set') { if (v === this.abc) return; if (hurry) { this.make(v); return; } this.env.swap(function () { self.make(v); }); return sleep(MOVE_MS); }
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
    var hurry = ctx && ctx.hurry;
    if (name === 'point.spotlight') { this.st.spotlight = arr(v); this.c.spotlight(this.st.spotlight); return; }
    if (name === 'point.highlight') { this.c.highlight(arr(v)); return; }
    if (name === 'point.clear') { this.st.spotlight = []; this.c.spotlight([]); this.c.highlight([]); return; }
    if (name === 'strike') { this.st.struck = this.st.struck.concat(arr(v)); this.c.strike(arr(v)); return hurry ? null : sleep(600); }
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
      return hurry ? null : sleep(500);
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
    var hurry = ctx && ctx.hurry;
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
      if (hurry) { this.apply(); return; }
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

  // Conclusion stack: conclude, point, mask, set. A push may carry the
  // place on screen the conclusion was reached; the stack flies it from
  // there, and the step waits until it has landed.
  function StackA(host, input, env) {
    Base.call(this, env);
    var self = this;
    this.c = new ConclusionStack(host, Object.assign({}, input, { mode: 'lecture', sound: env.sound, onEvent: function (ev) {
      if (ev.type === 'itemTap') self.emit({ name: 'conclude.tap', id: ev.id });
    } }));
  }
  StackA.prototype = Object.create(Base.prototype);
  StackA.interfaces = ['conclude', 'point', 'mask', 'set'];
  StackA.prototype.call = function (name, v, ctx) {
    if (name === 'conclude.push') {
      var id = v && typeof v === 'object' ? v.id : v, opts = v && v.from && !(ctx && ctx.hurry) ? { from: v.from } : null;
      if (this.c.order.indexOf(id) >= 0) return;
      this.c.push(id, opts);
      return ctx && ctx.hurry ? null : sleep(this.c.pushMs(opts) + 300);
    }
    if (name === 'conclude.set') { this.c.set(arr(v)); return; }
    if (name === 'point.highlight') { this.c.highlight(arr(v)); return; }
    throw new Error('conclusion-stack: ' + name);
  };
  StackA.prototype.getState = function () { return { order: this.c.order.slice() }; };
  StackA.prototype.setState = function (s) { this.c.set((s && s.order) || []); };

  var ADAPTERS = { score: ScoreA, 'beat-grid': GridA, choice: ChoiceA, fill: FillA, 'conclusion-stack': StackA };

  /* ---------- the stage: the player's own look ---------- */

  var FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';
  var STAGE_CSS = [
    // The backdrop around the lit stage, like a darkened theatre. The stage
    // and its frame clip what they hold, so nothing can scroll or slide.
    '.lx-stage{position:fixed;inset:0;overflow:hidden;overflow:clip;isolation:isolate;overscroll-behavior:none;font-family:' + FONT + ';',
    'background:radial-gradient(80% 70% at 50% 40%,#4a3628,#241a14 70%,#160f0b)}',
    '.lx-frame{position:absolute;inset:max(10px,env(safe-area-inset-top,0px)) max(10px,env(safe-area-inset-right,0px)) max(10px,env(safe-area-inset-bottom,0px)) max(10px,env(safe-area-inset-left,0px));display:grid;grid-template-rows:auto minmax(0,1fr) auto;grid-template-columns:minmax(0,1fr);border-radius:26px;overflow:hidden;overflow:clip;',
    'background:radial-gradient(70% 60% at 18% 8%,rgba(255,196,150,.55),transparent 70%),radial-gradient(60% 55% at 88% 12%,rgba(196,176,255,.45),transparent 70%),radial-gradient(90% 70% at 50% 110%,rgba(255,226,190,.7),transparent 70%),#f6efe4;',
    'box-shadow:0 30px 80px -20px rgba(0,0,0,.7),0 0 0 1px rgba(255,230,200,.12)}',
    '.lx-frame::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 140px 20px rgba(80,52,24,.14);border-radius:inherit}',
    '@media (max-width:600px){.lx-frame{inset:max(6px,env(safe-area-inset-top,0px)) max(6px,env(safe-area-inset-right,0px)) max(6px,env(safe-area-inset-bottom,0px)) max(6px,env(safe-area-inset-left,0px));border-radius:20px}}',
    // The top bar: close, the question menu, the scene dots.
    '.lx-top{position:relative;z-index:6;min-width:0;display:flex;align-items:center;gap:10px;padding:10px 12px 6px}',
    '.lx-btn{appearance:none;border:0;margin:0;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;color:#2a2118}',
    '.lx-btn:focus{outline:none}.lx-btn:focus-visible{outline:3px solid #a98bff;outline-offset:2px}',
    '.lx-close{flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.72);box-shadow:0 2px 8px -2px rgba(70,45,20,.35);transition:transform .15s,background .2s}',
    '.lx-close:hover{background:#fff}.lx-close:active{transform:scale(.94)}',
    '.lx-close svg,.lx-title svg,.lx-nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '.lx-title{flex:0 1 auto;min-width:0;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px 0 16px;border-radius:999px;background:rgba(255,255,255,.72);box-shadow:0 2px 8px -2px rgba(70,45,20,.35);font-size:15px;font-weight:800;transition:background .2s}',
    '.lx-title:hover{background:#fff}',
    '.lx-title span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lx-title .lx-part{color:#6d3cf0;flex:none}',
    '.lx-title svg{flex:none}',
    '.lx-dots{margin-left:auto;flex:0 1 auto;display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden;padding-right:4px}',
    '.lx-dotgroup{flex:none;display:flex;align-items:center;gap:4px}',
    '.lx-dotgroup b{font:italic 600 14px/1 "Cormorant Garamond",serif;color:#6b5238;margin-right:2px}',
    '.lx-dot{width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(107,82,56,.5);transition:background .3s,box-shadow .3s,transform .3s}',
    '.lx-dot.done{background:rgba(107,82,56,.55);box-shadow:none}',
    '.lx-dot.now{background:#7b4dff;box-shadow:0 0 0 3px rgba(123,77,255,.22);transform:scale(1.15)}',
    // On a phone only the current part's dots show.
    '@media (max-width:600px){.lx-dotgroup:not(.cur){display:none}.lx-dots{gap:6px}.lx-dot{width:7px;height:7px}.lx-dotgroup{gap:4px}.lx-title{font-size:14px;padding:0 10px 0 12px}}',
    '.lx-menu{position:absolute;z-index:20;top:58px;left:64px;min-width:240px;max-width:calc(100% - 76px);padding:8px;border-radius:16px;background:#fffdf8;box-shadow:0 20px 50px -12px rgba(40,24,10,.55),0 0 0 1px rgba(122,88,54,.12);transform-origin:20px 0;transition:opacity .2s,transform .25s cubic-bezier(.6,0,.25,1)}',
    '.lx-menu[hidden]{display:block;opacity:0;transform:translateY(-6px) scale(.97);pointer-events:none;visibility:hidden}',
    '.lx-menu h3{margin:6px 10px 4px;font-size:12px;color:#8a7a68;font-weight:700}',
    '.lx-menu .lx-btn{display:flex;width:100%;align-items:center;gap:8px;min-height:44px;padding:0 12px;border-radius:10px;font-size:15px;text-align:left;background:transparent}',
    '.lx-menu .lx-btn:hover{background:#f3ecff}',
    '.lx-menu .lx-btn[aria-current="true"]{color:#4b23c9;font-weight:800;background:#f3ecff}',
    // The body: the board and the middle.
    '.lx-body{position:relative;z-index:1;min-height:0;min-width:0;display:grid;gap:12px;padding:4px 14px 0}',
    '.lx-body[data-cols="2"]{grid-template-columns:' + BOARD_W + 'px minmax(0,1fr)}',
    '.lx-body[data-cols="1"]{grid-template-columns:minmax(0,1fr);grid-template-rows:' + BOARD_H + 'px minmax(0,1fr);padding:2px 8px 0}',
    '.lx-board{position:relative;z-index:3;min-height:0;min-width:0}',
    '.lx-board > .lx-role,.lx-board .lx-host{height:100%}',
    '.lx-main{position:relative;min-height:0;min-width:0;overflow:visible}',
    '.lx-canvas{position:absolute;left:0;top:0;display:flex;flex-direction:column;gap:' + ROW_GAP + 'px;transform-origin:0 0;will-change:transform}',
    '.lx-prompt{text-align:center;color:#2a2118;padding:0 8px}',
    '.lx-prompt p{margin:0;font-size:18px;font-weight:700;line-height:1.45}',
    '.lx-prompt p + p{margin-top:2px;font:italic 500 16px/1.3 "Cormorant Garamond","Times New Roman",serif;color:#6b5238}',
    '.lx-strip{display:grid;justify-items:center}',
    '.lx-strip:empty{display:none}',
    '.lx-strip > .lx-role{width:100%;max-width:' + STRIP_MAX + 'px}',
    '.lx-center{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center}',
    '.lx-center-in{display:grid;gap:' + ROW_GAP + 'px}',
    '.lx-role{position:relative;min-width:0}',
    '.lx-role[hidden]{display:none}',
    '.lx-ghost{position:absolute;margin:0;pointer-events:none}',
    // The dock: narration, then the previous and next scene.
    '.lx-dock{position:relative;z-index:5;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:12px;padding:8px 14px 12px;width:100%;max-width:1040px;justify-self:center;box-sizing:border-box;min-width:0}',
    '.lx-nav{display:flex;gap:10px;padding-bottom:2px}',
    '@media (max-width:760px){.lx-dock{grid-template-columns:minmax(0,1fr);gap:8px;padding:6px 8px 8px}.lx-nav{justify-content:space-between}}',
    '.lx-nav .lx-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:52px;padding:0 18px;border-radius:999px;font-size:16px;font-weight:800;transition:transform .15s,background .3s,box-shadow .3s,color .3s,opacity .3s}',
    '.lx-prev{background:rgba(255,255,255,.75);box-shadow:0 2px 8px -2px rgba(70,45,20,.35)}',
    '.lx-prev:hover{background:#fff}',
    '.lx-next{position:relative;color:#4b23c9;background:rgba(255,255,255,.75);box-shadow:0 2px 8px -2px rgba(70,45,20,.35)}',
    '.lx-next:hover{background:#fff}',
    '.lx-next.ready{color:#fff;background:radial-gradient(circle at 30% 25%,#9a7bff,#6d3cf0);box-shadow:0 14px 28px -12px #6d3cf0,0 0 0 4px rgba(255,255,255,.55)}',
    '.lx-next.ready::after{content:"";position:absolute;inset:-4px;border-radius:inherit;animation:lx-ring 2.2s ease-out 1s infinite}',
    '@keyframes lx-ring{0%{box-shadow:0 0 0 0 rgba(169,139,255,.55)}70%,100%{box-shadow:0 0 0 14px rgba(169,139,255,0)}}',
    '.lx-nav .lx-btn:active:not([disabled]){transform:scale(.96)}',
    '.lx-nav .lx-btn[disabled]{opacity:.38;cursor:default}',
    // The card at the end of the lecture.
    '.lx-end{position:absolute;inset:0;z-index:30;display:grid;place-items:center;padding:20px;background:rgba(36,26,20,.38);backdrop-filter:blur(3px);transition:opacity .45s}',
    '.lx-end[hidden]{display:grid;opacity:0;pointer-events:none;visibility:hidden}',
    '.lx-end-card{width:min(100%,400px);display:grid;gap:12px;justify-items:center;text-align:center;padding:28px 22px 22px;border-radius:24px;background:#fffdf8;box-shadow:0 30px 70px -20px rgba(30,18,8,.7);transform:translateY(0);transition:transform .52s cubic-bezier(.6,0,.25,1)}',
    '.lx-end[hidden] .lx-end-card{transform:translateY(18px)}',
    '.lx-end-seal{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;color:#fff;font:700 34px/1 "Cormorant Garamond",serif;background:radial-gradient(circle at 35% 30%,#b9a0ff,#7b4dff);box-shadow:0 10px 24px -8px #7b4dff,0 0 0 4px rgba(255,255,255,.9)}',
    '.lx-end-card h2{margin:4px 0 0;font-size:22px;color:#2a2118}',
    '.lx-end-card p{margin:0;color:#6b5238;font-size:15px}',
    '.lx-end-acts{display:grid;gap:10px;width:100%;margin-top:6px}',
    '.lx-end-acts .lx-btn{min-height:52px;border-radius:999px;font-size:16px;font-weight:800;background:#f3ecff;color:#4b23c9}',
    '.lx-end-acts .lx-btn.main{color:#fff;background:radial-gradient(circle at 30% 25%,#9a7bff,#6d3cf0);box-shadow:0 12px 26px -12px #6d3cf0}',
    '@media (prefers-reduced-motion:reduce){.lx-next.ready::after{animation:none}.lx-menu,.lx-end,.lx-end-card{transition-duration:.01ms}}'
  ].join('');

  var ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>'
  };

  function addStyle(id, css) {
    if (document.getElementById(id)) return;
    var s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s);
  }

  /* ---------- the player ---------- */

  function Player(opts) {
    var self = this, onTrace = opts.onTrace || function () {};
    this.opts = opts;
    this.wf = opts.workflow; this.q = opts.question;
    this.stage = opts.stage; this.sound = opts.sound;
    this.trace = function (kind, text) { if (!self.destroyed) onTrace(kind, text); };
    this.lines = opts.lines;
    this.inst = {}; this.keys = {};
    this.snap = {}; this.snapEnd = {};
    this.token = null; this.done = false; this.destroyed = false; this.mounted = null;
    this.scale = 1; this.cols = 1;
    this.problems = this.check();
    if (this.problems.length) return;
    this.plan = this.buildPlan();
    this.layout();
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

  // Every scene of the lecture in order: the opening scenes that read the
  // question, then each part's scenes. A scene's place in this list is how
  // the player moves back and forward.
  Player.prototype.buildPlan = function () {
    var self = this, out = [];
    arr(this.wf.player.opening).forEach(function (name) {
      var def = self.wf.scenes[name];
      out.push({ pi: 0, opening: true, name: name, def: def, params: {}, part: {} });
    });
    (this.q.parts || []).forEach(function (p, pi) { out = out.concat(self.scenesOf(pi)); });
    out.forEach(function (s, g) { s.g = g; });
    return out;
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
    return out;
  };

  // The stage: the frame with its top bar, the body (board and middle)
  // and the dock. Each role gets a slot in its place, in the order the
  // workflow lists them; the board paints above the middle, so a
  // conclusion flying to it passes over the other roles.
  Player.prototype.layout = function () {
    var self = this, wf = this.wf, q = this.q;
    addStyle('lx-stage-style', STAGE_CSS);
    this.stage.classList.add('lx-stage');
    this.stage.innerHTML =
      '<div class="lx-frame">' +
        '<div class="lx-top"><button type="button" class="lx-btn lx-close" aria-label="回到书本">' + ICON.close + '</button>' +
        '<button type="button" class="lx-btn lx-title" aria-haspopup="true" aria-expanded="false"><span class="lx-name"></span><span class="lx-part"></span>' + ICON.down + '</button>' +
        '<div class="lx-dots" aria-hidden="true"></div><div class="lx-menu" hidden></div></div>' +
        '<div class="lx-body" data-cols="1"><div class="lx-board"></div><div class="lx-main"><div class="lx-canvas">' +
          '<div class="lx-prompt"></div><div class="lx-strip"></div><div class="lx-center"><div class="lx-center-in"></div></div>' +
        '</div></div></div>' +
        '<div class="lx-dock"><div class="lx-bar"></div><div class="lx-nav">' +
          '<button type="button" class="lx-btn lx-prev">' + ICON.prev + '<span>上一幕</span></button>' +
          '<button type="button" class="lx-btn lx-next"><span>下一幕</span>' + ICON.next + '</button></div></div>' +
        '<div class="lx-end" hidden><div class="lx-end-card"></div></div>' +
      '</div>';
    var $ = function (s) { return self.stage.querySelector(s); };
    this.frame = $('.lx-frame'); this.body = $('.lx-body'); this.main = $('.lx-main'); this.canvas = $('.lx-canvas');
    this.promptEl = $('.lx-prompt'); this.stripEl = $('.lx-strip'); this.centerEl = $('.lx-center'); this.centerIn = $('.lx-center-in');
    this.boardEl = $('.lx-board'); this.menu = $('.lx-menu'); this.dotsEl = $('.lx-dots');
    this.prevBtn = $('.lx-prev'); this.nextBtn = $('.lx-next'); this.endEl = $('.lx-end');
    var pr = q.prompt || {};
    this.promptEl.innerHTML = (pr.text ? '<p lang="zh">' + esc(pr.text) + '</p>' : '') + (pr.gloss ? '<p lang="en">' + esc(pr.gloss) + '</p>' : '');
    $('.lx-name').textContent = q.title || '';
    this.slots = {};
    this.stackRole = Object.keys(wf.roles).filter(function (r) { return arr(wf.roles[r].needs).indexOf('conclude') >= 0; })[0];
    Object.keys(wf.roles).forEach(function (role) {
      var r = wf.roles[role];
      var slot = document.createElement('div');
      slot.className = 'lx-role'; slot.setAttribute('data-role', role); slot.hidden = true;
      slot.innerHTML = '<div class="lx-host"></div>';
      (r.place === 'board' ? self.boardEl : r.place === 'strip' ? self.stripEl : self.centerIn).appendChild(slot);
      if (r.place !== 'board' && r.place !== 'strip') slot.inert = true;
      self.slots[role] = slot;
    });
    this.bar = new NarrationBar($('.lx-bar'), {
      portrait: this.opts.portrait, controls: wf.player.narration || [], lines: this.lines,
      onEvent: function (ev) { self.trace('bar', ev.type + (ev.id ? ' ' + ev.id : '') + (ev.value ? ' ' + ev.value : '')); }
    });
    $('.lx-close').addEventListener('click', function () { self.trace('nav', '关闭，回到书本'); if (self.opts.onLeave) self.opts.onLeave(); });
    $('.lx-title').addEventListener('click', function () { self.openMenu(self.menu.hidden); });
    this.prevBtn.addEventListener('click', function () { self.back(); });
    this.nextBtn.addEventListener('click', function () { self.forward(); });
    this.frame.addEventListener('pointerdown', function (ev) { self.onPress(ev); }, true);
    this.frame.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !self.menu.hidden) self.openMenu(false); });
    this.ro = new ResizeObserver(function () { self.fit(); });
    this.ro.observe(this.main); this.ro.observe(this.canvas); this.ro.observe(this.stage);
    this.renderDots();
    this.fit();
  };

  // A touch on anything that can be pressed (whatever shows the pointing
  // hand) gives the player's soft press sound; a touch outside the open
  // menu closes it.
  Player.prototype.onPress = function (ev) {
    var t = ev.target;
    if (!this.menu.hidden && !t.closest('.lx-menu') && !t.closest('.lx-title')) this.openMenu(false);
    if (t.closest('[disabled]')) return;
    if (getComputedStyle(t).cursor === 'pointer' && this.sound && this.sound.tap) this.sound.tap();
  };

  // Fits the middle: picks the board beside it on a wide screen or on top
  // on a narrow one, sets the column width, then scales the canvas evenly
  // so the question's text, the strip and the centre all show at once,
  // with the centre in the middle of the room left under the strip. It
  // runs whenever anything changes size, frame by frame while a role
  // glides, so the scale follows smoothly. Widths depend only on the
  // screen; when they change, the roles are laid out again at the new width.
  Player.prototype.fit = function () {
    if (this.destroyed || !this.main) return;
    var wide = this.stage.clientWidth >= WIDE_MIN && this.stage.clientWidth >= this.stage.clientHeight * WIDE_RATIO;
    var cols = wide ? 2 : 1;
    if (cols !== this.cols || !this.body.getAttribute('data-ready')) { this.cols = cols; this.body.setAttribute('data-cols', String(cols)); this.body.setAttribute('data-ready', '1'); }
    var aw = this.main.clientWidth, ah = this.main.clientHeight, c = this.canvas;
    if (!aw || !ah) return;
    var w = Math.round(Math.min(COL_MAX, aw));
    if (w !== this.colW) {
      var again = this.colW !== undefined && Math.abs(w - this.colW) > 2;
      this.colW = w; c.style.width = w + 'px';
      if (again) this.relayoutSoon();
    }
    var h = this.promptEl.offsetHeight + this.stripEl.offsetHeight + this.centerIn.offsetHeight + ROW_GAP * 2;
    var s = Math.min(1, ah / Math.max(1, h), aw / w);
    c.style.minHeight = (ah / s).toFixed(1) + 'px';
    c.style.transform = 'translate(' + ((aw - w * s) / 2).toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')';
    this.scale = s;
  };

  // After the screen changes width, every role is drawn again at its new
  // width and set straight to the state it was in.
  Player.prototype.relayoutSoon = function () {
    var self = this;
    clearTimeout(this.relayoutTimer);
    this.relayoutTimer = setTimeout(function () {
      if (self.destroyed || self.mounted === null) return;
      var snap = self.snapshot();
      Object.keys(self.keys).forEach(function (r) { self.keys[r] = null; });
      self.setupPart(self.mounted, 'still');
      self.restoreRoles(snap);
      self.compose(self.plan[self.cursor.g], false);
    }, 220);
  };

  // Asks the browser for the full screen; the tap that starts the lecture
  // lets it. Where it cannot (a phone browser that only lets videos go
  // full screen, a frame that does not allow it), the stage still fills
  // the whole window.
  Player.prototype.fullscreen = function () {
    var self = this, el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) { this.trace('screen', '已经是全屏'); return; }
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { this.trace('screen', '这个浏览器不能让网页全屏，画面占满整个窗口'); return; }
    var no = function (e) { self.trace('screen', '浏览器没有让它全屏（' + ((e && e.message) || e || '没有说原因') + '），画面占满整个窗口'); };
    try {
      var p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(function () { self.trace('screen', '全屏了'); }, no);
    } catch (e) { no(e); }
  };

  /* ---------- the top bar ---------- */

  // A dot per scene: one for reading the question, then a group per part
  // with its tag. Scenes passed are filled, the current one is violet.
  Player.prototype.renderDots = function () {
    var self = this, html = '', group = null;
    this.plan.forEach(function (sc) {
      var key = sc.opening ? 'open' : 'p' + sc.pi;
      if (key !== group) {
        if (group !== null) html += '</span>';
        html += '<span class="lx-dotgroup">' + (sc.opening ? '' : '<b>' + esc(self.q.parts[sc.pi].tag || '') + '</b>');
        group = key;
      }
      html += '<i class="lx-dot" data-g="' + sc.g + '"></i>';
    });
    this.dotsEl.innerHTML = html + '</span>';
  };
  Player.prototype.markDots = function () {
    var g = this.cursor ? this.cursor.g : -1, reached = this.reached || 0;
    this.dotsEl.querySelectorAll('.lx-dot').forEach(function (d) {
      var i = Number(d.getAttribute('data-g'));
      d.classList.toggle('now', i === g);
      d.classList.toggle('done', i !== g && i <= reached);
    });
    this.dotsEl.querySelectorAll('.lx-dotgroup').forEach(function (gp) { gp.classList.toggle('cur', !!gp.querySelector('.lx-dot.now')); });
    var sc = this.plan[g], tag = sc && !sc.opening ? this.q.parts[sc.pi].tag || '' : '读题';
    this.stage.querySelector('.lx-part').textContent = tag;
  };

  // The menu under the title: reading the question and each part of this
  // question, then the book's other questions.
  Player.prototype.openMenu = function (on) {
    var self = this, m = this.menu;
    this.stage.querySelector('.lx-title').setAttribute('aria-expanded', String(on));
    if (!on) { m.hidden = true; return; }
    var cur = this.plan[this.cursor ? this.cursor.g : 0];
    var html = '<h3>' + esc(this.q.title || '') + '</h3>';
    if (this.wf.player.opening) html += '<button type="button" class="lx-btn" data-jump="open"' + (cur && cur.opening ? ' aria-current="true"' : '') + '>读题</button>';
    (this.q.parts || []).forEach(function (p, pi) {
      html += '<button type="button" class="lx-btn" data-jump="' + pi + '"' + (cur && !cur.opening && cur.pi === pi ? ' aria-current="true"' : '') + '>小题 ' + esc(p.tag || pi + 1) + ' · ' + esc(self.wf.parts[p.kind].title) + '</button>';
    });
    var book = arr(this.opts.book).filter(function (b) { return b.id !== self.q.id; });
    if (book.length) {
      html += '<h3>书里的其他题</h3>';
      book.forEach(function (b) { html += '<button type="button" class="lx-btn" data-question="' + esc(b.id) + '">' + esc(b.title) + '</button>'; });
    }
    m.innerHTML = html;
    m.querySelectorAll('[data-jump]').forEach(function (b) {
      b.addEventListener('click', function () {
        self.openMenu(false);
        var j = b.getAttribute('data-jump');
        self.jump(j === 'open' ? 0 : self.firstOf(Number(j)));
      });
    });
    m.querySelectorAll('[data-question]').forEach(function (b) {
      b.addEventListener('click', function () { self.openMenu(false); if (self.opts.onPick) self.opts.onPick(b.getAttribute('data-question')); });
    });
    m.hidden = false;
  };
  Player.prototype.firstOf = function (pi) {
    for (var g = 0; g < this.plan.length; g++) if (!this.plan[g].opening && this.plan[g].pi === pi) return g;
    return 0;
  };

  /* ---------- the previous and next scene ---------- */

  // 下一幕 glows when a scene has ended; before that it can skip the scene
  // when the workflow allows it and the child is not being asked to
  // answer. 上一幕 goes back a scene when the workflow allows it.
  Player.prototype.updateNav = function () {
    var c = this.cursor, sc = c && this.plan[c.g];
    var ended = c && c.phase === 'end' && !this.done;
    var canSkip = c && c.phase === 'run' && !this.waiting && this.wf.player.skip && sc && sc.def.skip !== false;
    var isLast = c && c.g >= this.plan.length - 1;
    this.nextBtn.disabled = !(ended && !isLast) && !(canSkip && !isLast);
    this.nextBtn.classList.toggle('ready', !!(ended && !isLast));
    this.prevBtn.disabled = !(this.wf.player.back && c && c.g > 0);
  };
  Player.prototype.forward = function () {
    var c = this.cursor; if (!c || this.nextBtn.disabled) return;
    if (c.phase === 'end') { if (this.resolveNext) { var r = this.resolveNext; this.resolveNext = null; r(); } return; }
    this.trace('nav', '跳过这一幕：' + this.plan[c.g].def.title);
    this.go(c.g, 'skip');
  };
  Player.prototype.back = function () {
    var c = this.cursor; if (!c || this.prevBtn.disabled) return;
    this.trace('nav', '回到上一幕：' + this.plan[c.g - 1].def.title);
    this.go(c.g - 1, 'back');
  };
  Player.prototype.jump = function (g) {
    this.trace('nav', '跳到：' + (this.plan[g].opening ? '读题' : '小题 ' + (this.q.parts[this.plan[g].pi].tag || '')));
    this.go(g, this.snap[g] ? 'back' : 'jump');
  };

  /* ---------- roles on the stage ---------- */

  // A copy of what a role shows now, laid over it, to fade out while the
  // new content comes in.
  function ghostOf(host) {
    var g = host.cloneNode(true);
    g.classList.add('lx-ghost');
    g.setAttribute('aria-hidden', 'true');
    g.style.left = '0px'; g.style.top = '0px';
    g.style.width = host.offsetWidth + 'px';
    return g;
  }

  // New content for a role that is on stage: the old drawing lifts a
  // little and fades, the new one rises into place a moment later, and the
  // role's height glides from one to the other.
  Player.prototype.swapRole = function (role, change) {
    var slot = this.slots[role], host = slot.querySelector('.lx-host');
    if (slot.hidden || still()) return change();
    var h0 = slot.offsetHeight, g = ghostOf(host);
    slot.appendChild(g);
    var out = change();
    var h1 = slot.offsetHeight;
    if (Math.abs(h1 - h0) > .5 && !slot.closest('.lx-board')) slot.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: MOVE_MS, easing: EASE });
    g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: FADE_OUT_MS, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).onfinish = function () { g.remove(); };
    host.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: FADE_IN_MS, delay: FADE_IN_DELAY, easing: EASE, fill: 'backwards' });
    return out;
  };

  // Puts the component a part binds on a role. Roles that are on stage
  // and get new content crossfade (how: 'swap'); the others are simply
  // drawn, unseen until a scene brings them in.
  Player.prototype.mount = function (role, binding, input, how) {
    var self = this, slot = this.slots[role];
    var key = binding ? binding + '|' + JSON.stringify(input || {}) : '';
    if (this.keys[role] === key) return;
    this.keys[role] = key;
    if (this.inst[role]) this.inst[role].stop();
    var build = function () {
      var host = slot.querySelector('.lx-host'); host.innerHTML = '';
      self.inst[role] = null;
      if (!binding) return;
      slot.setAttribute('data-label', self.wf.roles[role].title + ' · ' + binding);
      var A = ADAPTERS[binding];
      var a = new A(host, input || {}, { sound: self.sound, swap: function (fn) { return self.swapRole(role, fn); } });
      a.binding = binding; a.interfaces = A.interfaces;
      a.on(function (ev) { self.trace('event', role + ' → ' + ev.name + (ev.value !== undefined ? ' ' + JSON.stringify(ev.value) : '') + (ev.id ? ' ' + ev.id : '')); self.onEvent(role, ev); });
      self.inst[role] = a;
    };
    var place = this.wf.roles[role].place;
    var shown = place === 'board' || place === 'strip';
    if (!slot.hidden && how === 'swap' && binding) { this.swapRole(role, build); return; }
    if (shown) slot.hidden = !binding;
    var wasHidden = slot.hidden;
    if (wasHidden) slot.hidden = false;
    build();
    if (wasHidden && !(shown && binding)) slot.hidden = true;
  };

  Player.prototype.setupPart = function (pi, how) {
    var self = this, q = this.q, p = q.parts[pi];
    Object.keys(this.wf.roles).forEach(function (role) {
      var binding = (p.bind && p.bind[role]) || (q.bind && q.bind[role]) || null;
      var input = (p.inputs && p.inputs[role]) || (q.inputs && q.inputs[role]) || (role === self.stackRole ? { items: self.stackItems() } : null);
      self.mount(role, binding, input, how);
    });
    this.mounted = pi;
    this.trace('part', '小题 ' + (p.tag || pi + 1) + '：' + this.wf.parts[p.kind].title);
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

  // Where an element stands in the canvas, in the canvas's own pixels.
  Player.prototype.local = function (el) {
    var c = this.canvas.getBoundingClientRect(), r = el.getBoundingClientRect(), s = this.scale || 1;
    return { x: (r.left - c.left) / s, y: (r.top - c.top) / s, w: r.width / s, h: r.height / s };
  };

  // Puts on stage the roles a scene names: centre roles it names come in
  // (rising into place), centre roles it does not name leave (fading where
  // they were), a strip role it names steps from the strip to the centre
  // and back after; roles that stay glide from where they were to where
  // they are now, and the canvas's scale glides with them. Centre roles
  // can be touched only while an act waits on them.
  Player.prototype.compose = function (sc, animated) {
    var self = this, wf = this.wf, want = arr(sc.def.stage), move = animated && !still();
    var before = {}, oldT = this.canvas.style.transform;
    Object.keys(this.slots).forEach(function (r) { var s = self.slots[r]; if (!s.hidden && !s.closest('.lx-board')) before[r] = self.local(s); });
    var leaving = [];
    Object.keys(wf.roles).forEach(function (role) {
      var r = wf.roles[role], slot = self.slots[role], bound = !!self.inst[role];
      if (r.place === 'board') return;
      if (r.place === 'strip') {
        var inCentre = want.indexOf(role) >= 0;
        var target = inCentre ? self.centerIn : self.stripEl;
        if (slot.parentNode !== target) target.insertBefore(slot, inCentre ? target.firstChild : null);
        slot.hidden = !bound;
        return;
      }
      var on = bound && want.indexOf(role) >= 0;
      if (!on && !slot.hidden) leaving.push(role);
      slot.hidden = !on;
      slot.inert = true;
    });
    this.fit();
    if (!move) return;
    var newT = this.canvas.style.transform;
    if (oldT && oldT !== newT) this.canvas.animate([{ transform: oldT }, { transform: newT }], { duration: MOVE_MS, easing: EASE });
    leaving.forEach(function (role) {
      var b = before[role], g = ghostOf(self.slots[role]);
      g.style.left = b.x + 'px'; g.style.top = b.y + 'px'; g.style.width = b.w + 'px';
      self.canvas.appendChild(g);
      g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: FADE_OUT_MS, easing: 'ease-in', fill: 'forwards' }).onfinish = function () { g.remove(); };
    });
    var order = 0;
    Object.keys(this.slots).forEach(function (role) {
      var slot = self.slots[role]; if (slot.hidden || slot.closest('.lx-board')) return;
      var a = self.local(slot), b = before[role];
      if (!b) {
        slot.querySelector('.lx-host').animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: MOVE_MS, delay: FADE_IN_DELAY + order++ * ENTER_STAGGER, easing: EASE, fill: 'backwards' });
        return;
      }
      if (Math.abs(a.x - b.x) < .5 && Math.abs(a.y - b.y) < .5 && Math.abs(a.w - b.w) < .5) return;
      slot.animate([{ transformOrigin: '0 0', transform: 'translate(' + (b.x - a.x) + 'px,' + (b.y - a.y) + 'px) scale(' + (b.w / a.w) + ')' }, { transformOrigin: '0 0', transform: 'none' }], { duration: MOVE_MS, easing: EASE });
    });
  };

  /* ---------- reading the files ---------- */

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
    if (sc.opening) return this.q.lines && this.q.lines[key] !== undefined ? 'q.' + key : null;
    if (sc.item && sc.item.lines && sc.item.lines[key] !== undefined) return 'p' + sc.pi + '.' + sc.item.id + '.' + key;
    if (sc.part.lines && sc.part.lines[key] !== undefined) return 'p' + sc.pi + '.' + key;
    return null;
  };
  Player.prototype.conclusionId = function (key, sc) {
    if (sc.item && sc.item.conclusions && sc.item.conclusions[key]) return 'p' + sc.pi + '.' + sc.item.id + '.' + key;
    if (sc.part.conclusions && sc.part.conclusions[key]) return 'p' + sc.pi + '.' + key;
    return null;
  };
  Player.prototype.lineText = function (id) { for (var i = 0; i < this.lines.length; i++) if (this.lines[i].id === id) return this.lines[i].text; return ''; };

  Player.prototype.guard = function (p, token) {
    if (token.aborted) return Promise.reject(ABORT);
    return Promise.race([Promise.resolve(p), token.abortP]);
  };
  Player.prototype.newToken = function (hurry) {
    var t = { aborted: false, hurry: !!hurry };
    t.abortP = new Promise(function (res, rej) { t.abort = function () { t.aborted = true; rej(ABORT); }; });
    t.abortP.catch(function () {});
    return t;
  };

  /* ---------- running a scene ---------- */

  // Passes one interface call to the component bound to a role. A call
  // marked optional, on a role that may be absent, or to an interface the
  // role only uses when present, is skipped when it cannot be made. The
  // value is the step's `with`, read from the question, or one the player
  // works out itself (`value`). The scene remembers the last role it acted
  // on other than the stack: that is where its conclusion comes from.
  Player.prototype.callRole = function (spec, sc, token, extra) {
    var role = this.value(spec.role, sc), r = this.wf.roles[role], a = this.inst[role];
    var iface = spec.call.split('.')[0];
    var given = 'value' in spec || spec.with !== undefined;
    var v = 'value' in spec ? spec.value : spec.with !== undefined ? this.value(spec.with, sc) : undefined;
    if (!a) { if (spec.optional || (r && r.optional)) return null; throw new Error('角色 ' + role + ' 没有组件'); }
    if (given && v === undefined) { if (spec.optional) return null; throw new Error(spec.call + ' 缺少 ' + spec.with); }
    if (a.interfaces.indexOf(iface) < 0) { if (spec.optional || arr(r.uses).indexOf(iface) >= 0) return null; throw new Error(a.binding + ' 没有接口 ' + iface); }
    this.trace('call', role + '（' + a.binding + '）. ' + spec.call + (v !== undefined ? ' ' + JSON.stringify(v) : ''));
    if (role !== this.stackRole) sc.lastRole = role;
    return a.call(spec.call, v, { at: sc.part.at, hurry: token && token.hurry }, extra);
  };

  Player.prototype.say = function (key, sc, token) {
    var id = this.lineId(key, sc);
    if (!id || token.hurry) return Promise.resolve();
    this.trace('say', id + '：' + this.lineText(id));
    var self = this;
    return this.guard(this.bar.say(id), token).then(function () { return self.guard(self.bar.whenRunning(), token); });
  };

  Player.prototype.runScene = function (sc, token) {
    var self = this, steps = sc.def.steps || [], i = 0;
    sc.lastRole = null;
    this.trace('scene', '幕：' + sc.def.title + (sc.item ? '（' + sc.item.id + '）' : '') + (token.hurry ? '，跳过' : ''));
    function nextStep() {
      if (i >= steps.length) return Promise.resolve();
      var s = steps[i++];
      if (s.when && !self.holds(s.when, sc)) return nextStep();
      var wait = token.hurry ? Promise.resolve() : self.bar.whenRunning();
      return self.guard(wait, token).then(function () { return self.runStep(s, sc, token); }).then(nextStep);
    }
    return nextStep();
  };

  // A conclusion goes to the stack from where the scene reached it: the
  // role the step names in `from`, or else the last role the scene acted
  // on; the stack flies it up from that role's place on screen.
  Player.prototype.conclude = function (s, sc, token) {
    var key = this.value(s.conclude, sc), id = this.conclusionId(key, sc);
    if (!id) { if (s.optional) return Promise.resolve(); throw new Error('没有结论 ' + key); }
    var src = s.from ? this.value(s.from, sc) : sc.lastRole, slot = src && this.slots[src];
    var from = slot && !slot.hidden ? rectOf(slot) : null;
    if (from && !token.hurry) this.trace('call', '结论从「' + this.wf.roles[src].title + '」飞到结论板');
    return this.guard(this.callRole({ role: this.stackRole, call: 'conclude.push', value: { id: id, from: from } }, sc, token), token);
  };

  Player.prototype.runStep = function (s, sc, token) {
    if (s.act) return this.runAct(s.act, sc, token);
    if (s.show) return this.guard(this.callRole(s.show, sc, token), token);
    if (s.conclude) return this.conclude(s, sc, token);
    var jobs = [];
    if (s.do) jobs.push(this.guard(this.callRole(s.do, sc, token), token));
    if (s.say) jobs.push(this.say(s.say, sc, token));
    return Promise.all(jobs);
  };

  // The child's turn. The answering role can be touched only now. Waits
  // for its answer event and accepts any of the answers the question
  // lists; a wrong answer is marked, then the workflow's wrong-attempt
  // order runs (a hint line, then a demonstration), and the lecture goes
  // on. A scene run in a hurry shows the answer instead of asking.
  Player.prototype.runAct = function (act, sc, token) {
    var self = this, role = act.wait.role, a = this.inst[role], slot = this.slots[role];
    var item = act.wait.item !== undefined ? this.value(act.wait.item, sc) : null;
    var accept = arr(this.value(act.accept, sc)).map(String);
    var demo = act.demo !== undefined && this.value(act.demo, sc) !== undefined ? this.value(act.demo, sc) : accept[0];
    var lines = act.lines || {}, order = arr(this.wf.player.wrong), attempts = 0;
    var ctx = { hurry: token.hurry };
    sc.lastRole = role;
    if (token.hurry) {
      return this.guard(a.call('answer.demo', { item: item, value: demo }, ctx), token).then(function () { a.call('answer.check', { item: item, value: demo }, ctx, true); });
    }
    a.call('answer.clear', { item: item });
    var live = function (on) { slot.inert = !on; self.updateNav(); };
    function once() {
      self.bar.turn(true);
      self.trace('act', '等孩子：' + role + ' 的 answer.given' + (item !== null ? '（' + item + '）' : '') + '，算对：' + accept.join(' / '));
      var waiting = self.waitFor(role, 'answer.given', item);
      live(true);
      return self.guard(waiting, token).then(function (ev) {
        live(false);
        self.bar.turn(false);
        var value = String(ev.value);
        if (accept.indexOf(value) >= 0) {
          a.call('answer.check', { item: item, value: ev.value }, ctx, true);
          self.trace('act', '答对了：' + value);
          return self.say(lines.right, sc, token);
        }
        attempts++;
        a.call('answer.check', { item: item, value: ev.value }, ctx, false);
        var what = order[attempts - 1] || 'demo';
        self.trace('act', '第 ' + attempts + ' 次答错：' + value + '，' + (what === 'hint' ? '说提示' : '演示'));
        if (what === 'hint') {
          return self.say(lines.hint, sc, token).then(function () { a.call('answer.clear', { item: item, value: ev.value }); }).then(once);
        }
        return self.guard(sleep(600), token).then(function () {
          a.call('answer.clear', { item: item, value: ev.value });
          return self.say(lines.demo, sc, token);
        }).then(function () { return self.guard(a.call('answer.demo', { item: item, value: demo }, ctx), token); })
          .then(function () { a.call('answer.check', { item: item, value: demo }, ctx, true); });
      }, function (e) { live(false); throw e; });
    }
    return once();
  };

  Player.prototype.waitFor = function (role, name, item) {
    var self = this;
    return new Promise(function (res) { self.waiting = { role: role, name: name, item: item, resolve: res }; });
  };
  Player.prototype.onEvent = function (role, ev) {
    var w = this.waiting;
    if (w && w.role === role && w.name === ev.name && (w.item === null || w.item === undefined || String(w.item) === String(ev.item))) { this.waiting = null; w.resolve(ev); }
  };

  /* ---------- snapshots ---------- */

  Player.prototype.snapshot = function () {
    var self = this, s = {};
    Object.keys(this.inst).forEach(function (r) { if (self.inst[r]) s[r] = self.inst[r].getState(); });
    return { pi: this.mounted, roles: s, line: this.bar.current };
  };
  Player.prototype.restoreRoles = function (snap) {
    var self = this;
    Object.keys(snap.roles).forEach(function (r) { if (self.inst[r]) self.inst[r].setState(snap.roles[r]); });
  };
  // Sets the stage straight to a snapshot, mounting that part's components
  // first when another part is on stage. The picture dissolves from how it
  // stood to the restored one, so the jump is not a cut.
  Player.prototype.restore = function (snap, sc) {
    var self = this;
    this.dissolve(function () {
      if (self.mounted !== snap.pi) self.setupPart(snap.pi, 'still');
      self.restoreRoles(snap);
      self.compose(sc, false);
    });
    this.bar.set({ line: snap.line });
  };
  Player.prototype.dissolve = function (change) {
    if (still()) { change(); return; }
    var g = this.body.cloneNode(true);
    g.classList.add('lx-ghost'); g.setAttribute('aria-hidden', 'true');
    g.style.left = this.body.offsetLeft + 'px'; g.style.top = this.body.offsetTop + 'px';
    g.style.width = this.body.offsetWidth + 'px'; g.style.height = this.body.offsetHeight + 'px';
    g.style.zIndex = '4';
    this.frame.appendChild(g);
    change();
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_IN_MS, easing: 'ease-in', fill: 'forwards' }).onfinish = function () { g.remove(); };
    this.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, delay: 80, easing: EASE, fill: 'backwards' });
  };
  Player.prototype.stopAll = function () {
    var self = this;
    this.waiting = null; this.resolveNext = null;
    this.bar.stop(); this.bar.turn(false);
    Object.keys(this.inst).forEach(function (r) { if (self.inst[r]) self.inst[r].stop(); });
  };

  /* ---------- the lecture's course ---------- */

  Player.prototype.start = function () {
    this.fullscreen();
    this.reached = 0;
    this.setupPart(0, 'still');
    this.enter();
    this.go(0, 'start');
  };

  // At the start the parts of the stage rise in one after another.
  Player.prototype.enter = function () {
    if (still()) return;
    var order = 0;
    [this.boardEl, this.promptEl].concat([].slice.call(this.canvas.querySelectorAll('.lx-role:not([hidden])'))).forEach(function (el) {
      el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: MOVE_MS, delay: order++ * ENTER_STAGGER, easing: EASE, fill: 'backwards' });
    });
  };

  // Moves to scene g and runs from there. how: 'start' and 'next' play it
  // in turn (a new part sets up its components and clears the stack as
  // the workflow says); 'back' and a jump to a scene seen before set the
  // stage straight to how it began; 'jump' to a part not seen yet sets up
  // that part afresh; 'skip' sets the scene back to its start and runs it
  // in a hurry, without narration and with every mark drawn at once, then
  // goes on to the next.
  Player.prototype.go = function (g, how) {
    var self = this, sc = this.plan[g];
    if (this.token) this.token.abort();
    this.stopAll();
    this.done = false; this.endEl.hidden = true;
    this.bar.flag(null);
    var token = this.token = this.newToken(how === 'skip');
    var prev = this.cursor;
    this.cursor = { g: g, phase: 'run' };
    if (how === 'back' || (how === 'skip' && this.snap[g])) this.restore(this.snap[g], sc);
    else {
      var stack = this.inst[this.stackRole];
      if (this.mounted !== sc.pi) {
        if (this.wf.player.partEnd === 'clear-stack' && stack && stack.c.order.length) this.swapRole(this.stackRole, function () { stack.call('conclude.set', []); });
        this.bar.set({});
        this.setupPart(sc.pi, 'swap');
      }
      this.compose(sc, how !== 'start');
    }
    if (!this.snap[g]) this.snap[g] = this.snapshot();
    this.reached = Math.max(this.reached, g);
    this.markDots(); this.updateNav();
    var pause = how === 'start' || (prev && this.plan[prev.g] && this.plan[prev.g].pi !== sc.pi) ? (still() ? 0 : MOVE_MS + FADE_IN_DELAY) : 0;
    this.guard(sleep(token.hurry ? 0 : pause), token).then(function () { return self.runScene(sc, token); }).then(function () {
      self.snapEnd[g] = self.snapshot();
      self.cursor.phase = 'end';
      if (g >= self.plan.length - 1) { self.finish(); return; }
      if (token.hurry) { self.go(g + 1, 'next'); return; }
      self.updateNav();
      if (self.wf.player.sceneEnd !== 'wait-next') { self.go(g + 1, 'next'); return; }
      self.trace('next', '这一幕讲完了，等孩子点「下一幕」');
      return self.guard(new Promise(function (res) { self.resolveNext = res; }), token).then(function () { self.go(g + 1, 'next'); });
    }).catch(function (e) {
      if (e === ABORT || self.destroyed) return;
      self.trace('error', String(e && e.stack || e));
    });
  };

  // The end of the lecture: the narration says so, and a card offers to
  // hear it again, stay and look at the conclusions, or go back to the book.
  Player.prototype.finish = function () {
    var self = this;
    this.done = true;
    this.bar.flag('讲完了');
    this.updateNav();
    this.trace('done', '这道讲题讲完了');
    var card = this.endEl.querySelector('.lx-end-card');
    card.innerHTML = '<div class="lx-end-seal" aria-hidden="true">∴</div><h2>这道题讲完了</h2><p>' + esc(this.q.title || '') + '</p>' +
      '<div class="lx-end-acts"><button type="button" class="lx-btn main" data-end="again">从头再听一遍</button><button type="button" class="lx-btn" data-end="look">留在这里，看看结论</button><button type="button" class="lx-btn" data-end="leave">回到书本</button></div>';
    card.querySelector('[data-end="again"]').addEventListener('click', function () { self.trace('nav', '从头再听一遍'); self.endEl.hidden = true; self.go(0, self.snap[0] ? 'back' : 'jump'); });
    card.querySelector('[data-end="look"]').addEventListener('click', function () { self.endEl.hidden = true; });
    card.querySelector('[data-end="leave"]').addEventListener('click', function () { self.trace('nav', '回到书本'); if (self.opts.onLeave) self.opts.onLeave(); });
    setTimeout(function () { if (self.done && !self.destroyed) self.endEl.hidden = false; }, still() ? 0 : 900);
  };

  Player.prototype.destroy = function () {
    this.destroyed = true; this.done = true;
    if (this.ro) this.ro.disconnect();
    clearTimeout(this.relayoutTimer);
    if (this.token) this.token.abort();
    if (this.bar) this.stopAll();
  };

  Player.ADAPTERS = ADAPTERS;
  return Player;
})();
