// Offline evaluation with the same recognisers the page runs.
// Usage:
//   node eval.mjs check                 compare JS inference with the PyTorch probe logits
//   node eval.mjs samples <file.json>   score collected samples (a JSON array of sample bodies)
// For samples it reports, per device, writer and answer type:
//   cnn          the small model
//   pdollar      $P with the hand-made templates only
//   pdollar+     $P with the hand-made templates plus every other collected
//                symbol as a template (leave one sample out), which estimates
//                $P once real children's handwriting is shipped as templates
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
for (const f of ["segment.js", "recognise.js", "templates.js", "pdollar.js", "cnn.js"]) {
  (0, eval)(readFileSync(join(root, "src", f), "utf8"));
}
const HW = globalThis.HW;
const weights = JSON.parse(readFileSync(join(root, "model/weights.json"), "utf8"));
const net = new HW.Network(weights);

function check() {
  let worst = 0, agree = 0;
  weights.probe.inputs.forEach((rows, k) => {
    const js = net.logits(Float32Array.from(rows.flat()));
    const py = weights.probe.logits[k];
    worst = Math.max(worst, ...py.map((v, i) => Math.abs(v - js[i])));
    const argmax = (a) => a.indexOf(Math.max(...a));
    if (argmax([...js]) === argmax(py)) agree++;
  });
  console.log(`probe: ${agree}/${weights.probe.inputs.length} same class, largest logit difference ${worst.toFixed(3)}`);
}

const SHOW_BACK = { "♯": "#", "♭": "b" };
const symbolsOf = (target, mode) =>
  [...target].map((ch) => SHOW_BACK[ch] ?? ch).map((ch) => (mode === "roman" && ch === "I" ? "I" : ch));

function scoreSamples(file) {
  const samples = JSON.parse(readFileSync(file, "utf8"));
  const base = HW.templateStrokes();
  // Every collected symbol whose segmentation matches its target, labelled.
  const collected = samples.map((s, index) => {
    const groups = HW.segment(s.strokes);
    const labels = symbolsOf(s.target, s.mode);
    return groups.length === labels.length ? groups.map((g, i) => ({ index, label: labels[i], strokes: g })) : [];
  });
  const rows = new Map();
  const add = (key, method, ok, segOk) => {
    const r = rows.get(key) || { n: 0, seg: 0, cnn: 0, pdollar: 0, "pdollar+": 0 };
    if (method === "cnn") {
      r.n++;
      r.seg += segOk ? 1 : 0;
    }
    r[method] += ok ? 1 : 0;
    rows.set(key, r);
  };
  samples.forEach((s, index) => {
    const keys = ["all", `${s.device.kind}`, `${s.device.kind} · ${s.writer} · ${s.mode}`];
    const segOk = HW.segment(s.strokes).length === [...s.target].length;
    const plus = new HW.PDollar(base);
    for (const list of collected) for (const t of list) if (t.index !== index) plus.add(t.label, t.strokes);
    const results = {
      cnn: HW.recogniseAnswer(net, s.strokes, s.mode).text,
      pdollar: HW.recogniseAnswer(new HW.PDollar(base), s.strokes, s.mode).text,
      "pdollar+": HW.recogniseAnswer(plus, s.strokes, s.mode).text,
    };
    for (const key of keys) for (const [m, text] of Object.entries(results)) add(key, m, text === s.target, segOk);
  });
  const pct = (a, n) => ((100 * a) / n).toFixed(1).padStart(5) + "%";
  console.log("group".padEnd(34), "n".padStart(4), "segment", "   cnn", " $P", "  $P+");
  for (const [key, r] of [...rows.entries()].sort()) {
    console.log(key.padEnd(34), String(r.n).padStart(4), pct(r.seg, r.n), pct(r.cnn, r.n), pct(r.pdollar, r.n), pct(r["pdollar+"], r.n));
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "check") check();
else if (cmd === "samples") scoreSamples(arg);
else console.log("usage: node eval.mjs check | samples <file.json>");
