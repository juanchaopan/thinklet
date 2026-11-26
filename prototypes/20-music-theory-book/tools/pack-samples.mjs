// Packs a folder of per-note MP3 samples (named like C4.mp3, Eb4.mp3) into one
// JSON file: { "<midi number>": "<base64 mp3>" }, for a prototype page that
// can only fetch files published next to it.
// Usage: node pack-samples.mjs <sample-dir> <out.json> <lowest-octave> <highest-octave>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , dir, out, lo = '2', hi = '7'] = process.argv;
const SEMITONE = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const packed = {};
for (const file of readdirSync(dir)) {
  const m = /^([A-G]b?)(\d)\.mp3$/.exec(file);
  if (!m) continue;
  const octave = Number(m[2]);
  if (octave < Number(lo) || octave > Number(hi)) continue;
  if (octave === Number(hi) && m[1] !== 'C') continue;
  const midi = 12 * (octave + 1) + SEMITONE[m[1]];
  packed[midi] = readFileSync(join(dir, file)).toString('base64');
}
writeFileSync(out, JSON.stringify(packed));
console.log(Object.keys(packed).length, 'samples');
