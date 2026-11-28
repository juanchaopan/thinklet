/* ============================================================
   Fill-in: its capability interfaces. Turns interface calls into the
   fill-in's own commands and its key presses into interface events, and
   keeps what it shows as state. A press on it sounds (sound).
   Interfaces: answer, point, set, positions. fit(view) hands the
   fill-in the room it is given: a compact tray first, then only the
   sentence with the current box.
   ============================================================ */
(function () {
  var U = LessonComponents.util;
  function FillI(host, input) {
    LessonComponents.Base.call(this);
    var self = this;
    Sound.pressable(host);
    this.c = new Fill(host, Object.assign({}, input, { onEvent: function (ev) {
      if (ev.type !== 'keyPress') return;
      self.st.values = Object.assign({}, ev.values);
      var f = self.c.field(ev.id);
      if (ev.accepted && ev.key !== 'back' && ev.key !== 'next' && f && ev.value.length >= f.size) self.emit({ name: 'answer.given', item: ev.id, value: ev.value });
    } }));
    this.st = { values: {}, checks: {}, spotlight: [], focus: null };
  }
  FillI.prototype = Object.create(LessonComponents.Base.prototype);
  FillI.prototype.call = function (name, v, ctx, ok) {
    var hurry = ctx && ctx.hurry;
    if (name === 'point.spotlight') { this.st.spotlight = U.arr(v); this.c.spotlight(this.st.spotlight); return; }
    if (name === 'point.highlight') { this.c.highlight(U.arr(v)); return; }
    if (name === 'point.clear') { this.st.spotlight = []; this.c.spotlight([]); this.c.highlight([]); return; }
    if (name === 'answer.focus') { var id = v && typeof v === 'object' ? v.item : v; this.st.focus = id; this.c.focus(id); return; }
    if (name === 'answer.check') { var m = {}; m[v.item] = ok; this.st.checks[v.item] = ok; this.c.check(m); return; }
    if (name === 'answer.clear') {
      if (v && v.item !== undefined && v.item !== null) { this.st.values[v.item] = ''; delete this.st.checks[v.item]; this.st.focus = v.item; }
      this.apply(); return;
    }
    if (name === 'answer.demo') {
      this.st.values[v.item] = v.value;
      if (hurry) { this.apply(); return; }
      this.c.type(v.item, v.value);
      return U.sleep(Fill.TYPE_GAP_MS * (String(v.value).length + 1) + 400);
    }
    if (name === 'answer.lock') { this.c.lock(v !== false); return; }
    throw new Error('fill: ' + name);
  };
  FillI.prototype.apply = function () { this.c.set({ values: this.st.values, checks: this.st.checks, spotlight: this.st.spotlight, focus: this.st.focus }); };
  FillI.prototype.fit = function (view) { this.c.fitView(view); };
  FillI.prototype.stop = function () { if (this.c.stop) this.c.stop(); };
  FillI.prototype.getState = function () { return U.clone(this.st); };
  FillI.prototype.setState = function (s) {
    this.st = U.clone(Object.assign({ values: {}, checks: {}, spotlight: [], focus: null }, s || {}));
    this.apply();
  };
  LessonComponents.register('fill', { interfaces: ['answer', 'point', 'set', 'positions'], create: function (h, i) { return new FillI(h, i); } });
})();
