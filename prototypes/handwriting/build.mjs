// Builds dist/handwriting-lab.html: page.html with every script and the model
// weights inlined, and the gzip size of what each recogniser would add to a page.
// Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

const weights = JSON.parse(read("model/weights.json"));
delete weights.probe;
const weightsJs = `HW.WEIGHTS = ${JSON.stringify(weights)};`;

const shared = ["src/segment.js", "src/recognise.js"].map(read).join("\n");
const pdollar = shared + ["src/templates.js", "src/pdollar.js"].map(read).join("\n");
const cnn = shared + read("src/cnn.js") + weightsJs;
const gz = (s) => gzipSync(Buffer.from(s, "utf8"), { level: 9 }).length;
const sizes = { pdollar: gz(pdollar), cnn: gz(cnn) };

const scripts = [
  "window.HW = window.HW || {};",
  ...["src/segment.js", "src/recognise.js", "src/templates.js", "src/pdollar.js", "src/cnn.js"].map(read),
  weightsJs,
  `HW.SIZES = ${JSON.stringify(sizes)};`,
  read("src/app.js"),
]
  .join("\n")
  .replaceAll("</script", "<\\/script");

const page = read("page.html").replace("<!-- SCRIPTS -->", () => `<script>\n${scripts}\n</script>`);
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/handwriting-lab.html"), page);
console.log(JSON.stringify({ sizes, pageBytes: Buffer.byteLength(page) }));
