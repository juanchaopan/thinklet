// A small convolutional network (two 3x3 convolutions, two dense layers)
// trained on MNIST and EMNIST, run in plain JavaScript: no WebAssembly, no
// eval, nothing fetched at run time. Weights ship as int8 with one scale per
// tensor. Strokes are rasterised to 28x28 the same way the training images
// were normalised: the ink fits a 20x20 box, aspect kept, centred.
(function (g) {
  const HW = (g.HW = g.HW || {});
  const SIZE = 28, BOX = 20, LINE = 2.2;

  function decode(base64) {
    const bin = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
    const out = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
    return out;
  }

  function dequantise(w) {
    const q = decode(w.q);
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) out[i] = q[i] * w.scale;
    return out;
  }

  function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function rasterise(strokes) {
    let b = null;
    for (const s of strokes) {
      const sb = HW.bounds(s);
      b = b ? { minX: Math.min(b.minX, sb.minX), minY: Math.min(b.minY, sb.minY), maxX: Math.max(b.maxX, sb.maxX), maxY: Math.max(b.maxY, sb.maxY) } : sb;
    }
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const scale = Math.max(w, h) > 0 ? (BOX - LINE) / Math.max(w, h) : 1;
    const ox = (SIZE - w * scale) / 2, oy = (SIZE - h * scale) / 2;
    const segs = [];
    for (const s of strokes) {
      const pts = [];
      for (let i = 0; i < s.length; i += 2) pts.push((s[i] - b.minX) * scale + ox, (s[i + 1] - b.minY) * scale + oy);
      if (pts.length === 2) pts.push(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) segs.push(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
    }
    const img = new Float32Array(SIZE * SIZE);
    const r = LINE / 2;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let d = Infinity;
        for (let k = 0; k < segs.length; k += 4) {
          const dk = segmentDistance(x + 0.5, y + 0.5, segs[k], segs[k + 1], segs[k + 2], segs[k + 3]);
          if (dk < d) d = dk;
        }
        const v = r + 0.5 - d;
        img[y * SIZE + x] = v <= 0 ? 0 : v >= 1 ? 1 : v;
      }
    }
    return img;
  }

  function conv3x3Relu(input, cin, size, weight, bias) {
    const cout = bias.length;
    const out = new Float32Array(cout * size * size);
    for (let o = 0; o < cout; o++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let sum = bias[o];
          for (let c = 0; c < cin; c++) {
            const wBase = (o * cin + c) * 9, iBase = c * size * size;
            for (let ky = -1; ky <= 1; ky++) {
              const yy = y + ky;
              if (yy < 0 || yy >= size) continue;
              for (let kx = -1; kx <= 1; kx++) {
                const xx = x + kx;
                if (xx < 0 || xx >= size) continue;
                sum += input[iBase + yy * size + xx] * weight[wBase + (ky + 1) * 3 + kx + 1];
              }
            }
          }
          out[(o * size + y) * size + x] = sum > 0 ? sum : 0;
        }
      }
    }
    return out;
  }

  function maxPool2(input, channels, size) {
    const half = size / 2;
    const out = new Float32Array(channels * half * half);
    for (let c = 0; c < channels; c++) {
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < half; x++) {
          const i = c * size * size + y * 2 * size + x * 2;
          out[(c * half + y) * half + x] = Math.max(input[i], input[i + 1], input[i + size], input[i + size + 1]);
        }
      }
    }
    return out;
  }

  function dense(input, weight, bias, relu) {
    const n = bias.length, m = input.length;
    const out = new Float32Array(n);
    for (let o = 0; o < n; o++) {
      let sum = bias[o];
      const base = o * m;
      for (let i = 0; i < m; i++) sum += input[i] * weight[base + i];
      out[o] = relu && sum < 0 ? 0 : sum;
    }
    return out;
  }

  function Network(weights) {
    this.classes = weights.classes;
    this.layers = {};
    for (const [name, layer] of Object.entries(weights.layers)) {
      this.layers[name] = { w: dequantise(layer.w), b: Float32Array.from(layer.b) };
    }
  }

  Network.prototype.logits = function (img) {
    const L = this.layers;
    let x = maxPool2(conv3x3Relu(img, 1, 28, L.c1.w, L.c1.b), 16, 28);
    x = maxPool2(conv3x3Relu(x, 16, 14, L.c2.w, L.c2.b), 32, 14);
    x = dense(x, L.f1.w, L.f1.b, true);
    return dense(x, L.f2.w, L.f2.b, false);
  };

  // Probabilities over the allowed labels only, most likely first.
  Network.prototype.recognise = function (strokes, allowed) {
    const logits = this.logits(rasterise(strokes));
    const idx = this.classes.map((c, i) => i).filter((i) => !allowed || allowed.includes(this.classes[i]));
    if (!idx.length) return { label: "?", ranked: [] };
    const max = Math.max(...idx.map((i) => logits[i]));
    const exps = idx.map((i) => Math.exp(logits[i] - max));
    const total = exps.reduce((a, b) => a + b, 0);
    const ranked = idx.map((i, k) => ({ label: this.classes[i], score: exps[k] / total })).sort((a, b) => b.score - a.score);
    return { label: ranked[0].label, ranked };
  };

  HW.rasterise = rasterise;
  HW.Network = Network;
})(globalThis);
