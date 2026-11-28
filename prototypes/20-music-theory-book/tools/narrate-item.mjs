// Records an item's narration the way `task narrate` will. Which values
// are spoken comes from the item's workflow: every parameter of type
// `speech`, found by its path (lines.read.question,
// parts.0.lines.measure.unit...). Each is recorded with edge-tts
// (Xiaoxiao, default rate and pitch) into the folder the item's
// `narration` parameter names, under a file named by its path, and a
// manifest there records what each file says. A recording whose words did
// not change is kept; one that moved to another path is copied rather
// than recorded again. Recordings no value uses any more are deleted.
// A spoken value may be a string, or {text, say} when the voice should
// read `say`. The engine's parameter code is loaded as the browser loads
// it, so the tool and the player find the same values.
// Usage: node narrate-item.mjs <content folder> <book> <item>
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const YAML = createRequire('C:/Users/juanc/AI Projects/thinklet/node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/package.json')('yaml');
const here = dirname(fileURLToPath(import.meta.url));
const sandbox = {};
vm.runInNewContext(readFileSync(join(here, '..', 'engine', 'params.js'), 'utf8') + '\nthis.LessonParams = LessonParams;', sandbox);
const { LessonParams } = sandbox;

const VOICE = 'zh-CN-XiaoxiaoNeural';
const PACKAGE = 'edge-tts==7.3.1';

// Every spoken value of an item: {path, text, say, file}.
export function spokenLines(workflow, item) {
  const found = LessonParams.paths(workflow.params, item.params, 'speech');
  return Object.entries(found).map(([path, v]) => {
    const l = typeof v === 'string' ? { text: v } : v;
    return { path, text: l.text, say: l.say, file: LessonParams.fileOf(path) };
  });
}

const [root, book, name] = process.argv.slice(2);
if (root && book && name) {
  const folder = join(root, 'books', book, 'items', name);
  const item = YAML.parse(readFileSync(join(folder, 'item.yaml'), 'utf8'));
  const workflow = YAML.parse(readFileSync(join(root, 'workflows', item.workflow + '.yaml'), 'utf8'));
  const dir = join(folder, item.params.narration);
  mkdirSync(dir, { recursive: true });
  const manifestFile = join(dir, 'manifest.json');
  const old = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
  const byHash = {};
  Object.entries(old).forEach(([f, m]) => { if (existsSync(join(dir, f))) byHash[m.hash] = f; });
  const manifest = {}, keep = new Set();
  for (const line of spokenLines(workflow, item)) {
    const spoken = line.say ?? line.text;
    const hash = createHash('sha256').update(`${VOICE}|${PACKAGE}|${spoken}`).digest('hex').slice(0, 16);
    manifest[line.file] = { path: line.path, text: line.text, hash };
    keep.add(line.file);
    if (old[line.file]?.hash === hash && existsSync(join(dir, line.file))) continue;
    if (byHash[hash]) {
      copyFileSync(join(dir, byHash[hash]), join(dir, line.file));
      console.log(`reused ${byHash[hash]} as ${line.file}`);
      continue;
    }
    execFileSync('uvx', ['--python', '3.12', PACKAGE, '--voice', VOICE, '--text', spoken, '--write-media', join(dir, line.file)], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(`recorded ${line.file}  ${line.text}`);
  }
  for (const f of readdirSync(dir)) if (f.endsWith('.mp3') && !keep.has(f)) { unlinkSync(join(dir, f)); console.log(`removed ${f}`); }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${Object.keys(manifest).length} lines in ${manifestFile}`);
}
