/* ============================================================
   Demo kit: the bench every control's demo page shares, playing the
   player on that page. It belongs to the engine; the lecture never
   loads it.

   ControlsDemo.start(options) fills the page's <div id="demo"> with a
   mock lecture stage holding the control where the workflow puts it, the
   same stage at phone width, a row of buttons that send the control the
   player's commands, and a log of the events the control emits.

   The page loads the engine's loading screen (engine/loading.js,
   PlayerLoading). Behind it the kit sets the theme's constants
   (content/themes/etude.yaml) on the page and loads the control the way
   the lecture does, LessonComponents.load([id], '../'), which brings in
   its files and every component its manifest needs; then it runs the
   preloads of all of them and the page's own tasks. The two copies of
   the control are built on 开始, the tap that lets phones play sound.

   options:
     id        the control's component id
     place     the stage row it stands in: top, head or bottom
     end       true to stand at the row's end (right) instead of its start
     grow      true to take the row's free width
     input     its input, or a function returning it when it is built
     need      the page's loading tasks, task(progress) returning a
               promise; each runs once the control is loaded, so it may
               use what the control's scripts define
     ready     fn(control) after each copy is built
     commands  [{ key, label, code, run(control) }], run on both copies
     note      a sentence above the command buttons

   window.demo exposes the two copies, the logged events and the
   commands, for tests. Paths are relative to the demo pages at
   components/<id>/demo.html.
   ============================================================ */
var ControlsDemo = (function () {
  var THEME = '../../content/themes/etude.yaml';
  var COMPONENTS = '../';
  var ROWS = '<div class="row top"></div><div class="row head"></div><div class="middle">这一幕的组件（示意）</div><div class="row bottom"></div>';

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function theme() {
    return ThemeConstants.load(THEME).then(function (t) { ThemeConstants.apply(document.documentElement, t); });
  }

  function start(o) {
    if (!window.PlayerLoading) throw new Error('ControlsDemo 需要载入画面 engine/loading.js');
    var root = document.getElementById('demo');
    root.classList.add('demo-live');
    root.innerHTML =
      '<div class="toolbar"><button type="button" class="btn" id="boundary"></button></div>' +
      '<section class="stage" id="stage-wide" aria-label="讲题舞台（示意）">' + ROWS + '</section>' +
      '<section class="panel"><h2>手机宽度</h2><div class="stage phone" id="stage-phone" aria-label="手机上的讲题舞台（示意）">' + ROWS + '</div></section>' +
      '<section class="panel"><h2>模拟播放器：发给组件的指令</h2>' +
        (o.note ? '<p class="note">' + esc(o.note) + '</p>' : '') +
        '<div class="toolbar" id="commands">' + (o.commands || []).map(function (c) {
          return '<button type="button" class="btn" data-cmd="' + esc(c.key) + '">' + esc(c.label) + (c.code ? '<code>' + esc(c.code) + '</code>' : '') + '</button>';
        }).join('') + '</div>' +
        '<h3>它发出的事件</h3><div class="log" id="log" aria-live="polite"></div>' +
      '</section>';

    var logEl = document.getElementById('log');
    var controls = {};
    var demo = window.demo = { controls: controls, events: [], commands: {} };

    function line(text, cls) {
      var d = document.createElement('div');
      d.textContent = text; if (cls) d.className = cls;
      logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
    }
    function log(where, ev) {
      var extra = Object.keys(ev).filter(function (k) { return k !== 'name'; }).map(function (k) {
        return k + '=' + (typeof ev[k] === 'string' ? ev[k] : JSON.stringify(ev[k]));
      });
      line(where + ' → ' + ev.name + (extra.length ? ' ' + extra.join(' ') : ''));
      demo.events.push(Object.assign({ where: where }, ev));
    }
    function fail(e) { line('出错：' + (e && e.message || e), 'err'); console.error(e); }

    function build(key, stageEl) {
      var def = LessonComponents.get(o.id), host = document.createElement('div');
      var row = stageEl.querySelector('.row.' + (o.place || 'top'));
      if (o.end) row.classList.add('end');
      host.className = 'ctl' + (o.grow ? ' grow' : '');
      host.setAttribute('data-ctl', o.id);
      row.appendChild(host);
      var input = typeof o.input === 'function' ? o.input() : (o.input || {});
      var c = def.create(host, input, {});
      c.on(function (ev) { log(key === 'wide' ? '电脑' : '手机', ev); });
      controls[key] = c;
      if (o.ready) o.ready(c);
    }
    function buildAll() {
      build('wide', document.getElementById('stage-wide'));
      build('phone', document.getElementById('stage-phone'));
    }

    (o.commands || []).forEach(function (c) {
      demo.commands[c.key] = function () { Object.keys(controls).forEach(function (k) { c.run(controls[k]); }); };
    });
    document.getElementById('commands').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cmd]'); if (!b) return;
      try { demo.commands[b.getAttribute('data-cmd')](); } catch (err) { fail(err); }
    });

    var boundary = document.getElementById('boundary');
    function setBoundary(on) {
      document.body.setAttribute('data-boundary', on ? 'on' : 'off');
      boundary.textContent = on ? '隐藏组件边界' : '显示组件边界';
    }
    boundary.addEventListener('click', function () { setBoundary(document.body.getAttribute('data-boundary') !== 'on'); });
    setBoundary(true);

    // The control's files, and the components it needs, load once; the
    // page's own tasks wait for them.
    var loaded = null;
    function load() {
      if (!loaded) loaded = LessonComponents.load([o.id], COMPONENTS);
      return loaded;
    }
    PlayerLoading.need(function (progress) {
      return Promise.all([theme(), load()]).then(function () {
        if (!LessonComponents.get(o.id)) throw new Error('组件 ' + o.id + ' 没有登记');
        return LessonComponents.preload([o.id], progress);
      }).then(function () { progress(1, '主题和组件'); });
    });
    (o.need || []).forEach(function (t) {
      PlayerLoading.need(function (progress) { return load().then(function () { return t(progress); }); });
    });
    PlayerLoading.onStart(function () { try { buildAll(); } catch (err) { fail(err); } });
  }

  return { start: start, THEME: THEME, COMPONENTS: COMPONENTS };
})();
