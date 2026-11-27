// Records a question's narration the way `task narrate` will: collects
// every line of the question file (each part's lines, and each answer
// point's lines), records with edge-tts (Xiaoxiao, default rate and pitch)
// only the lines whose text or pronunciation changed, and keeps a manifest
// of what each recording says in the question's narration/ folder.
// A line may be a string, or {text, say} when the voice should read `say`.
// Line ids are p<part>.<key> and p<part>.<item>.<key>, the same ids the
// lecture player asks the narration bar for.
// Usage: node narrate-question.mjs <question folder>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire('C:/Users/juanc/AI Projects/thinklet/node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/package.json');
const YAML = require('yaml');

const VOICE = 'zh-CN-XiaoxiaoNeural';
const PACKAGE = 'edge-tts==7.3.1';

export function fileOf(id) { return id.replace(/[^A-Za-z0-9]+/g, '-') + '.mp3'; }

export function collect(question) {
  const out = [];
  const add = (id, line) => {
    const l = typeof line === 'string' ? { text: line } : line;
    out.push({ id, text: l.text, say: l.say, file: fileOf(id) });
  };
  (question.parts || []).forEach((part, p) => {
    Object.entries(part.lines || {}).forEach(([k, v]) => add(`p${p}.${k}`, v));
    (part.items || []).forEach((item) => Object.entries(item.lines || {}).forEach(([k, v]) => add(`p${p}.${item.id}.${k}`, v)));
  });
  return out;
}

const folder = process.argv[2];
if (folder) {
  const question = YAML.parse(readFileSync(join(folder, 'question.yaml'), 'utf8'));
  const dir = join(folder, 'narration');
  mkdirSync(dir, { recursive: true });
  const manifestFile = join(dir, 'manifest.json');
  const old = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
  const manifest = {};
  for (const line of collect(question)) {
    const spoken = line.say ?? line.text;
    const hash = createHash('sha256').update(`${VOICE}|${PACKAGE}|${spoken}`).digest('hex').slice(0, 16);
    manifest[line.file] = { id: line.id, text: line.text, hash };
    if (old[line.file]?.hash === hash && existsSync(join(dir, line.file))) continue;
    execFileSync('uvx', ['--python', '3.12', PACKAGE, '--voice', VOICE, '--text', spoken, '--write-media', join(dir, line.file)], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(`recorded ${line.file}  ${line.text}`);
  }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${Object.keys(manifest).length} lines in ${manifestFile}`);
}
