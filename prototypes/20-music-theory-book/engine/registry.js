/* ============================================================
   Component registry. Every component registers here under its id with
   the theme it belongs to, the capability interfaces it implements and a
   factory; the lecture player finds components only through it, so the
   player holds no code for any particular component.

   register(id, { theme, interfaces, create(host, input, env) })
   create returns an instance with:
     call(name, value, ctx, extra)  an interface command, e.g. 'point.spotlight'
     on(fn)                         interface events, { name, ... }
     getState(), setState(state)    what it shows now, and set straight to it
     stop()                         stop sounds and anything moving
   ============================================================ */
var LessonComponents = (function () {
  var defs = {};

  function Base() { this.listeners = []; }
  Base.prototype.on = function (fn) { this.listeners.push(fn); };
  Base.prototype.emit = function (ev) { this.listeners.forEach(function (f) { f(ev); }); };
  Base.prototype.stop = function () {};
  Base.prototype.getState = function () { return {}; };
  Base.prototype.setState = function () {};

  return {
    Base: Base,
    register: function (id, def) { defs[id] = Object.assign({ id: id, interfaces: [] }, def); },
    get: function (id) { return defs[id] || null; },
    ids: function () { return Object.keys(defs); },
    util: {
      sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
      arr: function (x) { return x === undefined || x === null ? [] : [].concat(x); },
      // The note indices a value names: {notes: [..]}, or a list of those.
      notesOf: function notesOf(v) {
        if (!v) return [];
        if (Array.isArray(v)) return v.reduce(function (a, g) { return a.concat(notesOf(g)); }, []);
        return [].concat(v.notes || []);
      },
      clone: function (x) { return JSON.parse(JSON.stringify(x === undefined ? null : x)); }
    }
  };
})();
