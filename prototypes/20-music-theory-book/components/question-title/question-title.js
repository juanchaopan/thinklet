/* ============================================================
   Question title. A glass plaque (stage-glass) with the question's
   number in a ring and its title. It can unfold the question's text
   under the title, Chinese first and the paper's English under it in a
   smaller italic; the engine unfolds it in the scenes the workflow marks
   (reading the question) and folds it away after, the plaque's height
   gliding both ways.

   When it is given less room than it asks for:
     the title gets smaller, down to NAME_MIN of its size, and past that
     ends with an ellipsis;
     the unfolded text may take at most TEXT_SHARE of the screen's
     height; when it would take more, it gets smaller, down to TEXT_MIN
     of its size, and past that the English folds away and only the
     Chinese stays.
   The plaque asks for the title's and the text's full widths whatever
   size they are drawn at, so how small they are drawn follows only the
   room it is given.

   Inputs: no, title, text, gloss.
   Interface: title. Commands: title.set {open}.
   ============================================================ */
(function () {
  var NAME_MIN = .78, TEXT_MIN = .8, TEXT_SHARE = .22, TEXT_STEP = .05;
  var CSS = [
    '.st-qt{--qt-name:18px;--qt-text:16px;--qt-nk:1;--qt-tk:1;position:relative;box-sizing:border-box;width:fit-content;max-width:100%;margin:0 auto;padding:9px 18px 9px 12px;border-radius:22px}',
    '.st-qt-head{display:flex;align-items:center;gap:10px;min-width:0}',
    '.st-qt-name{flex:0 1 auto;min-width:0;margin:0;font-size:calc(var(--qt-name) * var(--qt-nk));font-weight:800;letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // Measures the title at its full size inside a box of no size; never seen.
    '.st-qt-rulerbox{position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none}',
    '.st-qt-ruler{font-size:var(--qt-name);font-weight:800;letter-spacing:.02em;white-space:nowrap}',
    '.st-qt-more{overflow:hidden}',
    '.st-qt-more[hidden]{display:none}',
    '.st-qt-text{margin:8px 0 0 34px;max-width:460px;font-size:calc(var(--qt-text) * var(--qt-tk));line-height:1.5;font-weight:600}',
    '.st-qt-gloss{margin:2px 0 1px 34px;max-width:480px;font:italic 500 calc(var(--qt-text) * var(--qt-tk))/1.3 "Cormorant Garamond","Times New Roman",serif;color:var(--st-soft)}',
    '.st-qt.st-qt-terse .st-qt-gloss{display:none}',
    '@media (max-width:600px){.st-qt{--qt-name:16px;--qt-text:15px;padding:7px 14px 7px 9px;border-radius:18px}.st-qt-text,.st-qt-gloss{margin-left:0}}'
  ].join('');
  var MOVE_MS = 520;

  function Title(host, input) {
    LessonComponents.Base.call(this);
    StageGlass.ui(host);
    if (!document.getElementById('st-qt-style')) { var s = document.createElement('style'); s.id = 'st-qt-style'; s.textContent = CSS; document.head.appendChild(s); }
    var self = this, i = input || {}, e = StageGlass.esc;
    this.st = { open: false };
    var root = document.createElement('div');
    root.className = 'st-qt st-glass';
    root.innerHTML = '<div class="st-qt-head">' + (i.no !== undefined && i.no !== '' ? '<span class="st-no">' + e(i.no) + '</span>' : '') + '<h2 class="st-qt-name">' + e(i.title) + '</h2></div>' +
      '<div class="st-qt-rulerbox" aria-hidden="true"><span class="st-qt-ruler">' + e(i.title) + '</span></div>' +
      '<div class="st-qt-more" hidden>' + (i.text ? '<p class="st-qt-text" lang="zh">' + e(i.text) + '</p>' : '') + (i.gloss ? '<p class="st-qt-gloss" lang="en">' + e(i.gloss) + '</p>' : '') + '</div>';
    host.appendChild(root);
    this.root = root; this.more = root.querySelector('.st-qt-more');
    this.name = root.querySelector('.st-qt-name'); this.ruler = root.querySelector('.st-qt-ruler');
    this.empty = !i.text && !i.gloss;
    this.shrink();
    var w = -1, h = -1;
    function again() {
      var nw = root.clientWidth, nh = document.documentElement.clientHeight;
      if (nw === w && nh === h) return;
      w = nw; h = nh;
      self.shrink();
    }
    if (window.ResizeObserver) new ResizeObserver(again).observe(root);
    window.addEventListener('resize', again);
  }
  Title.prototype = Object.create(LessonComponents.Base.prototype);

  // Draws the title and the unfolded text as large as the room allows.
  Title.prototype.shrink = function () {
    var r = this.root, name = this.name;
    var full = this.ruler.offsetWidth;
    if (full) {
      name.style.width = Math.ceil(full) + 1 + 'px';
      var k = Math.max(NAME_MIN, Math.min(1, name.clientWidth / full));
      r.style.setProperty('--qt-nk', k.toFixed(3));
    }
    if (this.more.hidden) return;
    var limit = document.documentElement.clientHeight * TEXT_SHARE, m = this.more, tk = 1;
    r.classList.remove('st-qt-terse');
    r.style.setProperty('--qt-tk', '1');
    while (m.offsetHeight > limit && tk - TEXT_STEP >= TEXT_MIN - 1e-6) {
      tk -= TEXT_STEP;
      r.style.setProperty('--qt-tk', tk.toFixed(2));
    }
    if (m.offsetHeight > limit) r.classList.add('st-qt-terse');
  };

  // Unfolds or folds the question's text: the plaque's width and height
  // glide from the old size to the new one, and the text fades.
  Title.prototype.open = function (on, animated) {
    on = !!on && !this.empty;
    if (this.st.open === on && this.drawn) return;
    this.st.open = on; this.drawn = true;
    var r = this.root, m = this.more;
    if (this.anim) { this.anim.cancel(); this.anim = null; }
    if (!animated || StageGlass.still()) { m.hidden = !on; this.shrink(); return; }
    var w0 = r.offsetWidth, h0 = r.offsetHeight;
    m.hidden = false;
    this.shrink();
    if (!on) m.hidden = true;
    var w1 = r.offsetWidth, h1 = r.offsetHeight;
    if (!on) m.hidden = false;
    var self = this;
    r.style.overflow = 'hidden';
    this.anim = r.animate([{ width: w0 + 'px', height: h0 + 'px' }, { width: w1 + 'px', height: h1 + 'px' }], { duration: MOVE_MS, easing: 'cubic-bezier(.6, 0, .25, 1)' });
    m.animate(on ? [{ opacity: 0 }, { opacity: 0, offset: .35 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0, offset: .4 }, { opacity: 0 }], { duration: MOVE_MS, easing: 'ease-out' });
    this.anim.onfinish = function () { self.anim = null; r.style.overflow = ''; if (!on) m.hidden = true; };
  };
  Title.prototype.call = function (name, v) {
    if (name !== 'title.set') throw new Error('question-title: ' + name);
    if (v && 'open' in v) this.open(v.open, true);
  };
  Title.prototype.getState = function () { return { open: this.st.open }; };
  Title.prototype.setState = function (s) { this.open(!!(s && s.open), false); };

  LessonComponents.register('question-title', {
    interfaces: ['title'],
    create: function (host, input) { return new Title(host, input); }
  });
})();
