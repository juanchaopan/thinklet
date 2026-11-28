/* ============================================================
   Question title (stage theme). A glass plaque with the question's
   number in a ring and its title. It can unfold the question's text
   under the title, Chinese first and the paper's English under it in a
   smaller italic; the player unfolds it in the scenes the workflow marks
   (reading the question) and folds it away after, the plaque's height
   gliding both ways.
   Inputs: no, title, text, gloss.
   Interface: title. Commands: title.set {open}.
   ============================================================ */
(function () {
  var CSS = [
    '.st-qt{box-sizing:border-box;width:fit-content;max-width:100%;margin:0 auto;padding:9px 18px 9px 12px;border-radius:22px}',
    '.st-qt-head{display:flex;align-items:center;gap:10px;min-width:0}',
    '.st-qt-name{min-width:0;font-size:18px;font-weight:800;letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.st-qt-more{overflow:hidden}',
    '.st-qt-more[hidden]{display:none}',
    '.st-qt-text{margin:8px 0 0 34px;max-width:52ch;font-size:16px;line-height:1.5;font-weight:600}',
    '.st-qt-gloss{margin:2px 0 1px 34px;max-width:60ch;font:italic 500 16px/1.3 "Cormorant Garamond","Times New Roman",serif;color:var(--st-soft)}',
    '@media (max-width:600px){.st-qt{padding:7px 14px 7px 9px;border-radius:18px}.st-qt-name{font-size:16px}.st-qt-text{margin-left:0;font-size:15px}.st-qt-gloss{margin-left:0;font-size:15px}}'
  ].join('');
  var MOVE_MS = 520;

  function Title(host, input) {
    LessonComponents.Base.call(this);
    StageTheme.inject();
    if (!document.getElementById('st-qt-style')) { var s = document.createElement('style'); s.id = 'st-qt-style'; s.textContent = CSS; document.head.appendChild(s); }
    var i = input || {}, e = StageTheme.esc;
    this.st = { open: false };
    host.classList.add('st-ui');
    var root = document.createElement('div');
    root.className = 'st-qt st-glass';
    root.innerHTML = '<div class="st-qt-head">' + (i.no !== undefined && i.no !== '' ? '<span class="st-no">' + e(i.no) + '</span>' : '') + '<h2 class="st-qt-name" style="margin:0">' + e(i.title) + '</h2></div>' +
      '<div class="st-qt-more" hidden>' + (i.text ? '<p class="st-qt-text" lang="zh">' + e(i.text) + '</p>' : '') + (i.gloss ? '<p class="st-qt-gloss" lang="en">' + e(i.gloss) + '</p>' : '') + '</div>';
    host.appendChild(root);
    this.root = root; this.more = root.querySelector('.st-qt-more');
    this.empty = !i.text && !i.gloss;
  }
  Title.prototype = Object.create(LessonComponents.Base.prototype);
  // Unfolds or folds the question's text: the plaque's width and height
  // glide from the old size to the new one, and the text fades.
  Title.prototype.open = function (on, animated) {
    on = !!on && !this.empty;
    if (this.st.open === on && this.drawn) return;
    this.st.open = on; this.drawn = true;
    var r = this.root, m = this.more;
    if (this.anim) { this.anim.cancel(); this.anim = null; }
    if (!animated || StageTheme.still()) { m.hidden = !on; return; }
    var w0 = r.offsetWidth, h0 = r.offsetHeight;
    m.hidden = false;
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
    theme: 'stage', interfaces: ['title'],
    create: function (host, input) { return new Title(host, input); }
  });
})();
