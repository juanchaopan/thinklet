/* ============================================================
   Theme constants. A theme is a file of constants (colours) that
   components and the stage use by name and never hard-code; swapping
   the theme changes how things look, never their size or behaviour.
   This is the contract: the names a theme must give, each set on the
   stage (or a component page) as the CSS custom property --th-<name>.
   An alpha variant of a constant is written where it is used, with
   color-mix(in srgb, var(--th-<name>) <n>%, transparent).

   ThemeConstants.NAMES        every name a theme gives
   ThemeConstants.check(t)     problems with a theme file, [] when none
   ThemeConstants.apply(el, t) sets the theme's constants on el
   ThemeConstants.load(url)    reads a theme file (YAML)
   ============================================================ */
var ThemeConstants = (function () {
  var NAMES = [
    // Light and shade every surface uses for highlights and shadows.
    'light', 'light-warm', 'shade', 'edge', 'dark',
    // Paper and ink: tiles, slips, the score's sheet, writing on them.
    'paper-a', 'paper-b', 'paper-back', 'sheet-a', 'sheet-b', 'ivory',
    'ink', 'ink-soft', 'ink-strong', 'staff', 'caption',
    // What the lecture lights or confirms, and what is wrong.
    'accent', 'accent-ink', 'wrong',
    // Materials: the wooden ruler, its ribbon, black keys.
    'wood-a', 'wood-b', 'wood-ink', 'ribbon', 'ebony',
    // Speech bubbles over a component.
    'bubble', 'bubble-ink',
    // Controls every lecture has: dark glass, its ink and light.
    'glass', 'glass-hi', 'glass-ink', 'glass-accent', 'button', 'button-hi', 'glass-photo', 'alert', 'alert-ink',
    // The stage: the dark room around it, the lit frame and its glows.
    'backdrop-a', 'backdrop-b', 'backdrop-c', 'frame', 'frame-glow-a', 'frame-glow-b', 'frame-glow-c', 'frame-shade'
  ];

  function check(t) {
    var out = [], c = (t && t.constants) || {};
    NAMES.forEach(function (n) { if (c[n] === undefined) out.push('主题缺少常量 ' + n); });
    Object.keys(c).forEach(function (n) { if (NAMES.indexOf(n) < 0) out.push('主题里的 ' + n + ' 不是主题常量'); });
    return out;
  }
  function apply(el, t) {
    var c = (t && t.constants) || {};
    NAMES.forEach(function (n) { if (c[n] !== undefined) el.style.setProperty('--th-' + n, String(c[n])); });
  }
  function load(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); }).then(function (text) { return jsyaml.load(text); });
  }

  return { NAMES: NAMES, check: check, apply: apply, load: load };
})();
