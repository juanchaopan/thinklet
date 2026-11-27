// Writes a silent MP3 for every line in a narration lines file, as long as
// the line would take to say at a normal Chinese speaking pace, so a
// prototype can run its narration timing before the real recordings exist.
// Usage: node placeholder-narration.mjs <lines.json>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHARS_PER_SECOND = 4.3;
const LEAD_SECONDS = 0.5;
const MIN_SECONDS = 1.6;

const file = process.argv[2];
const dir = dirname(file);
const { lines } = JSON.parse(readFileSync(file, 'utf8'));
for (const line of lines) {
  const spoken = line.text.replace(/[\s，。：、！？；,.:!?]/g, '');
  const seconds = Math.max(MIN_SECONDS, spoken.length / CHARS_PER_SECOND + LEAD_SECONDS).toFixed(2);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', seconds, '-c:a', 'libmp3lame', '-b:a', '32k', join(dir, `${line.id}.mp3`)]);
  console.log(`${line.id}.mp3 ${seconds}s`);
}
