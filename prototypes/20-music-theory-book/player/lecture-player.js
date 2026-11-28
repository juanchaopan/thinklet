/* ============================================================
   Lecture player. Reads a workflow file and a question file and runs
   the lecture exactly as the workflow file says: it puts the controls
   the workflow lays out (stage theme components: close, question menu,
   part switch, the question's title, previous and next scene, the
   subtitle, replay) where the workflow puts them, puts the component the
   question binds to each of the workflow's roles on the stage, and plays
   the opening scene that reads the question, then the question's parts,
   each part's scenes and each scene's steps (say, do, show, act,
   conclude); what happens at the end of a scene and of a part, where
   the child may go back or on, and wrong attempts, all come from the
   workflow file. Nothing in here knows a particular workflow, part kind,
   scene or component: components are found through the registry and
   reached only through their capability interfaces.

   The stage is a lit frame on a dark backdrop, full screen: the
   workflow's top controls along its top, the conclusion board on its
   left (on top on a phone), in the middle the question's title, the
   strip with the question's material and the centre where the roles of
   the current scene stand, large; the workflow's bottom controls along
   the bottom. A role in the centre can only be touched while the child
   is asked to answer on it. Nothing scrolls or slides: the frame clips
   what it holds, the middle is scaled evenly to fit, and every change
   moves so the eye can follow it.

   Where the child may go: back always (the previous scene, an earlier
   part, a conclusion's scene), when the workflow allows going back; on
   only past scenes that may be skipped or have been done once, so a
   scene that asks the child to answer is never passed unanswered.
   ============================================================ */
