/* ============================================================
   Question menu. A glass button (stage-glass) with a list icon; pressing
   it drops a list of the book's questions, the current one marked, each
   with its number. Picking one asks for that question; a touch outside
   the list or Esc closes it.

   The list hangs under the button, inside the component: from the
   button's right edge when the button is in the right half of the
   screen, from its left edge otherwise, nudged sideways to stay on
   screen, and it scrolls when there is not room below for every
   question. What it lies over is up to where the component is placed:
   it covers what is painted before it.

   Inputs: items [{id, no, title}], current (an id).
   Interface: questions. Commands: questions.set {items, current}.
   Events: questions.pick {id}.
   ============================================================ */
(function () {
  var CSS = [
    '.st-qm{position:relative;flex:none}',
    '.st-qm-btn{width:auto;min-width:64px;padding:0 10px 0 14px;border-radius:26px;grid-auto-flow:column;gap:2px}',
    '.st-qm-btn svg + svg{width:18px;height:18px;opacity:.75;transition:transform .26s var(--st-ease)}',
    '.st-qm-btn[aria-expanded="true"] svg + svg{transform:rotate(180deg)}',
    '.st-qm-pop{position:absolute;left:0;top:calc(100% + 8px);z-index:1;color:var(--st-text);overflow-y:auto;overscroll-behavior:contain;transform-origin:22px 0}',
    '.st-qm-pop.st-qm-end{left:auto;right:0;transform-origin:calc(100% - 22px) 0}',
    '.st-qm-pop[hidden]{display:none}',
    '.st-qm-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  ].join('');
  // The list keeps this far from the screen's edges.
  var MARGIN = 16;
  // Below this height the list scrolls rather than shrinking further.
  var MIN_HEIGHT = 120;
  var OPEN_MS = 240, CLOSE_MS = 160;

  function Menu(host, input) {
    LessonComponents.Base.call(this);
    StageGlass.ui(host);
    if (!document.getElementById('st-qm-style')) { var s = document.createElement('style'); s.id = 'st-qm-style'; s.textContent = CSS; document.head.appendChild(s); }
    var self = this;
    this.st = { items: (input && input.items) || [], current: input && input.current };
    this.isOpen = false;
    var root = document.createElement('div');
    root.className = 'st-qm';
    root.innerHTML = '<button type="button" class="st-btn st-glass st-qm-btn" aria-haspopup="true" aria-expanded="false" aria-label="换一道题">' + StageGlass.icon('list') + StageGlass.icon('down') + '</button>' +
      '<div class="st-pop st-glass st-qm-pop" role="menu" hidden></div>';
    host.appendChild(root);
    this.root = root; this.btn = root.querySelector('button'); this.pop = root.querySelector('.st-qm-pop');
    this.btn.addEventListener('click', function () { self.open(!self.isOpen); });
    this.pop.addEventListener('click', function (e) {
      var r = e.target.closest('[data-id]'); if (!r) return;
      self.open(false);
      var id = r.getAttribute('data-id');
      if (id !== String(self.st.current)) self.emit({ name: 'questions.pick', id: id });
    });
    this.outside = function (e) { if (self.isOpen && !root.contains(e.target)) self.open(false); };
    this.key = function (e) { if (e.key === 'Escape' && self.isOpen) { self.open(false); self.btn.focus(); } };
    this.resize = function () { if (self.isOpen) self.place(); };
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.key);
    window.addEventListener('resize', this.resize);
    this.render();
  }
  Menu.prototype = Object.create(LessonComponents.Base.prototype);
  Menu.prototype.render = function () {
    var cur = String(this.st.current);
    this.pop.innerHTML = this.st.items.map(function (q) {
      return '<button type="button" class="st-row" role="menuitem" data-id="' + StageGlass.esc(q.id) + '"' + (String(q.id) === cur ? ' aria-current="true"' : '') + '>' +
        '<span class="st-no">' + StageGlass.esc(q.no) + '</span><span class="st-qm-title">' + StageGlass.esc(q.title) + '</span></button>';
    }).join('');
    this.btn.disabled = this.st.items.length < 2;
  };
  // Hangs the open list from the side of the button with room, shifted
  // sideways onto the screen, its height capped to the room below.
  Menu.prototype.place = function () {
    var pop = this.pop, s = pop.style;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var r = this.btn.getBoundingClientRect();
    pop.classList.toggle('st-qm-end', r.left + r.width / 2 > vw / 2);
    s.maxHeight = ''; s.translate = '';
    var p = pop.getBoundingClientRect();
    var dx = p.left < MARGIN ? MARGIN - p.left : p.right > vw - MARGIN ? vw - MARGIN - p.right : 0;
    if (dx) s.translate = dx.toFixed(1) + 'px 0';
    var room = vh - p.top - MARGIN;
    if (p.height > room) s.maxHeight = Math.max(MIN_HEIGHT, room) + 'px';
  };
  // Opens with a short drop and closes with a short lift; with reduced
  // motion it opens and closes at once.
  Menu.prototype.open = function (on) {
    on = !!on;
    if (on === this.isOpen) return;
    this.isOpen = on;
    var pop = this.pop, still = StageGlass.still();
    this.btn.setAttribute('aria-expanded', String(on));
    if (this.anim) { this.anim.cancel(); this.anim = null; }
    if (on) {
      pop.hidden = false;
      this.place();
      if (!still) pop.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: OPEN_MS, easing: 'cubic-bezier(.6, 0, .25, 1)' });
      var c = pop.querySelector('[aria-current="true"]') || pop.querySelector('.st-row');
      if (c) c.focus({ preventScroll: true });
      return;
    }
    if (still || pop.hidden) { pop.hidden = true; return; }
    var self = this;
    this.anim = pop.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(.97)' }], { duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards' });
    this.anim.onfinish = function () { self.anim = null; if (!self.isOpen) pop.hidden = true; };
  };
  Menu.prototype.call = function (name, v) {
    if (name !== 'questions.set') throw new Error('question-menu: ' + name);
    Object.assign(this.st, v || {});
    this.render();
    if (this.isOpen) this.place();
  };
  Menu.prototype.getState = function () { return { current: this.st.current }; };
  Menu.prototype.setState = function (s) { if (s && 'current' in s) { this.st.current = s.current; this.render(); } };
  Menu.prototype.stop = function () {
    this.isOpen = false;
    this.btn.setAttribute('aria-expanded', 'false');
    if (this.anim) { this.anim.cancel(); this.anim = null; }
    this.pop.hidden = true;
  };

  LessonComponents.register('question-menu', {
    interfaces: ['questions'],
    create: function (host, input) { return new Menu(host, input); }
  });
})();
