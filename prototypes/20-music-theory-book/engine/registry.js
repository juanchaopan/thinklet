/* ============================================================
   Component registry and loader. A component is one folder,
   components/<name>/, that holds everything it needs and a manifest,
   component.json:

     { "needs":   names of the components it uses,
       "scripts": its scripts in order (a full URL for an outside library),
       "styles":  its stylesheets (a full URL for an outside font) }

   load(names, base) reads the manifests of those components and of every
   component they need, and puts the needed ones' styles and scripts on
   the page before their own, each file once. So a component folder
   copied into another system works there as it is, given the components
   it names in `needs`. A manifest, script or own stylesheet that fails
   to load fails the load and is forgotten, so loading again (the loading
   screen's 再试一次) tries it afresh; an outside stylesheet (a font)
   that fails only leaves its text in the system font.

   Each component's script registers it here under its name:

     register(name, { interfaces, fluid, create(host, input, env),
                      preload(progress), prepare(input, progress) })

   A component drawn on the stage has `create`, which returns an
   instance with:
     call(name, value, ctx, extra)  an interface command, e.g. 'point.spotlight';
                                    one that takes time returns a promise
     on(fn)                         interface events, { name, ... }
     getState(), setState(state)    what it shows now, and set straight to it
     stop()                         stop sounds and anything moving
     fit(view)                      the most room it may take, {width, height}
                                    in its own pixels, or null for its own
                                    size; it lays itself out to stay inside
   A fluid component follows its width by itself; another is drawn again
   when its width changes. A component that draws nothing (a sound, an
   instrument) has no `create`; the components that need it call it
   directly. `preload(progress)` downloads what a component needs whatever
   it is given; preload(names, progress) runs it for those components and
   all they need. `prepare(input, progress)` downloads what one set of
   inputs names (an item's recordings); the lecture engine runs it for the
   inputs its scenes will give, before the lecture starts, and the
   component keeps what it prepared for when it is created with those
   inputs. The engine finds components only through here, so it holds no
   code for any particular one.
   ============================================================ */
var LessonComponents = (function () {
  var defs = {}, manifests = {}, reading = {}, files = {};

  function Base() { this.listeners = []; }
  Base.prototype.on = function (fn) { this.listeners.push(fn); };
  Base.prototype.emit = function (ev) { this.listeners.forEach(function (f) { f(ev); }); };
  Base.prototype.stop = function () {};
  Base.prototype.getState = function () { return {}; };
  Base.prototype.setState = function () {};
  Base.prototype.fit = function () {};

  function arr(x) { return x === undefined || x === null ? [] : [].concat(x); }
  function outside(url) { return /^[a-z]+:/i.test(url); }
  function absolute(url, folder) { return outside(url) ? url : new URL(url, folder).href; }
  // Keeps a promise under a key while it can still succeed.
  function remember(cache, key, p) {
    cache[key] = p;
    p.catch(function () { if (cache[key] === p) delete cache[key]; });
    return p;
  }

  // Reads one manifest and, before it settles, every manifest it needs.
  function read(name, base) {
    if (reading[name]) return reading[name];
    var folder = new URL(base + name + '/', location.href).href;
    return remember(reading, name, fetch(folder + 'component.json').then(function (r) {
      if (!r.ok) throw new Error('组件 ' + name + ' 没有 component.json（' + r.status + '）');
      return r.json();
    }).then(function (m) {
      manifests[name] = { folder: folder, needs: arr(m.needs), scripts: arr(m.scripts), styles: arr(m.styles) };
      return Promise.all(manifests[name].needs.map(function (n) { return read(n, base); }));
    }));
  }

  // The components named and all they need, each after what it needs.
  function order(names) {
    var out = [], seen = {};
    (function visit(list) {
      list.forEach(function (n) {
        if (seen[n]) return;
        seen[n] = true;
        visit((manifests[n] || {}).needs || []);
        out.push(n);
      });
    })(arr(names));
    return out;
  }

  function style(url, optional) {
    if (files[url]) return files[url];
    return remember(files, url, new Promise(function (res, rej) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url;
      l.onload = function () { res(); };
      l.onerror = function () { l.remove(); if (optional) res(); else rej(new Error('没有加载出来：' + url)); };
      document.head.appendChild(l);
    }));
  }
  function script(url) {
    if (files[url]) return files[url];
    return remember(files, url, new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = url; s.async = false;
      s.onload = function () { res(); };
      s.onerror = function () { s.remove(); rej(new Error('没有加载出来：' + url)); };
      document.head.appendChild(s);
    }));
  }

  // Styles go on together; scripts run one after another in the order
  // the components and their manifests give.
  function load(names, base) {
    base = base || 'components/';
    return Promise.all(arr(names).map(function (n) { return read(n, base); })).then(function () {
      var list = order(names), styles = [], scripts = [];
      list.forEach(function (n) {
        var m = manifests[n];
        m.styles.forEach(function (u) { styles.push(style(absolute(u, m.folder), outside(u))); });
        m.scripts.forEach(function (u) { scripts.push(absolute(u, m.folder)); });
      });
      return Promise.all(styles.concat(scripts.reduce(function (p, u) { return p.then(function () { return script(u); }); }, Promise.resolve()))).then(function () { return list; });
    });
  }

  // Runs the preload of each of those components and all they need;
  // progress(fraction 0..1 or null when unknown, text) adds them up.
  function preload(names, progress) {
    var tell = progress || function () {}, list = order(names).filter(function (n) { return defs[n] && defs[n].preload; });
    if (!list.length) return Promise.resolve();
    var parts = list.map(function () { return 0; });
    return Promise.all(list.map(function (n, i) {
      return defs[n].preload(function (f, text) {
        if (f === null || f === undefined) { tell(null, text); return; }
        parts[i] = f / list.length;
        tell(parts.reduce(function (a, b) { return a + b; }, 0), text);
      });
    }));
  }

  return {
    Base: Base,
    register: function (id, def) { defs[id] = Object.assign({ id: id, interfaces: [] }, def); },
    get: function (id) { return defs[id] || null; },
    ids: function () { return Object.keys(defs); },
    needsOf: function (id) { return (manifests[id] || {}).needs || []; },
    load: load,
    preload: preload,
    util: {
      sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
      arr: arr,
      clone: function (x) { return JSON.parse(JSON.stringify(x === undefined ? null : x)); }
    }
  };
})();
