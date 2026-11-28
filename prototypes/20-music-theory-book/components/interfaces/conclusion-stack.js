/* ============================================================
   Conclusion stack (etude): its capability interfaces. A push may carry
   the place on screen the conclusion was reached; the stack flies it
   from there, and the step waits until it has landed. A tap on a
   conclusion is reported, so the player can go to the scene it came from.
   Interfaces: conclude, point, mask, set.
   ============================================================ */
(function () {
  var U = LessonComponents.util;
  function StackI(host, input, env) {
    LessonComponents.Base.call(this);
    var self = this;
    this.c = new ConclusionStack(host, Object.assign({}, input, { mode: 'lecture', onEvent: function (ev) {
      if (ev.type === 'itemTap') self.emit({ name: 'conclude.tap', id: ev.id });
    } }));
  }
  StackI.prototype = Object.create(LessonComponents.Base.prototype);
  StackI.prototype.call = function (name, v, ctx) {
    var hurry = ctx && ctx.hurry;
    if (name === 'conclude.push') {
      var id = v && typeof v === 'object' ? v.id : v, opts = v && v.from && !hurry ? { from: v.from } : null;
      if (this.c.order.indexOf(id) >= 0) return;
      this.c.push(id, opts);
      return hurry ? null : U.sleep(this.c.pushMs(opts) + 300);
    }
    if (name === 'conclude.set') { this.c.set(U.arr(v)); return; }
    if (name === 'point.highlight') { this.c.highlight(U.arr(v)); return; }
    if (name === 'mask.hide') { this.c.mask(U.arr(v)); return; }
    if (name === 'mask.reveal') { this.c.reveal(U.arr(v)); return hurry ? null : U.sleep(500); }
    throw new Error('conclusion-stack: ' + name);
  };
  StackI.prototype.stop = function () { this.c.stop(); };
  StackI.prototype.getState = function () { return { order: this.c.order.slice() }; };
  StackI.prototype.setState = function (s) { this.c.set((s && s.order) || []); };
  LessonComponents.register('conclusion-stack', { theme: 'etude', interfaces: ['conclude', 'point', 'mask', 'set'], create: function (h, i, e) { return new StackI(h, i, e); } });
})();
