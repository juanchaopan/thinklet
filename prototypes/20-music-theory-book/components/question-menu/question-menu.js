/* ============================================================
   Question menu. A glass button (stage-glass) with a list icon; pressing
   it drops a list of the book's questions, the current one marked, each
   with its number. Picking one asks for that question; a touch outside
   the list or Esc closes it.

   The list is a popover, so it opens on the browser's top layer, over
   everything on the page whatever region or stacking order its button
   is in, and nothing clips it. It hangs under the button toward the side
   of the screen that has room: from the button's right edge when the
   button is in the right half of the viewport, from its left edge
   otherwise. It is then nudged so it stays inside the viewport, and it
   scrolls when there is not room below for every question.

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
    '.st-qm-pop{position:fixed;inset:auto;margin:0;border:0;color:var(--st-text);overflow-y:auto;overscroll-behavior:contain;transform-origin:22px 0}',
    '.st-qm-pop.st-qm-end{transform-origin:calc(100% - 22px) 0}',
    '.st-qm-pop:not(:popover-open){display:none}',
    '.st-qm-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  ].join('');
  // The list keeps this far from the viewport's edges.
  var MARGIN = 16;
  // The list's gap under the button.
  var GAP = 8;
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
      '<div class="st-pop st-glass st-qm-pop" role="menu" popover="manual"></div>';
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
  // Hangs the open list under the button on the side with room, shifted
  // sideways into the viewport, its height capped to the room below.
  Menu.prototype.place = function () {
    var pop = this.pop, s = pop.style;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var r = this.btn.getBoundingClientRect();
    var end = r.left + r.width / 2 > vw / 2;
    pop.classList.toggle('st-qm-end', end);
    s.maxHeight = '';
    var w = pop.offsetWidth;
    var x = end ? r.right - w : r.left;
    s.left = Math.max(MARGIN, Math.min(x, vw - MARGIN - w)) + 'px';
    s.top = (r.bottom + GAP) + 'px';
    var room = vh - (r.bottom + GAP) - MARGIN;
    if (pop.offsetHeight > room) s.maxHeight = Math.max(MIN_HEIGHT, room) + 'px';
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
      if (!pop.matches(':popover-open')) pop.showPopover();
      this.place();
      if (!still) pop.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: OPEN_MS, easing: 'cubic-bezier(.6, 0, .25, 1)' });
      var c = pop.querySelector('[aria-current="true"]') || pop.querySelector('.st-row');
      if (c) c.focus({ preventScroll: true });
      return;
    }
    if (still || !pop.matches(':popover-open')) { if (pop.matches(':popover-open')) pop.hidePopover(); return; }
    var self = this;
    this.anim = pop.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(.97)' }], { duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards' });
    this.anim.onfinish = function () { self.anim = null; if (!self.isOpen && pop.matches(':popover-open')) pop.hidePopover(); };
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
    if (this.pop.matches(':popover-open')) this.pop.hidePopover();
  };

  LessonComponents.register('question-menu', {
    interfaces: ['questions'],
    create: function (host, input) { return new Menu(host, input); }
  });
})();
