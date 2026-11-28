/* ============================================================
   Part switch. A glass bar (stage-glass) of short labels, one per part
   of the question as the workflow divides it (reading the question,
   (a), (b), (c)...); the current part sits in a violet disc that glides
   to the part picked. A part the child may not go to yet is dimmed and
   cannot be pressed. With one part or none it is not shown.

   When its labels need more width than it is given, the bar keeps that
   width and its row of labels slides inside it: the current part comes
   to the middle (as near as the row's ends allow), and an end with
   labels beyond it fades out. The child can swipe the row along; a
   swipe does not press a label. The row moves with a transform (nothing
   scrolls), in the stage's easing, at once under reduced motion.

   Interface: parts. Commands: parts.set {items: [{label, enabled}],
   current}. Events: parts.pick {index}.
   ============================================================ */
(function () {
  // A label's fade at an end of the bar with more labels beyond it.
  var FADE = 28;
  // How far a press must move before it is a swipe.
  var DRAG_PX = 6;
  var CSS = [
    '.st-ps{position:relative;flex:0 1 auto;min-width:0;max-width:100%;display:flex;height:52px;border-radius:26px;box-sizing:border-box;overflow:hidden;overflow:clip;touch-action:pan-y}',
    '.st-ps[hidden]{display:none}',
    '.st-ps.st-ps-cut-start{-webkit-mask-image:linear-gradient(90deg,transparent,#000 ' + FADE + 'px);mask-image:linear-gradient(90deg,transparent,#000 ' + FADE + 'px)}',
    '.st-ps.st-ps-cut-end{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - ' + FADE + 'px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - ' + FADE + 'px),transparent)}',
    '.st-ps.st-ps-cut-start.st-ps-cut-end{-webkit-mask-image:linear-gradient(90deg,transparent,#000 ' + FADE + 'px,#000 calc(100% - ' + FADE + 'px),transparent);mask-image:linear-gradient(90deg,transparent,#000 ' + FADE + 'px,#000 calc(100% - ' + FADE + 'px),transparent)}',
    '.st-ps-row{position:relative;flex:none;display:flex;align-items:center;gap:2px;padding:0 5px;transition:transform .52s var(--st-ease)}',
    '.st-ps-row.st-still{transition:none}',
    '.st-ps-dot{position:absolute;top:5px;left:0;height:42px;border-radius:21px;background:radial-gradient(circle at 32% 26%,var(--st-btn-hi),var(--st-btn));box-shadow:0 8px 18px -8px var(--st-btn);transition:transform .52s var(--st-ease),width .52s var(--st-ease);pointer-events:none}',
    '.st-ps-dot.st-still{transition:none}',
    '.st-ps-seg{appearance:none;border:0;margin:0;font:inherit;color:var(--st-soft);background:transparent;cursor:pointer;position:relative;z-index:1;flex:none;min-width:44px;height:42px;padding:0 10px;border-radius:21px;',
    'font-size:15px;font-weight:800;white-space:nowrap;transition:color .3s,opacity .3s,background .2s}',
    '.st-ps-seg:hover:not([disabled]):not([aria-current="true"]){background:var(--st-hover);color:var(--st-text)}',
    '.st-ps-seg[aria-current="true"]{color:var(--th-light);cursor:default}',
    '.st-ps-seg[disabled]{opacity:.38;cursor:default}',
    '.st-ps-seg:focus{outline:none}.st-ps-seg:focus-visible{outline:2px solid var(--st-glow);outline-offset:-2px}',
    '.st-ps-seg .st-tag{font-family:"Cormorant Garamond","Times New Roman",serif;font-style:italic;font-size:19px;font-weight:600}',
    '@media (max-width:600px){.st-ps{height:46px}.st-ps-row{padding:0 3px}.st-ps-dot{top:3px;height:40px}.st-ps-seg{min-width:44px;height:40px;padding:0 8px;font-size:14px}}'
  ].join('');

  function Switch(host, input) {
    LessonComponents.Base.call(this);
    StageGlass.ui(host);
    if (!document.getElementById('st-ps-style')) { var s = document.createElement('style'); s.id = 'st-ps-style'; s.textContent = CSS; document.head.appendChild(s); }
    var self = this;
    this.st = { items: [], current: 0 };
    this.x = 0;
    var root = document.createElement('div');
    root.className = 'st-ps st-glass'; root.setAttribute('role', 'tablist'); root.setAttribute('aria-label', '小题');
    root.innerHTML = '<div class="st-ps-row st-still"><i class="st-ps-dot st-still" aria-hidden="true"></i></div>';
    host.appendChild(root);
    this.root = root; this.row = root.querySelector('.st-ps-row'); this.dot = root.querySelector('.st-ps-dot');
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
    // A label reached by the keyboard comes into view.
    root.addEventListener('focusin', function (e) { var b = e.target.closest('.st-ps-seg'); if (b && !self.pressing) self.slide(b, true); });
    this.bindSwipe();
    if (window.ResizeObserver) {
      var w = -1, rw = -1;
      new ResizeObserver(function () {
        if (root.clientWidth === w && self.row.offsetWidth === rw) return;
        w = root.clientWidth; rw = self.row.offsetWidth;
        self.place(false);
      }).observe(root);
    }
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
      [].slice.call(this.row.querySelectorAll('.st-ps-seg')).forEach(function (b) { b.remove(); });
      items.forEach(function (it, i) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'st-ps-seg'; b.setAttribute('role', 'tab'); b.setAttribute('data-i', String(i));
        b.innerHTML = label(it.label);
        self.row.appendChild(b);
      });
    }
    [].slice.call(this.row.querySelectorAll('.st-ps-seg')).forEach(function (b, i) {
      var cur = i === self.st.current;
      b.setAttribute('aria-current', String(cur)); b.setAttribute('aria-selected', String(cur));
      b.disabled = !cur && items[i].enabled === false;
    });
    this.root.hidden = items.length < 2;
  };

  // How far the row may move left: none when it fits the bar.
  Switch.prototype.room = function () { return Math.min(0, this.root.clientWidth - this.row.offsetWidth); };
  // Moves the row to x (held between its ends) and fades each end that
  // has labels beyond it.
  Switch.prototype.moveTo = function (x, animated) {
    var min = this.room();
    this.x = Math.max(min, Math.min(0, x));
    this.row.classList.toggle('st-still', !animated);
    this.row.style.transform = this.x ? 'translateX(' + this.x.toFixed(1) + 'px)' : '';
    this.root.classList.toggle('st-ps-cut-start', this.x < -.5);
    this.root.classList.toggle('st-ps-cut-end', this.x > min + .5);
  };
  // Brings a label to the middle of the bar, as near as the ends allow.
  Switch.prototype.slide = function (b, animated) {
    this.moveTo(this.root.clientWidth / 2 - (b.offsetLeft + b.offsetWidth / 2), animated);
  };

  // A swipe moves the row with the finger; the click it would end in is
  // swallowed, so a swipe never presses a label.
  Switch.prototype.bindSwipe = function () {
    var self = this, root = this.root, press = null;
    root.addEventListener('pointerdown', function (e) {
      if (e.button > 0 || self.room() >= 0) return;
      self.pressing = true;
      press = { x: e.clientX, y: e.clientY, x0: self.x, id: e.pointerId, drag: false };
    });
    root.addEventListener('pointermove', function (e) {
      if (!press) return;
      var dx = e.clientX - press.x;
      if (!press.drag) {
        if (Math.abs(dx) <= DRAG_PX || Math.abs(dx) < Math.abs(e.clientY - press.y)) return;
        press.drag = true;
        try { root.setPointerCapture(press.id); } catch (err) { /* the pointer is already gone */ }
      }
      e.preventDefault();
      self.moveTo(press.x0 + dx, false);
    });
    function up() {
      var p = press; press = null;
      setTimeout(function () { self.pressing = false; }, 0);
      if (!p || !p.drag) return;
      var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); root.removeEventListener('click', swallow, true); };
      root.addEventListener('click', swallow, true);
      setTimeout(function () { root.removeEventListener('click', swallow, true); }, 0);
    }
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  };

  // The violet disc under the current part, which glides when the part
  // changes, and the row slid so the current part is in the middle.
  Switch.prototype.place = function (animated) {
    var b = this.row.querySelector('.st-ps-seg[aria-current="true"]'); if (!b) return;
    this.dot.classList.toggle('st-still', !animated);
    this.dot.style.width = b.offsetWidth + 'px';
    this.dot.style.transform = 'translateX(' + b.offsetLeft + 'px)';
    this.slide(b, animated);
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
