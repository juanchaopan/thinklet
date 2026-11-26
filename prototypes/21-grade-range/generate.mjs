// Generates the prototype's original artwork with the OpenAI Images API.
// The API key is read from a file outside the repository and only placed in
// the request header; it is never printed or written anywhere.
//
// An item with a `reference` image is drawn from that image through the edits
// endpoint, so a character keeps the same look in every pose.
//
// Usage:
//   node generate.mjs models                 list the image models the key can use
//   node generate.mjs <model> [name ...]     generate the named items of ART_LIST (all when none named)
//
// Environment: OPENAI_API_KEY_FILE overrides the key file
// (default ~/.secrets/openai-api-key.txt).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { ART_LIST } from './src/art-list.mjs';

const keyFile = process.env.OPENAI_API_KEY_FILE ?? join(homedir(), '.secrets', 'openai-api-key.txt');
const key = readFileSync(keyFile, 'utf8').trim();
if (!key) throw new Error(`The key file ${keyFile} is empty.`);
const auth = { Authorization: `Bearer ${key}` };

const MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

const generate = (model, item) =>
  fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: item.prompt,
      size: item.size,
      quality: 'high',
      background: 'transparent',
      output_format: 'png',
      n: 1,
    }),
  });

const edit = (model, item) => {
  const form = new FormData();
  const ext = item.reference.split('.').pop().toLowerCase();
  form.append('image[]', new Blob([readFileSync(item.reference)], { type: MIME[ext] }), basename(item.reference));
  for (const [name, value] of Object.entries({
    model,
    prompt: item.prompt,
    size: item.size,
    quality: 'high',
    background: 'transparent',
    output_format: 'png',
    n: '1',
  })) {
    form.append(name, value);
  }
  return fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: auth, body: form });
};

const [command, ...names] = process.argv.slice(2);

if (command === 'models') {
  const response = await fetch('https://api.openai.com/v1/models', { headers: auth });
  if (!response.ok) throw new Error(`Listing models failed: HTTP ${response.status}`);
  const { data } = await response.json();
  console.log(
    data
      .map((m) => m.id)
      .filter((id) => /image|dall/i.test(id))
      .sort()
      .join('\n'),
  );
} else {
  const model = command;
  const items = names.length ? ART_LIST.filter((a) => names.includes(a.name)) : ART_LIST;
  mkdirSync('art', { recursive: true });
  for (const item of items) {
    const response = await (item.reference ? edit(model, item) : generate(model, item));
    const body = await response.json();
    if (!response.ok) {
      console.error(`${item.name}: HTTP ${response.status} ${body?.error?.message ?? ''}`);
      continue;
    }
    writeFileSync(join('art', item.file), Buffer.from(body.data[0].b64_json, 'base64'));
    const tokens = body.usage?.output_tokens ?? body.usage?.total_tokens ?? '?';
    console.log(`${item.name}: art/${item.file} (output tokens ${tokens})`);
  }
}