var LecturePlayer = (function () {
  var ABORT = { aborted: true };
  var U = LessonComponents.util, arr = U.arr, sleep = U.sleep;
  // Motion: the theme's half-second glide with its very gentle start; a
  // crossfade lets the old content go a little before the new comes in.
  var MOVE_MS = 520, EASE = 'cubic-bezier(.6, 0, .25, 1)';
  var FADE_OUT_MS = 300, FADE_IN_MS = 420, FADE_IN_DELAY = 180, ENTER_STAGGER = 110;
  // Layout: the widest the middle column gets, the space between its
  // rows, the board's width beside the middle on a wide screen and its
  // height above it on a narrow one, and when a screen counts as wide.
  var COL_MAX = 760, ROW_GAP = 16, BOARD_W = 320, BOARD_H = 112, WIDE_MIN = 900, WIDE_RATIO = 1.15;
  // A material in the strip reads as the question rather than the thing
  // being worked on: it is drawn at most this wide, and narrower still
  // when it would take more than this share of the middle's height
  // (within these bounds in pixels).
  var STRIP_MAX = 320, STRIP_MIN = 140, STRIP_SHARE = .24, STRIP_MIN_H = 84, STRIP_MAX_H = 150;
  // Where the workflow can put controls, in the order they are built.
  var PLACES = ['top', 'head', 'bottom'];

  function still() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function rectOf(el) { var r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
  function fileOf(id) { return id.replace(/[^A-Za-z0-9]+/g, '-') + '.mp3'; }

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
    // A control's place: as wide as the control and no wider than its
    // row, gone when the control is hidden; the subtitle's place takes the
    // room left in its row.
    '.lx-ctl{position:relative;flex:0 1 auto;display:flex;min-width:0}',
    '.lx-ctl.lx-grow{flex:1 1 auto}',
    '.lx-ctl:has(> [hidden]){display:none}',
    '.lx-top{position:relative;z-index:6;min-width:0;display:flex;align-items:center;gap:10px;padding:10px 12px 4px}',
    '.lx-body{position:relative;z-index:1;min-height:0;min-width:0;display:grid;gap:12px;padding:6px 14px 0}',
    '.lx-body[data-cols="2"]{grid-template-columns:' + BOARD_W + 'px minmax(0,1fr)}',
    '.lx-body[data-cols="1"]{grid-template-columns:minmax(0,1fr);grid-template-rows:' + BOARD_H + 'px minmax(0,1fr);padding:4px 8px 0}',
    '.lx-board{position:relative;z-index:3;min-height:0;min-width:0}',
    '.lx-board > .lx-role,.lx-board .lx-host{height:100%}',
    '.lx-main{position:relative;min-height:0;min-width:0;display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px}',
    '.lx-head{position:relative;z-index:2;min-width:0;display:flex;justify-content:center}',
    '.lx-head:empty{display:none}',
    '.lx-room{position:relative;min-height:0;min-width:0}',
    '.lx-canvas{position:absolute;left:0;top:0;display:flex;flex-direction:column;gap:' + ROW_GAP + 'px;transform-origin:0 0;will-change:transform}',
    '.lx-strip{display:grid;justify-items:center}',
    '.lx-strip:empty{display:none}',
    '.lx-strip > .lx-role{width:100%;max-width:var(--lx-strip-w,' + STRIP_MAX + 'px)}',
    '.lx-center{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center}',
    '.lx-center-in{display:grid;gap:' + ROW_GAP + 'px}',
    '.lx-role{position:relative;min-width:0}',
    '.lx-role[hidden]{display:none}',
    '.lx-ghost{position:absolute;margin:0;pointer-events:none}',
    '.lx-dock{position:relative;z-index:5;display:flex;align-items:center;gap:12px;padding:10px 14px 12px;width:100%;max-width:1100px;justify-self:center;box-sizing:border-box;min-width:0}',
    '@media (max-width:600px){.lx-top{gap:8px;padding:8px 8px 2px}.lx-dock{gap:6px;padding:6px 6px 8px}}'
  ].join('');

  function addStyle(id, css) {
    if (document.getElementById(id)) return;
    var s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s);
  }

  // Every line a question has, with the ids the player says them by:
  // q.<key> for the question's own lines (reading it), p<part>.<key>,
  // p<part>.<item>.<key>; each with the url of its recording under base.
  function linesOf(q, base) {
    var out = [];
    function add(id, l) { out.push({ id: id, text: typeof l === 'string' ? l : l.text, url: base + fileOf(id) }); }
    Object.keys(q.lines || {}).forEach(function (k) { add('q.' + k, q.lines[k]); });
    (q.parts || []).forEach(function (p, pi) {
      Object.keys(p.lines || {}).forEach(function (k) { add('p' + pi + '.' + k, p.lines[k]); });
      (p.items || []).forEach(function (it) { Object.keys(it.lines || {}).forEach(function (k) { add('p' + pi + '.' + it.id + '.' + k, it.lines[k]); }); });
    });
    return out;
  }

  /* ---------- the player ---------- */

  function Player(opts) {
    var self = this, onTrace = opts.onTrace || function () {};
    this.opts = opts;
    this.wf = opts.workflow; this.q = opts.question;
    this.stage = opts.stage; this.sound = opts.sound;
    this.trace = function (kind, text) { if (!self.destroyed) onTrace(kind, text); };
    this.lines = opts.lines;
    this.inst = {}; this.keys = {}; this.ctl = {};
    this.snap = {}; this.done = {}; this.concludedAt = {};
    this.token = null; this.finished = false; this.destroyed = false; this.mounted = null;
    this.scale = 1; this.cols = 1;
    this.problems = this.check();
    if (this.problems.length) return;
    this.plan = this.buildPlan();
    this.layout();
  }
  Player.linesOf = linesOf;

  // What `task content` will check: every control the workflow lays out
  // is a stage theme component and the subtitle is among them; every role
  // the workflow needs has a component of the question's theme that
  // implements its interfaces; every part is a kind the workflow offers
  // and fills what that kind requires, and nothing else.
  Player.prototype.check = function () {
    var wf = this.wf, q = this.q, out = [], st = wf.stage || {}, talk = false;
    PLACES.forEach(function (place) {
      arr(st[place]).forEach(function (id) {
        var d = LessonComponents.get(id);
        if (!d || d.theme !== 'stage') { out.push('舞台上的 ' + id + ' 不是舞台主题的组件'); return; }
        if (d.interfaces.indexOf('narrate') >= 0) talk = true;
      });
    });
    if (!talk) out.push('流程的舞台上没有字幕条');
    var parts = q.parts || [];
    Object.keys(wf.roles).forEach(function (role) {
      var r = wf.roles[role];
      var binds = [q.bind && q.bind[role]].concat(parts.map(function (p) { return p.bind && p.bind[role]; })).filter(Boolean);
      if (!binds.length && !r.optional) out.push('角色「' + r.title + '」没有指定组件');
      binds.forEach(function (b) {
        var d = LessonComponents.get(b);
        if (!d) { out.push('角色「' + r.title + '」指定的组件 ' + b + ' 不存在'); return; }
        if (d.theme !== q.theme) out.push('组件 ' + b + ' 不在题目选的主题 ' + q.theme + ' 里');
        arr(r.needs).forEach(function (i) { if (d.interfaces.indexOf(i) < 0) out.push('组件 ' + b + ' 没有实现角色「' + r.title + '」要的接口 ' + i); });
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
      out.push({ pi: 0, opening: true, name: name, def: self.wf.scenes[name], params: {}, part: {} });
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

  // The stage: the frame with the workflow's top controls, the body (the
  // board, and the middle with the head controls over the scaled canvas)
  // and the workflow's bottom controls. Each role gets a slot in its
  // place, in the order the workflow lists them; the board paints above
  // the middle, so a conclusion flying to it passes over the other roles.
  Player.prototype.layout = function () {
    var self = this, wf = this.wf;
    addStyle('lx-stage-style', STAGE_CSS);
    this.stage.classList.add('lx-stage');
    this.stage.innerHTML =
      '<div class="lx-frame">' +
        '<div class="lx-top"></div>' +
        '<div class="lx-body" data-cols="1"><div class="lx-board"></div><div class="lx-main"><div class="lx-head"></div><div class="lx-room"><div class="lx-canvas">' +
          '<div class="lx-strip"></div><div class="lx-center"><div class="lx-center-in"></div></div>' +
        '</div></div></div></div>' +
        '<div class="lx-dock"></div>' +
      '</div>';
    var $ = function (s) { return self.stage.querySelector(s); };
    this.frame = $('.lx-frame'); this.body = $('.lx-body'); this.room = $('.lx-room'); this.canvas = $('.lx-canvas');
    this.stripEl = $('.lx-strip'); this.centerIn = $('.lx-center-in'); this.boardEl = $('.lx-board');
    this.placeEl = { top: $('.lx-top'), head: $('.lx-head'), bottom: $('.lx-dock') };
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
    this.buildControls();
    this.frame.addEventListener('pointerdown', function (ev) { self.onPress(ev); }, true);
    this.ro = new ResizeObserver(function () { self.fit(); });
    this.ro.observe(this.room); this.ro.observe(this.canvas); this.ro.observe(this.stage);
    this.fit();
  };

  // The controls the workflow lays out, each a stage theme component in
  // its place; the player gives each what it needs by the interfaces it
  // implements, and listens to what they report.
  Player.prototype.buildControls = function () {
    var self = this, st = this.wf.stage || {};
    PLACES.forEach(function (place) {
      arr(st[place]).forEach(function (id) {
        var def = LessonComponents.get(id);
        var host = document.createElement('div');
        host.className = 'lx-ctl'; host.setAttribute('data-ctl', id);
        if (def.interfaces.indexOf('narrate') >= 0) host.classList.add('lx-grow');
        self.placeEl[place].appendChild(host);
        var input = Object.assign({}, (st.inputs || {})[id]);
        def.interfaces.forEach(function (i) { Object.assign(input, self.controlInput(i)); });
        var c = def.create(host, input, { sound: self.sound });
        def.interfaces.forEach(function (i) { self.ctl[i] = c; });
        c.on(function (ev) { self.onControl(ev); });
      });
    });
    this.bar = this.ctl.narrate;
  };
  Player.prototype.controlInput = function (iface) {
    var q = this.q, book = arr(this.opts.book), me = book.filter(function (b) { return b.id === q.id; })[0] || {};
    if (iface === 'narrate') return { lines: this.lines, portrait: this.opts.portrait };
    if (iface === 'questions') return { items: book, current: q.id };
    if (iface === 'title') return { no: me.no, title: q.title, text: q.prompt && q.prompt.text, gloss: q.prompt && q.prompt.gloss };
    if (iface === 'parts') return { items: this.partItems(), current: 0 };
    return {};
  };
  Player.prototype.onControl = function (ev) {
    var n = ev.name;
    if (n === 'leave.press') { this.trace('nav', '关闭，回到书本'); if (this.opts.onLeave) this.opts.onLeave(); return; }
    if (n === 'back.press') { this.back(); return; }
    if (n === 'forward.press') { this.forward(); return; }
    if (n === 'restart.press') { this.restart(); return; }
    if (n === 'questions.pick') { this.trace('nav', '换一道题：' + ev.id); if (this.opts.onPick) this.opts.onPick(ev.id); return; }
    if (n === 'parts.pick') { this.jumpSegment(ev.index); return; }
    if (n.indexOf('narrate.') === 0) this.trace('bar', n.slice(8) + (ev.id ? ' ' + ev.id : '') + (ev.value ? ' ' + ev.value : ''));
  };

  // A touch on anything that can be pressed (whatever shows the pointing
  // hand) gives the player's soft press sound.
  Player.prototype.onPress = function (ev) {
    var t = ev.target;
    if (t.closest('[disabled]')) return;
    if (getComputedStyle(t).cursor === 'pointer' && this.sound && this.sound.tap) this.sound.tap();
  };

  // Fits the middle: picks the board beside it on a wide screen or on top
  // on a narrow one, sets the column width, keeps the strip's material
  // short, then scales the canvas evenly so the strip and the centre show
  // at once, the centre in the middle of the room left under the strip.
  // It runs whenever anything changes size, frame by frame while a role
  // glides or the title unfolds, so the scale follows smoothly. Widths
  // depend only on the screen; when they change, the roles are laid out
  // again at the new width.
  Player.prototype.fit = function () {
    if (this.destroyed || !this.room) return;
    var wide = this.stage.clientWidth >= WIDE_MIN && this.stage.clientWidth >= this.stage.clientHeight * WIDE_RATIO;
    var cols = wide ? 2 : 1;
    if (cols !== this.cols || !this.body.getAttribute('data-ready')) { this.cols = cols; this.body.setAttribute('data-cols', String(cols)); this.body.setAttribute('data-ready', '1'); }
    var aw = this.room.clientWidth, ah = this.room.clientHeight, c = this.canvas;
    if (!aw || !ah) return;
    var w = Math.round(Math.min(COL_MAX, aw));
    if (w !== this.colW) {
      var again = this.colW !== undefined && Math.abs(w - this.colW) > 2;
      this.colW = w; c.style.width = w + 'px';
      if (again) this.relayoutSoon();
    }
    this.fitStrip(ah);
    var strip = this.stripEl.offsetHeight;
    var h = strip + (strip ? ROW_GAP : 0) + this.centerIn.offsetHeight;
    var s = Math.min(1, ah / Math.max(1, h), aw / w);
    c.style.minHeight = (ah / s).toFixed(1) + 'px';
    c.style.transform = 'translate(' + ((aw - w * s) / 2).toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')';
    this.scale = s;
  };
  // The material in the strip is drawn narrower when it would be taller
  // than its share of the middle, so a long material stays a small picture
  // of the question and leaves the room to the scene's roles.
  Player.prototype.fitStrip = function (ah) {
    var r = this.stripEl.querySelector('.lx-role:not([hidden])');
    if (!r) return;
    var cap = Math.max(STRIP_MIN_H, Math.min(STRIP_MAX_H, ah * STRIP_SHARE)), rw = r.offsetWidth, rh = r.offsetHeight;
    if (!rw || !rh) return;
    var want = Math.round(Math.max(STRIP_MIN, Math.min(STRIP_MAX, rw * cap / rh)));
    if (rh > cap + 2 || (rh < cap - 8 && rw < STRIP_MAX - 2)) {
      if (Math.abs(want - rw) > 2) this.stripEl.style.setProperty('--lx-strip-w', want + 'px');
    }
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
  // lets it. Where it cannot, the stage still fills the whole window.
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

  /* ---------- where the child may go ---------- */

  // The segments the part switch shows: reading the question (the opening
  // scene's title), then each part by its tag.
  Player.prototype.partItems = function () {
    var self = this, out = [];
    arr(this.wf.player.opening).slice(0, 1).forEach(function (name) { out.push({ label: self.wf.scenes[name].title }); });
    (this.q.parts || []).forEach(function (p, pi) { out.push({ label: p.tag || String(pi + 1) }); });
    return out;
  };
  Player.prototype.opens = function () { return arr(this.wf.player.opening).length ? 1 : 0; };
  Player.prototype.segmentOf = function (g) { var sc = this.plan[g]; return sc.opening ? 0 : sc.pi + this.opens(); };
  Player.prototype.firstOfSegment = function (i) {
    if (this.opens() && i === 0) return 0;
    var pi = i - this.opens();
    for (var g = 0; g < this.plan.length; g++) if (!this.plan[g].opening && this.plan[g].pi === pi) return g;
    return 0;
  };
  Player.prototype.skippable = function (g) { return !!this.wf.player.skip && this.plan[g].def.skip !== false; };
  // The child may leave scene g forward once it has been done, or when
  // it may be skipped and is not waiting for the child's answer.
  Player.prototype.canLeave = function (g) {
    if (this.done[g]) return true;
    return this.skippable(g) && !(this.waiting && this.cursor && this.cursor.g === g);
  };
  // Whether the child may go from scene a to scene b: back when the
  // workflow allows it; on only past scenes that are done or skippable.
  Player.prototype.canGo = function (a, b) {
    if (b === a) return true;
    if (b < a) return !!this.wf.player.back;
    for (var k = a; k < b; k++) if (k === a ? !this.canLeave(k) : !(this.done[k] || this.skippable(k))) return false;
    return true;
  };

  // Tells the controls where the child may go now: 下一幕 glows when a
  // scene has ended and is not there after the last one; replay comes in
  // once the lecture has been heard to the end.
  Player.prototype.updateNav = function () {
    var self = this, c = this.cursor; if (!c) return;
    var g = c.g, isLast = g >= this.plan.length - 1, ended = c.phase === 'end';
    if (this.ctl.forward) this.ctl.forward.call('forward.set', { enabled: ended ? !isLast : this.canLeave(g), ready: ended && !isLast, shown: !(ended && isLast) });
    if (this.ctl.back) this.ctl.back.call('back.set', { enabled: !!this.wf.player.back && g > 0 });
    if (this.ctl.restart) this.ctl.restart.call('restart.set', { shown: this.finished });
    if (this.ctl.parts) {
      var cur = this.segmentOf(g);
      this.ctl.parts.call('parts.set', { current: cur, items: this.partItems().map(function (it, i) { return Object.assign(it, { enabled: i === cur || self.canGo(g, self.firstOfSegment(i)) }); }) });
    }
  };
  Player.prototype.forward = function () {
    var c = this.cursor; if (!c) return;
    if (c.phase === 'end') { if (this.resolveNext) { var r = this.resolveNext; this.resolveNext = null; r(); } return; }
    if (!this.canLeave(c.g)) return;
    this.trace('nav', '跳过这一幕：' + this.plan[c.g].def.title);
    this.go(c.g, 'skip');
  };
  Player.prototype.back = function () {
    var c = this.cursor; if (!c || c.g === 0 || !this.wf.player.back) return;
    this.trace('nav', '回到上一幕：' + this.plan[c.g - 1].def.title);
    this.go(c.g - 1, 'back');
  };
  Player.prototype.jumpSegment = function (i) {
    var c = this.cursor, t = this.firstOfSegment(i); if (!c || !this.canGo(c.g, t)) return;
    this.trace('nav', '换到：' + this.partItems()[i].label);
    this.go(t, this.snap[t] ? 'back' : 'jump');
  };
  // A conclusion tapped on the board: back to the scene it was reached in.
  Player.prototype.toConclusion = function (id) {
    var g = this.concludedAt[id], c = this.cursor;
    if (g === undefined || !c || !this.canGo(c.g, g)) return;
    this.trace('nav', '点了结论，回到它的那一幕：' + this.plan[g].def.title);
    this.go(g, 'back');
  };
  Player.prototype.restart = function () {
    this.trace('nav', '从头再讲一遍');
    this.finished = false; this.done = {};
    this.go(0, this.snap[0] ? 'back' : 'jump');
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
      var def = LessonComponents.get(binding);
      var a = def.create(host, input || {}, { sound: self.sound, moveMs: MOVE_MS, swap: function (fn) { return self.swapRole(role, fn); } });
      a.binding = binding; a.interfaces = def.interfaces;
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

  // Puts on stage what a scene names: centre roles it names come in
  // (rising into place), centre roles it does not name leave (fading where
  // they were), a strip role it names steps from the strip to the centre
  // and back after; roles that stay glide from where they were to where
  // they are now, and the canvas's scale glides with them. The title
  // unfolds the question's text in the scenes that ask for it. Centre
  // roles can be touched only while an act waits on them.
  Player.prototype.compose = function (sc, animated) {
    var self = this, wf = this.wf, want = arr(sc.def.stage), move = animated && !still();
    if (this.ctl.title) this.ctl.title.call('title.set', { open: sc.def.prompt === 'open' });
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
  // scene remembers the last role it acted on other than the stack: that
  // is where its conclusion comes from.
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
  // on; the stack flies it up from that role's place on screen. The
  // player remembers the scene, so a tap on the conclusion leads back.
  Player.prototype.conclude = function (s, sc, token) {
    var key = this.value(s.conclude, sc), id = this.conclusionId(key, sc);
    if (!id) { if (s.optional) return Promise.resolve(); throw new Error('没有结论 ' + key); }
    this.concludedAt[id] = sc.g;
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
    if (ev.name === 'conclude.tap') { this.toConclusion(ev.id); return; }
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
    this.setupPart(0, 'still');
    this.enter();
    this.go(0, 'start');
  };

  // At the start the parts of the stage rise in one after another.
  Player.prototype.enter = function () {
    if (still()) return;
    var order = 0;
    [this.placeEl.top, this.boardEl, this.placeEl.head].concat([].slice.call(this.canvas.querySelectorAll('.lx-role:not([hidden])')), [this.placeEl.bottom]).forEach(function (el) {
      el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: MOVE_MS, delay: order++ * ENTER_STAGGER, easing: EASE, fill: 'backwards' });
    });
  };

  // Moves to scene g and runs from there. how: 'start' and 'next' play it
  // in turn (a new part sets up its components and clears the stack as
  // the workflow says); 'back' (and a jump to a scene seen before) sets
  // the stage straight to how that scene began; 'jump' to a part not seen
  // yet sets up that part afresh; 'skip' sets the scene back to its start
  // and runs it in a hurry, without narration and with every mark drawn at
  // once, then goes on to the next.
  Player.prototype.go = function (g, how) {
    var self = this, sc = this.plan[g];
    if (this.token) this.token.abort();
    this.stopAll();
    this.bar.flag(null);
    var token = this.token = this.newToken(how === 'skip');
    var prev = this.cursor;
    this.cursor = { g: g, phase: 'run' };
    if (how === 'back' || (how === 'skip' && this.snap[g])) this.restore(this.snap[g], sc);
    else {
      var stack = this.inst[this.stackRole];
      if (this.mounted !== sc.pi) {
        if (this.wf.player.partEnd === 'clear-stack' && stack && stack.getState().order.length) this.swapRole(this.stackRole, function () { stack.call('conclude.set', []); });
        this.bar.set({});
        this.setupPart(sc.pi, 'swap');
      }
      this.compose(sc, how !== 'start');
    }
    if (!this.snap[g]) this.snap[g] = this.snapshot();
    this.updateNav();
    var pause = how === 'start' || (prev && this.plan[prev.g] && this.plan[prev.g].pi !== sc.pi) ? (still() ? 0 : MOVE_MS + FADE_IN_DELAY) : 0;
    this.guard(sleep(token.hurry ? 0 : pause), token).then(function () { return self.runScene(sc, token); }).then(function () {
      self.done[g] = true;
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

  // The end of the lecture: the subtitle says so and the replay control
  // comes in. The stage stays as it is; the close control leads back to
  // the book.
  Player.prototype.finish = function () {
    this.finished = true;
    this.bar.flag('讲完了');
    this.updateNav();
    this.trace('done', '这道讲题讲完了');
  };

  Player.prototype.destroy = function () {
    this.destroyed = true;
    if (this.ro) this.ro.disconnect();
    clearTimeout(this.relayoutTimer);
    if (this.token) this.token.abort();
    if (this.bar) this.stopAll();
    Object.keys(this.ctl).forEach(function (i) { this.ctl[i].stop(); }, this);
  };

  return Player;
})();
