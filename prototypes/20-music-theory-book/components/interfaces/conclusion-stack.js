/* ============================================================
   Conclusion stack (etude): its capability interfaces. Its input `items`
   is every conclusion the item has, by the path of its value
   (parts.0.conclusions.measure); a conclusion's `from` names conclusions
   beside it by their keys, read here as the paths of those siblings. A
   push names the conclusion by the path of the value it is given
   (ctx.ref) and may carry the place on screen it was reached (ctx.from):
   the stack flies it from there, and the step waits until it has landed.
   A tap on a conclusion sends go.origin with its path, so the engine can
   go back to the scene that reached it; positions.rect gives a slip's
   place on screen, so something can fly into it.
   The stack lays itself out at whatever size it is given (fluid).
   Interfaces: conclude, point, mask, set, positions.
   ============================================================ */
(function () {
  var U = LessonComponents.util;
  function siblingsOf(items) {
    var out = {};
    Object.keys(items || {}).forEach(function (path) {
      var c = items[path], base = path.slice(0, path.lastIndexOf('.') + 1);
      out[path] = Object.assign({}, c, { from: U.arr(c.from).map(function (k) { return base + k; }) });
    });
    return out;
  }
  function StackI(host, input) {
    LessonComponents.Base.call(this);
    var self = this;
    this.c = new ConclusionStack(host, Object.assign({}, input, { items: siblingsOf(input && input.items), mode: 'lecture', onEvent: function (ev) {
      if (ev.type === 'itemTap') self.emit({ name: 'go.origin', ref: ev.id });
    } }));
  }
  StackI.prototype = Object.create(LessonComponents.Base.prototype);
  StackI.prototype.call = function (name, v, ctx) {
    var hurry = ctx && ctx.hurry;
    if (name === 'conclude.push') {
      var id = ctx && ctx.ref, opts = ctx && ctx.from && !hurry ? { from: ctx.from } : null;
      if (!id || this.c.order.indexOf(id) >= 0) return;
      this.c.push(id, opts);
      return hurry ? null : U.sleep(this.c.pushMs(opts) + 300);
    }
    if (name === 'conclude.set') { this.c.set(U.arr(v)); return; }
    if (name === 'point.highlight') { this.c.highlight(U.arr(v)); return; }
    if (name === 'mask.hide') { this.c.mask(U.arr(v)); return; }
    if (name === 'mask.reveal') { this.c.reveal(U.arr(v)); return hurry ? null : U.sleep(500); }
    if (name === 'positions.rect') {
      var el = this.c.els[v] || this.c.els[this.c.order[this.c.focusIndex()]] || this.c.view;
      var r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    throw new Error('conclusion-stack: ' + name);
  };
  StackI.prototype.stop = function () { this.c.stop(); };
  StackI.prototype.getState = function () { return { order: this.c.order.slice() }; };
  StackI.prototype.setState = function (s) { this.c.set((s && s.order) || []); };
  LessonComponents.register('conclusion-stack', { theme: 'etude', fluid: true, interfaces: ['conclude', 'point', 'mask', 'set', 'positions'], create: function (h, i, e) { return new StackI(h, i, e); } });
})();
