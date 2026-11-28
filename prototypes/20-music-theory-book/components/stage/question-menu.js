/* ============================================================
   Question menu (stage theme). A glass button with a list icon; pressing
   it drops a list of the book's questions, the current one marked, each
   with its number. Picking one asks for that question; a touch outside
   the list or Esc closes it.
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
    '.st-qm .st-pop{top:calc(100% + 8px);left:0}',
    '.st-qm-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  ].join('');

  function Menu(host, input) {
    LessonComponents.Base.call(this);
    StageTheme.inject();
    if (!document.getElementById('st-qm-style')) { var s = document.createElement('style'); s.id = 'st-qm-style'; s.textContent = CSS; document.head.appendChild(s); }
    var self = this;
    this.st = { items: (input && input.items) || [], current: input && input.current };
    host.classList.add('st-ui');
    var root = document.createElement('div');
    root.className = 'st-qm';
    root.innerHTML = '<button type="button" class="st-btn st-glass st-qm-btn" aria-haspopup="true" aria-expanded="false" aria-label="换一道题">' + StageTheme.icon('list') + StageTheme.icon('down') + '</button>' +
      '<div class="st-pop st-glass" role="menu" hidden></div>';
    host.appendChild(root);
    this.root = root; this.btn = root.querySelector('button'); this.pop = root.querySelector('.st-pop');
    this.btn.addEventListener('click', function () { self.open(self.pop.hidden); });
    this.pop.addEventListener('click', function (e) {
      var r = e.target.closest('[data-id]'); if (!r) return;
      self.open(false);
      var id = r.getAttribute('data-id');
      if (id !== String(self.st.current)) self.emit({ name: 'questions.pick', id: id });
    });
    this.outside = function (e) { if (!self.pop.hidden && !root.contains(e.target)) self.open(false); };
    this.key = function (e) { if (e.key === 'Escape' && !self.pop.hidden) { self.open(false); self.btn.focus(); } };
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.key);
    this.render();
  }
  Menu.prototype = Object.create(LessonComponents.Base.prototype);
  Menu.prototype.render = function () {
    var cur = String(this.st.current);
    this.pop.innerHTML = this.st.items.map(function (q) {
      return '<button type="button" class="st-row" role="menuitem" data-id="' + StageTheme.esc(q.id) + '"' + (String(q.id) === cur ? ' aria-current="true"' : '') + '>' +
        '<span class="st-no">' + StageTheme.esc(q.no) + '</span><span class="st-qm-title">' + StageTheme.esc(q.title) + '</span></button>';
    }).join('');
    this.btn.disabled = this.st.items.length < 2;
  };
  Menu.prototype.open = function (on) {
    this.pop.hidden = !on;
    this.btn.setAttribute('aria-expanded', String(!!on));
    if (on) { var c = this.pop.querySelector('[aria-current="true"]') || this.pop.querySelector('.st-row'); if (c) c.focus({ preventScroll: true }); }
  };
  Menu.prototype.call = function (name, v) {
    if (name !== 'questions.set') throw new Error('question-menu: ' + name);
    Object.assign(this.st, v || {});
    this.render();
  };
  Menu.prototype.getState = function () { return { current: this.st.current }; };
  Menu.prototype.setState = function (s) { if (s && 'current' in s) { this.st.current = s.current; this.render(); } };
  Menu.prototype.stop = function () { this.open(false); };

  LessonComponents.register('question-menu', {
    theme: 'stage', interfaces: ['questions'],
    create: function (host, input) { return new Menu(host, input); }
  });
})();
