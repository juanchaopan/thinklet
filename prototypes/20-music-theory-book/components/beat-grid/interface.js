/* ============================================================
   Beat grid: its capability interfaces. Turns interface calls into the
   grid's own commands and its events into interface events, and keeps
   what it shows as state. Its notes play on the piano component, and a
   press on it sounds (sound). Changing to another rhythm goes through
   the engine's crossfade (env.swap), so the new bar comes in where the
   old one fades. In a hurry (a skipped scene) every mark is drawn at once.
   Interfaces: point, count, meter, set, play.
   ============================================================ */
(function () {
  var U = LessonComponents.util;
  // The tile indices a value names: {notes: [..]}, or a list of those.
  function notesOf(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.reduce(function (a, g) { return a.concat(notesOf(g)); }, []);
    return [].concat(v.notes || []);
  }
  function GridI(host, input, env) {
    LessonComponents.Base.call(this);
    this.host = host; this.input = input; this.env = env;
    Sound.pressable(host);
    this.make(input.abc);
  }
  GridI.prototype = Object.create(LessonComponents.Base.prototype);
  GridI.prototype.make = function (abc) {
    var self = this;
    if (this.c) this.c.stop();
    this.host.innerHTML = '';
    this.abc = abc;
    this.c = new BeatGrid(this.host, Object.assign({}, this.input, { abc: abc, mode: 'lecture', sound: Piano, onEvent: function (ev) {
      if (ev.type === 'countStep' && self.counting && ev.n === ev.total) { var done = self.counting; self.counting = null; setTimeout(done, 650); }
      if (ev.type === 'tileTap' || ev.type === 'beatTap') self.emit({ name: 'point.tap', raw: ev });
    } }));
    this.st = { abc: abc, meter: null, sub: [], counts: [], labels: [], hl: null };
  };
  GridI.prototype.sig = function (m) { return typeof m === 'object' && m ? [m.sig, m.group] : [m, undefined]; };
  GridI.prototype.call = function (name, v, ctx) {
    var self = this, hurry = ctx && ctx.hurry;
    if (name === 'meter.show') { var s = this.sig(v); this.c.meter(s[0], s[1]); this.st.meter = v; this.st.sub = []; this.st.counts = []; return hurry ? null : U.sleep(700); }
    if (name === 'meter.subdivide') { this.c.subdivide(v); this.st.sub.push(v); return hurry ? null : U.sleep(400); }
    if (name === 'count.run') {
      this.st.counts.push(v);
      if (hurry) { this.c.count(v, undefined, undefined, true); return null; }
      return new Promise(function (res) { self.counting = res; self.c.count(v); setTimeout(function () { if (self.counting === res) { self.counting = null; res(); } }, 15000); });
    }
    if (name === 'point.highlight') { var idx = notesOf(v); this.c.highlight(idx); this.st.hl = idx; return; }
    if (name === 'point.label') { U.arr(v).forEach(function (g) { var i = notesOf(g)[0]; if (i !== undefined) { self.c.label(i, g.label, hurry); self.st.labels.push([i, g.label]); } }); return hurry ? null : U.sleep(500); }
    if (name === 'point.spotlight') { var n = notesOf(v); this.c.spotlight(n.length ? { tiles: [Math.min.apply(null, n), Math.max.apply(null, n)] } : null); return; }
    if (name === 'point.clear') { this.c.clear(); return; }
    if (name === 'set') { if (v === this.abc) return; if (hurry) { this.make(v); return; } this.env.swap(function () { self.make(v); }); return U.sleep(this.env.moveMs); }
    throw new Error('beat-grid: ' + name);
  };
  GridI.prototype.stop = function () { this.c.stop(); if (this.counting) { var r = this.counting; this.counting = null; r(); } };
  GridI.prototype.getState = function () { return U.clone(this.st); };
  GridI.prototype.setState = function (s) {
    var self = this; s = s || {};
    this.stop();
    if (s.abc && s.abc !== this.abc) this.make(s.abc); else { this.c.clear(); this.c.meter(this.input.meter || '?'); }
    if (s.meter) { var m = this.sig(s.meter); this.c.meter(m[0], m[1]); }
    (s.sub || []).forEach(function (u) { self.c.subdivide(u); });
    (s.counts || []).forEach(function (u) { self.c.count(u, undefined, undefined, true); });
    (s.labels || []).forEach(function (l) { self.c.label(l[0], l[1], true); });
    if (s.hl) this.c.highlight(s.hl);
    this.st = U.clone(Object.assign({ abc: this.abc, meter: null, sub: [], counts: [], labels: [], hl: null }, s));
  };
  LessonComponents.register('beat-grid', { interfaces: ['point', 'count', 'meter', 'set', 'play'], create: function (h, i, e) { return new GridI(h, i, e); } });
})();
