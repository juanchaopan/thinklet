/* ============================================================
   Score (etude): its capability interfaces. Turns interface calls into
   the score's own commands and its events into interface events, and
   keeps what it shows as state. Notes in a highlight or a label are
   counted within a bar: the bar the value names, else the bar last put
   in the spotlight. The score's drawing scales with the width it is
   given (fluid), so it is not drawn again when it moves to a wider or
   narrower place. Interfaces: point, play, positions.
   ============================================================ */
(function () {
  var U = LessonComponents.util;
  function ScoreI(host, input, env) {
    LessonComponents.Base.call(this);
    var self = this;
    this.host = host;
    this.c = new Score(host, Object.assign({ mode: 'lecture', sound: env.sound, onEvent: function (ev) { self.emit({ name: 'point.tap', raw: ev }); } }, input));
    this.st = { spot: null, hl: null, labels: [] };
  }
  ScoreI.prototype = Object.create(LessonComponents.Base.prototype);
  // Indices in the score of the notes a value names within its bar.
  ScoreI.prototype.indices = function (v) {
    var bar = (v && v.bar) || this.st.spot || 1;
    var inBar = this.c.notesOfBar(bar);
    return U.notesOf(v).map(function (i) { return inBar[i] && inBar[i].index; }).filter(function (i) { return i !== undefined; });
  };
  ScoreI.prototype.call = function (name, v) {
    var self = this;
    if (name === 'point.spotlight') { this.c.spotlight(v && v.bar ? v.bar : null); this.st.spot = v && v.bar || null; this.st.hl = null; return; }
    if (name === 'point.highlight') { var idx = this.indices(v); this.c.highlight(idx); this.st.hl = idx; return; }
    if (name === 'point.label') {
      U.arr(v).forEach(function (g) { var i = self.indices(g)[0]; if (i !== undefined) { self.c.label(i, g.label); self.st.labels.push([i, g.label]); } });
      return;
    }
    if (name === 'point.clear') { this.setState({}); return; }
    if (name === 'positions.rect') { var r = this.host.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
    throw new Error('score: ' + name);
  };
  ScoreI.prototype.stop = function () { if (this.c.stop) this.c.stop(); };
  ScoreI.prototype.getState = function () { return U.clone(this.st); };
  ScoreI.prototype.setState = function (s) {
    var self = this; s = s || {};
    this.c.clear();
    if (s.spot) this.c.spotlight(s.spot);
    if (s.hl) this.c.highlight(s.hl);
    (s.labels || []).forEach(function (l) { self.c.label(l[0], l[1]); });
    this.st = { spot: s.spot || null, hl: s.hl || null, labels: (s.labels || []).slice() };
  };
  LessonComponents.register('score', { theme: 'etude', fluid: true, interfaces: ['point', 'play', 'positions'], create: function (h, i, e) { return new ScoreI(h, i, e); } });
})();
