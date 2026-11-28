/* ============================================================
   Part switch. A glass bar (stage-glass) of short labels, one per part
   of the question as the workflow divides it (reading the question,
   (a), (b), (c)...); the current part sits in a violet disc that glides
   to the part picked. A part the child may not go to yet is dimmed and
   cannot be pressed. With one part or none it is not shown.
   Interface: parts. Commands: parts.set {items: [{label, enabled}],
   current}. Events: parts.pick {index}.
   ============================================================ */
(function () {
  var CSS = [
    '.st-ps{position:relative;flex:none;display:flex;align-items:center;gap:2px;height:52px;padding:0 5px;border-radius:26px;box-sizing:border-box}',
    '.st-ps[hidden]{display:none}',
    '.st-ps-dot{position:absolute;top:5px;left:0;height:42px;border-radius:21px;background:radial-gradient(circle at 32% 26%,var(--st-btn-hi),var(--st-btn));box-shadow:0 8px 18px -8px var(--st-btn);transition:transform .52s var(--st-ease),width .52s var(--st-ease);pointer-events:none}',
    '.st-ps-dot.st-still{transition:none}',
    '.st-ps-seg{appearance:none;border:0;margin:0;font:inherit;color:var(--st-soft);background:transparent;cursor:pointer;position:relative;z-index:1;flex:none;min-width:44px;height:42px;padding:0 10px;border-radius:21px;',
    'font-size:15px;font-weight:800;white-space:nowrap;transition:color .3s,opacity .3s,background .2s}',
    '.st-ps-seg:hover:not([disabled]):not([aria-current="true"]){background:var(--st-hover);color:var(--st-text)}',
    '.st-ps-seg[aria-current="true"]{color:var(--th-light);cursor:default}',
    '.st-ps-seg[disabled]{opacity:.38;cursor:default}',
    '.st-ps-seg:focus{outline:none}.st-ps-seg:focus-visible{outline:2px solid var(--st-glow);outline-offset:-2px}',
    '.st-ps-seg .st-tag{font-family:"Cormorant Garamond","Times New Roman",serif;font-style:italic;font-size:19px;font-weight:600}',
    '@media (max-width:600px){.st-ps{height:46px;padding:0 3px}.st-ps-dot{top:3px;height:40px}.st-ps-seg{min-width:40px;height:40px;padding:0 8px;font-size:14px}}'
  ].join('');

  function Switch(host, input) {
    LessonComponents.Base.call(this);
    StageGlass.ui(host);
    if (!document.getElementById('st-ps-style')) { var s = document.createElement('style'); s.id = 'st-ps-style'; s.textContent = CSS; document.head.appendChild(s); }
    var self = this;
    this.st = { items: [], current: 0 };
    var root = document.createElement('div');
    root.className = 'st-ps st-glass'; root.setAttribute('role', 'tablist'); root.setAttribute('aria-label', '小题');
    root.innerHTML = '<i class="st-ps-dot st-still" aria-hidden="true"></i>';
    host.appendChild(root);
    this.root = root; this.dot = root.querySelector('.st-ps-dot');
    root.addEventListener('click', function (e) {
      var b = e.target.closest('.st-ps-seg'); if (!b || b.disabled) return;
      var i = Number(b.getAttribute('data-i'));
      if (i !== self.st.current) self.emit({ name: 'parts.pick', index: i });
    });
    root.addEventListener('keydown', function (e) {
      var d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!d) return;
      var segs = [].slice.call(root.querySelectorAll('.st-ps-seg:not([disabled])')), i = segs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      segs[Math.max(0, Math.min(segs.length - 1, i + d))].focus();
    });
    if (window.ResizeObserver) new ResizeObserver(function () { self.place(false); }).observe(root);
    this.call('parts.set', input || {});
  }
  Switch.prototype = Object.create(LessonComponents.Base.prototype);
  // Words that read like a tag, such as (a), are set in the serif italic.
  function label(t) { t = String(t); return /^\(?[a-z0-9]+\)?$/i.test(t) ? '<span class="st-tag">' + StageGlass.esc(t) + '</span>' : StageGlass.esc(t); }
  Switch.prototype.render = function () {
    var self = this, items = this.st.items;
    var key = items.map(function (it) { return it.label; }).join('|');
    if (key !== this.key) {
      this.key = key;
      [].slice.call(this.root.querySelectorAll('.st-ps-seg')).forEach(function (b) { b.remove(); });
      items.forEach(function (it, i) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'st-ps-seg'; b.setAttribute('role', 'tab'); b.setAttribute('data-i', String(i));
        b.innerHTML = label(it.label);
        self.root.appendChild(b);
      });
    }
    [].slice.call(this.root.querySelectorAll('.st-ps-seg')).forEach(function (b, i) {
      var cur = i === self.st.current;
      b.setAttribute('aria-current', String(cur)); b.setAttribute('aria-selected', String(cur));
      b.disabled = !cur && items[i].enabled === false;
    });
    this.root.hidden = items.length < 2;
  };
  // The violet disc under the current part; it glides when the part changes.
  Switch.prototype.place = function (animated) {
    var b = this.root.querySelector('.st-ps-seg[aria-current="true"]'); if (!b) return;
    this.dot.classList.toggle('st-still', !animated);
    this.dot.style.width = b.offsetWidth + 'px';
    this.dot.style.transform = 'translateX(' + b.offsetLeft + 'px)';
  };
  Switch.prototype.call = function (name, v) {
    if (name !== 'parts.set') throw new Error('part-switch: ' + name);
    var moved = v && 'current' in v && v.current !== this.st.current;
    Object.assign(this.st, v || {});
    this.render();
    this.place(!!moved && this.placed);
    this.placed = true;
  };
  Switch.prototype.getState = function () { return LessonComponents.util.clone(this.st); };
  Switch.prototype.setState = function (s) { Object.assign(this.st, s || {}); this.render(); this.place(false); };

  LessonComponents.register('part-switch', {
    interfaces: ['parts'],
    create: function (host, input) { return new Switch(host, input); }
  });
})();
