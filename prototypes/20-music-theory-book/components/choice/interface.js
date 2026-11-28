/* ============================================================
   Choice: its capability interfaces. Turns interface calls into the
   choice's own commands and its events into interface events, and keeps
   what it shows as state. Its notes play on the piano component, and a
   press on it sounds (sound). Interfaces: answer, point, strike, set,
   play, positions. fit(view) hands the choice the room it is given:
   options that do not fit it stand in one sliding row.
   ============================================================ */
(function () {
  var U = LessonComponents.util;
  function ChoiceI(host, input) {
    LessonComponents.Base.call(this);
    var self = this;
    Sound.pressable(host);
    this.c = new Choice(host, Object.assign({}, input, { mode: 'lecture', sound: Piano, onEvent: function (ev) {
      if (ev.type === 'optionTap') { self.st.selected = ev.selected.slice(); if (ev.on && !ev.struck) self.emit({ name: 'answer.given', item: null, value: ev.id }); }
      if (ev.type === 'boxTap') { self.st.values = ev.values.slice(); if (ev.value) self.emit({ name: 'answer.given', item: ev.index, value: ev.value }); }
    } }));
    this.st = { selected: [], values: [], struck: [], checks: {}, spotlight: [] };
  }
  ChoiceI.prototype = Object.create(LessonComponents.Base.prototype);
  ChoiceI.prototype.key = function (a) { return a.item === null || a.item === undefined ? a.value : a.item; };
  ChoiceI.prototype.call = function (name, v, ctx, ok) {
    var hurry = ctx && ctx.hurry;
    if (name === 'point.spotlight') { this.st.spotlight = U.arr(v); this.c.spotlight(this.st.spotlight); return; }
    if (name === 'point.highlight') { this.c.highlight(U.arr(v)); return; }
    if (name === 'point.clear') { this.st.spotlight = []; this.c.spotlight([]); this.c.highlight([]); return; }
    if (name === 'strike') { this.st.struck = this.st.struck.concat(U.arr(v)); this.c.strike(U.arr(v)); return hurry ? null : U.sleep(600); }
    if (name === 'answer.focus') return;
    if (name === 'answer.check') { var m = {}; m[this.key(v)] = ok; this.st.checks[this.key(v)] = ok; this.c.check(m); return; }
    if (name === 'answer.clear') {
      if (v && v.value !== undefined) delete this.st.checks[this.key(v)];
      this.st.selected = []; this.st.values = [];
      this.apply(); return;
    }
    if (name === 'answer.demo') {
      if (v.item === null || v.item === undefined) { this.st.selected = [v.value]; this.c.select([v.value]); }
      else { this.st.values[v.item] = v.value; this.c.select(this.st.values); }
      return hurry ? null : U.sleep(500);
    }
    if (name === 'answer.lock') { this.c.lock(v !== false); return; }
    throw new Error('choice: ' + name);
  };
  ChoiceI.prototype.apply = function () { this.c.set({ selected: this.st.selected, values: this.st.values, struck: this.st.struck, checks: this.st.checks, spotlight: this.st.spotlight }); };
  ChoiceI.prototype.fit = function (view) { this.c.fitView(view); };
  ChoiceI.prototype.stop = function () { if (this.c.stop) this.c.stop(); };
  ChoiceI.prototype.getState = function () { return U.clone(this.st); };
  ChoiceI.prototype.setState = function (s) {
    this.st = U.clone(Object.assign({ selected: [], values: [], struck: [], checks: {}, spotlight: [] }, s || {}));
    this.apply();
  };
  LessonComponents.register('choice', { interfaces: ['answer', 'point', 'strike', 'set', 'play', 'positions'], create: function (h, i) { return new ChoiceI(h, i); } });
})();
