// The $P point-cloud recogniser (Vatavu, Anthony and Wobbrock, 2012; BSD
// licence), written from the published algorithm. A symbol is resampled to
// 32 points, scaled and centred, and compared with every template as an
// unordered cloud, so stroke order, direction and count do not matter.
(function (g) {
  const HW = (g.HW = g.HW || {});
  const N = 32;

  function pathLength(stroke) {
    let d = 0;
    for (let i = 2; i < stroke.length; i += 2) d += Math.hypot(stroke[i] - stroke[i - 2], stroke[i + 1] - stroke[i - 1]);
    return d;
  }

  function resample(strokes) {
    const total = strokes.reduce((sum, s) => sum + pathLength(s), 0);
    const out = [];
    if (total === 0) {
      const s = strokes[0];
      for (let i = 0; i < N; i++) out.push(s[0], s[1]);
      return out;
    }
    const step = total / (N - 1);
    let carried = 0;
    for (const s of strokes) {
      if (s.length < 4) continue;
      let px = s[0], py = s[1];
      if (out.length === 0) out.push(px, py);
      for (let i = 2; i < s.length; i += 2) {
        let qx = s[i], qy = s[i + 1];
        let d = Math.hypot(qx - px, qy - py);
        while (carried + d >= step && out.length < N * 2) {
          const t = (step - carried) / d;
          px = px + t * (qx - px);
          py = py + t * (qy - py);
          out.push(px, py);
          d = Math.hypot(qx - px, qy - py);
          carried = 0;
        }
        carried += d;
        px = qx;
        py = qy;
      }
    }
    const last = strokes[strokes.length - 1];
    while (out.length < N * 2) out.push(last[last.length - 2], last[last.length - 1]);
    return out;
  }

  function normalise(strokes) {
    const pts = resample(strokes);
    const b = HW.bounds(pts);
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
    let cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i += 2) {
      pts[i] = (pts[i] - b.minX) / size;
      pts[i + 1] = (pts[i + 1] - b.minY) / size;
      cx += pts[i];
      cy += pts[i + 1];
    }
    cx /= N;
    cy /= N;
    const out = new Float64Array(N * 2);
    for (let i = 0; i < N * 2; i += 2) {
      out[i] = pts[i] - cx;
      out[i + 1] = pts[i + 1] - cy;
    }
    return out;
  }

  const matched = new Uint8Array(N);

  function cloudDistance(a, b, start) {
    matched.fill(0);
    let sum = 0, i = start;
    do {
      let best = Infinity, index = 0;
      const ax = a[i * 2], ay = a[i * 2 + 1];
      for (let j = 0; j < N; j++) {
        if (matched[j]) continue;
        const dx = ax - b[j * 2], dy = ay - b[j * 2 + 1];
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          index = j;
        }
      }
      matched[index] = 1;
      sum += (1 - ((i - start + N) % N) / N) * Math.sqrt(best);
      i = (i + 1) % N;
    } while (i !== start);
    return sum;
  }

  function greedyMatch(points, template, ceiling) {
    const step = Math.floor(Math.pow(N, 0.5));
    let min = ceiling;
    for (let i = 0; i < N; i += step) {
      min = Math.min(min, cloudDistance(points, template, i), cloudDistance(template, points, i));
    }
    return min;
  }

  function Recogniser(templates) {
    this.templates = templates.map((t) => ({ label: t.label, cloud: normalise(t.strokes) }));
  }

  Recogniser.prototype.add = function (label, strokes) {
    this.templates.push({ label, cloud: normalise(strokes) });
  };

  // Best distance per label among the allowed labels, closest first.
  Recogniser.prototype.recognise = function (strokes, allowed) {
    const cloud = normalise(strokes);
    const best = new Map();
    for (const t of this.templates) {
      if (allowed && !allowed.includes(t.label)) continue;
      const d = greedyMatch(cloud, t.cloud, best.get(t.label) ?? Infinity);
      if (d < (best.get(t.label) ?? Infinity)) best.set(t.label, d);
    }
    const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([label, d]) => ({ label, score: Math.max(0, (2 - d) / 2) }));
    return { label: ranked.length ? ranked[0].label : "?", ranked };
  };

  HW.PDollar = Recogniser;
})(globalThis);
