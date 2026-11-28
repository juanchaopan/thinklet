/* ============================================================
   Parameters. A workflow declares its formal parameters (`params`):
   each has a type, and may be required (always, or when a sibling has
   one of some values); a list declares the fields of each element
   (`each`), a map the type of every value (`of`). An item passes the
   actual parameters. This file knows only that vocabulary:

   LessonParams.check(decl, params)     problems, [] when none
   LessonParams.paths(decl, params, t)  {path: value} of every value of type t
   LessonParams.locate(decl, params, base)  the params with every folder
                                        and file as a full address from
                                        the item's address `base`
   LessonParams.get(root, path)         a value by its path (a.b.0.c)
   LessonParams.ref(ref, scope)         a `$name.rest` reference: {value, path}
   LessonParams.holds(when, scope)      whether a `when` condition holds

   A path names a value from the item's params down: lines.read.question,
   parts.0.lines.measure.unit. Map keys may themselves hold dots
   (`measure.unit`); a path step takes the longest key that matches.
   A scope maps names to bindings {value, path}: the item's parameters,
   `for` variables and scene parameters; a binding's path is null when
   the value is not one of the item's parameters.
   ============================================================ */
var LessonParams = (function () {
  var PRIMITIVE = {
    text: function (v) { return typeof v === 'string'; },
    number: function (v) { return typeof v === 'number'; },
    boolean: function (v) { return typeof v === 'boolean'; },
    list: function (v) { return Array.isArray(v); },
    map: function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); },
    folder: function (v) { return typeof v === 'string' && !/^[\\/]|\.\./.test(v); },
    file: function (v) { return typeof v === 'string' && !/^[\\/]|\.\./.test(v); },
    speech: function (v) { return typeof v === 'string' || (!!v && typeof v.text === 'string'); }
  };

  function typeOf(spec) {
    if (!spec || spec.type === undefined) return 'any';
    if (spec.type && typeof spec.type === 'object' && spec.type.oneOf) return 'oneOf';
    return String(spec.type);
  }

  // Walks a path, letting a map key hold dots: at each step the longest
  // run of the remaining names that is a key is taken. Returns the value
  // and the path written with the keys actually used.
  function walk(root, names) {
    var cur = root, used = [];
    for (var i = 0; i < names.length;) {
      if (cur === undefined || cur === null || typeof cur !== 'object') return { value: undefined, path: used.concat(names.slice(i)).join('.') };
      var took = 0;
      for (var j = names.length; j > i; j--) {
        var key = names.slice(i, j).join('.');
        if (Object.prototype.hasOwnProperty.call(cur, key)) { cur = cur[key]; used.push(key); took = j - i; break; }
      }
      if (!took) return { value: undefined, path: used.concat(names.slice(i)).join('.') };
      i += took;
    }
    return { value: cur, path: used.join('.') };
  }
  function get(root, path) { return walk(root, String(path).split('.')).value; }

  function ref(r, scope) {
    if (typeof r !== 'string' || r.charAt(0) !== '$') return { value: r, path: null };
    var names = r.slice(1).split('.'), b = scope[names.shift()];
    if (b === undefined) return { value: undefined, path: null };
    var w = walk(b.value, names);
    return { value: w.value, path: b.path === null || b.path === undefined ? null : [b.path, w.path].filter(Boolean).join('.') };
  }

  // A condition holds when every `$ref: value` (or `$ref: [values]`) does
  // and `has: $ref` names a value that is given.
  function holds(when, scope) {
    return Object.keys(when || {}).every(function (k) {
      var want = when[k];
      if (k === 'has') return ref(String(want), scope).value !== undefined;
      var v = ref(k, scope).value;
      return Array.isArray(want) ? want.indexOf(v) >= 0 : v === want;
    });
  }

  // A field is required always (true), or when sibling fields in the same
  // object have one of the listed values ({ $kind: [a, b] }).
  function required(spec, siblings) {
    var r = spec && spec.required;
    if (r === true) return true;
    if (!r || typeof r !== 'object') return false;
    var scope = {};
    Object.keys(siblings || {}).forEach(function (k) { scope[k] = { value: siblings[k], path: null }; });
    return holds(r, scope);
  }

  function checkValue(spec, v, path, out) {
    var t = typeOf(spec);
    if (t === 'oneOf') { if (spec.type.oneOf.indexOf(v) < 0) out.push(path + ' 应该是 ' + spec.type.oneOf.join('、') + ' 之一'); return; }
    if (PRIMITIVE[t] && !PRIMITIVE[t](v)) { out.push(path + ' 应该是 ' + t); return; }
    if (t === 'list') v.forEach(function (el, i) { checkObject(spec.each, el, path + '.' + i, out); });
    if (t === 'map' && spec.of) Object.keys(v).forEach(function (k) { checkValue({ type: spec.of }, v[k], path + '.' + k, out); });
  }
  function checkObject(fields, obj, path, out) {
    if (!fields) return;
    if (!obj || typeof obj !== 'object') { out.push(path + ' 应该是一组字段'); return; }
    Object.keys(fields).forEach(function (k) {
      var p = path ? path + '.' + k : k;
      if (obj[k] === undefined) { if (required(fields[k], obj)) out.push('缺少必填的参数 ' + p); return; }
      checkValue(fields[k], obj[k], p, out);
    });
    Object.keys(obj).forEach(function (k) { if (!(k in fields)) out.push((path ? path + '.' : '') + k + ' 不是流程声明的参数'); });
  }
  function check(decl, params) { var out = []; checkObject(decl || {}, params || {}, '', out); return out; }

  // Every value of one type, by path, following the declarations.
  function paths(decl, params, type) {
    var out = {};
    function visit(spec, v, path) {
      if (v === undefined || v === null) return;
      var t = typeOf(spec);
      if (t === type) { out[path] = v; return; }
      if (t === 'list' && Array.isArray(v)) v.forEach(function (el, i) { visitObject(spec.each, el, path + '.' + i); });
      if (t === 'map' && spec.of !== undefined && typeof v === 'object') Object.keys(v).forEach(function (k) { visit({ type: spec.of }, v[k], path + '.' + k); });
    }
    function visitObject(fields, obj, path) {
      if (!fields || !obj) return;
      Object.keys(fields).forEach(function (k) { visit(fields[k], obj[k], path ? path + '.' + k : k); });
    }
    visitObject(decl || {}, params || {}, '');
    return out;
  }

  // A copy of the params in which every folder (ending in /) and file is
  // a full address, so a component can fetch it wherever the item lives.
  function locate(decl, params, base) {
    function value(spec, v) {
      if (v === undefined || v === null) return v;
      var t = typeOf(spec);
      if (t === 'folder' && typeof v === 'string') return new URL(v.replace(/\/?$/, '/'), base).href;
      if (t === 'file' && typeof v === 'string') return new URL(v, base).href;
      if (t === 'list' && Array.isArray(v)) return v.map(function (el) { return object(spec.each, el); });
      if (t === 'map' && spec.of !== undefined && v && typeof v === 'object') { var m = {}; Object.keys(v).forEach(function (k) { m[k] = value({ type: spec.of }, v[k]); }); return m; }
      return v;
    }
    function object(fields, obj) {
      if (!fields || !obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
      var out = {};
      Object.keys(obj).forEach(function (k) { out[k] = fields[k] ? value(fields[k], obj[k]) : obj[k]; });
      return out;
    }
    return object(decl || {}, params || {});
  }

  return { check: check, paths: paths, locate: locate, get: get, ref: ref, holds: holds, typeOf: typeOf };
})();
