/* ============================================================
   The stage theme's common part. The stage theme holds the components
   every lecture and practice has whatever the question's own theme is:
   the subtitle, close, previous and next scene, replay, the question
   menu, the part switch and the question's title. They share one look,
   the subtitle's: dark glass that reads on any stage, warm white ink,
   violet light, round icon buttons with no words under them.

   Every colour comes from the theme's constants (--th-<name>, see
   engine/theme.js), set on the stage or the page; the --st-* names below
   are this theme's short aliases for them. Here: the glass, the round
   icon button, the popup list, the number ring, the icons, and the
   theme's motion. Each component adds only what is its own.
   ============================================================ */
var StageTheme = (function () {
  var CSS = [
    '.st-ui{--st-glass:var(--th-glass);--st-glass-hi:var(--th-glass-hi);--st-edge:color-mix(in srgb,var(--th-light) 10%,transparent);',
    '--st-text:var(--th-glass-ink);--st-soft:color-mix(in srgb,var(--th-glass-ink) 66%,transparent);',
    '--st-glow:var(--th-glass-accent);--st-btn:var(--th-button);--st-btn-hi:var(--th-button-hi);',
    // Pale violet ink for numbers and tags: the glass's accent lifted toward light.
    '--st-tint:color-mix(in srgb,var(--th-glass-accent) 30%,var(--th-light));',
    '--st-hover:color-mix(in srgb,var(--th-light) 8%,transparent);--st-mark:color-mix(in srgb,var(--th-glass-accent) 22%,transparent);',
    '--st-ease:cubic-bezier(.6,0,.25,1);',
    'font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;color:var(--st-text);-webkit-tap-highlight-color:transparent}',
    // Dark glass: the subtitle's band, and every control's face.
    '.st-glass{background:var(--st-glass);box-shadow:0 14px 32px -16px color-mix(in srgb,var(--th-glass) 81%,transparent),inset 0 0 0 1px var(--st-edge);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2)}',
    // The round icon button.
    '.st-btn{appearance:none;border:0;margin:0;padding:0;font:inherit;color:var(--st-text);cursor:pointer;position:relative;flex:none;display:grid;place-items:center;width:52px;height:52px;border-radius:50%;',
    'transition:transform .15s,background .3s,box-shadow .3s,opacity .3s,color .3s}',
    '.st-btn:hover:not([disabled]){background:var(--st-glass-hi)}',
    '.st-btn:active:not([disabled]){transform:scale(.94)}',
    '.st-btn:focus{outline:none}.st-btn:focus-visible{outline:2.5px solid var(--st-glow);outline-offset:3px}',
    '.st-btn[disabled]{opacity:.32;cursor:default}',
    '.st-btn svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '.st-btn[hidden]{display:none}',
    // A button calling to be pressed: the product's violet, a ring breathing out.
    '.st-btn.st-ready{background:radial-gradient(circle at 32% 26%,var(--st-btn-hi),var(--st-btn));box-shadow:0 14px 28px -12px var(--st-btn),0 0 0 3px color-mix(in srgb,var(--th-light) 18%,transparent)}',
    '.st-btn.st-ready::after{content:"";position:absolute;inset:-3px;border-radius:inherit;animation:st-ring 2.2s ease-out 1s infinite;pointer-events:none}',
    '@keyframes st-ring{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--th-glass-accent) 60%,transparent)}70%,100%{box-shadow:0 0 0 14px color-mix(in srgb,var(--th-glass-accent) 0%,transparent)}}',
    // Coming in and going out: grows from a little smaller and fades.
    '.st-enter{animation:st-enter .52s var(--st-ease) both}',
    '@keyframes st-enter{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}',
    // A list that drops from a control, closed by a touch outside or Esc.
    '.st-pop{position:absolute;z-index:40;min-width:220px;max-width:min(360px,calc(100vw - 32px));padding:8px;border-radius:18px;transform-origin:22px 0;transition:opacity .2s,transform .26s var(--st-ease)}',
    '.st-pop[hidden]{display:block;opacity:0;transform:translateY(-6px) scale(.97);pointer-events:none;visibility:hidden}',
    '.st-pop .st-row{appearance:none;border:0;margin:0;font:inherit;color:var(--st-text);background:transparent;cursor:pointer;display:flex;width:100%;align-items:center;gap:10px;min-height:46px;padding:0 12px;border-radius:12px;font-size:15px;text-align:left}',
    '.st-pop .st-row:hover{background:var(--st-hover)}',
    '.st-pop .st-row[aria-current="true"]{background:var(--st-mark);font-weight:800}',
    '.st-pop .st-row:focus{outline:none}.st-pop .st-row:focus-visible{outline:2px solid var(--st-glow);outline-offset:-2px}',
    // A number in a ring, the way the stage writes which question it is.
    '.st-no{flex:none;display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 6px;box-sizing:border-box;border-radius:12px;border:1.5px solid var(--st-glow);color:var(--st-tint);font-size:13px;font-weight:800;font-variant-numeric:lining-nums tabular-nums;line-height:1}',
    '@media (max-width:600px){.st-btn{width:46px;height:46px}.st-btn svg{width:22px;height:22px}}',
    '@media (prefers-reduced-motion:reduce){.st-ui *,.st-ui *::before,.st-ui *::after,.st-ui.st-enter{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}'
  ].join('');

  var ICONS = {
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    prev: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    next: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
    replay: '<path d="M5.6 12.6a6.6 6.6 0 1 0 2-5.3"/><path d="M5.2 4.4v4.2h4.2"/>',
    list: '<path d="M8.5 7h10M8.5 12h10M8.5 17h10"/><circle cx="5" cy="7" r=".6"/><circle cx="5" cy="12" r=".6"/><circle cx="5" cy="17" r=".6"/>',
    down: '<path d="M7 10l5 5 5-5"/>'
  };

  function inject() {
    if (document.getElementById('st-theme-style')) return;
    var s = document.createElement('style'); s.id = 'st-theme-style'; s.textContent = CSS; document.head.appendChild(s);
  }
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>'; }
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function still() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // Shows or hides an element so the eye sees it come and go: it grows in
  // from a little smaller, and fades out before it leaves its place.
  function show(el, on, animated) {
    if (on === !el.hidden) return;
    if (on) {
      el.hidden = false;
      if (animated && !still()) { el.classList.remove('st-enter'); void el.offsetWidth; el.classList.add('st-enter'); }
      return;
    }
    el.classList.remove('st-enter');
    if (!animated || still()) { el.hidden = true; return; }
    var a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.8)' }], { duration: 260, easing: 'ease-in' });
    a.onfinish = function () { el.hidden = true; };
  }

  // A round icon button component: one press event, and a state the
  // player sets (enabled, ready, shown). The words are for screen readers
  // only; the face shows the icon alone.
  function IconButton(host, opts) {
    LessonComponents.Base.call(this);
    inject();
    var self = this;
    this.iface = opts.iface;
    this.st = { enabled: opts.enabled !== false, ready: false, shown: opts.shown !== false };
    host.classList.add('st-ui');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-btn st-glass ' + (opts.cls || '');
    b.setAttribute('aria-label', opts.label);
    b.innerHTML = icon(opts.icon);
    host.appendChild(b);
    this.el = b;
    b.addEventListener('click', function () { if (!b.disabled) self.emit({ name: opts.iface + '.press' }); });
    this.apply(false);
  }
  IconButton.prototype = Object.create(LessonComponents.Base.prototype);
  IconButton.prototype.call = function (name, v) {
    if (name !== this.iface + '.set') throw new Error(this.iface + ': ' + name);
    var self = this;
    Object.keys(v || {}).forEach(function (k) { if (k in self.st) self.st[k] = !!v[k]; });
    this.apply(true);
  };
  IconButton.prototype.apply = function (animated) {
    this.el.disabled = !this.st.enabled;
    this.el.classList.toggle('st-ready', this.st.enabled && this.st.ready);
    show(this.el, this.st.shown, animated);
  };
  IconButton.prototype.getState = function () { return Object.assign({}, this.st); };
  IconButton.prototype.setState = function (s) { Object.assign(this.st, s || {}); this.apply(false); };

  // Registers a round icon button as a component of this theme.
  function button(id, opts) {
    LessonComponents.register(id, {
      theme: 'stage', interfaces: [opts.iface],
      create: function (host, input) { return new IconButton(host, Object.assign({}, opts, input || {})); }
    });
  }

  return { inject: inject, icon: icon, esc: esc, still: still, show: show, IconButton: IconButton, button: button };
})();
