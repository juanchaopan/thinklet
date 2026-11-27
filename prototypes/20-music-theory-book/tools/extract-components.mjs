// Copies each component's own code out of its prototype page into
// lib/<id>.js and lib/<id>.css, so a lecture prototype assembles the very
// components the developer confirmed instead of a second copy.
// The stylesheet is the section headed "<name> component: it defines its
// whole look here"; the script is the first block of the page script, up
// to the "Assembly" block that plays the player on the component page.
// Usage: node extract-components.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS = {
  score: 'c1-score.html',
  'beat-grid': 'c3-beat-grid.html',
  'conclusion-stack': 'c7-conclusion-stack.html',
  choice: 'c8-choice.html',
  fill: 'c9-fill.html'
};

function between(lines, isStart, isEnd, what) {
  const start = lines.findIndex(isStart);
  if (start < 0) throw new Error(`no start of ${what}`);
  const end = lines.findIndex((l, i) => i > start && isEnd(l));
  if (end < 0) throw new Error(`no end of ${what}`);
  return lines.slice(start, end).join('\n') + '\n';
}

mkdirSync(join(root, 'lib'), { recursive: true });
for (const [id, file] of Object.entries(COMPONENTS)) {
  const lines = readFileSync(join(root, 'components', file), 'utf8').split(/\r?\n/);
  const css = between(lines, (l) => /^\/\* -{10} .* component: it defines/.test(l), (l) => /^\/\* -{10} /.test(l), `${file} stylesheet`);
  const blocks = lines.map((l, i) => (/^\/\* ={20,}/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (blocks.length < 2) throw new Error(`${file}: expected a component block and an assembly block`);
  const js = lines.slice(blocks[0], blocks[1]).join('\n') + '\n';
  writeFileSync(join(root, 'lib', `${id}.css`), css);
  writeFileSync(join(root, 'lib', `${id}.js`), js);
  console.log(`lib/${id}.js ${js.length}  lib/${id}.css ${css.length}`);
}
