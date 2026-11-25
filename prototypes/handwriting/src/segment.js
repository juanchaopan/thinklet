// Splits the strokes of one answer into symbols, left to right.
// A stroke is a flat array [x0, y0, x1, y1, ...] in pad pixels.
// Strokes whose horizontal extents overlap enough belong to one symbol, so a
// "4", "5" or "7" written in two strokes stays together while "IV" splits.
(function (g) {
  const HW = (g.HW = g.HW || {});

  function bounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i], y = points[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  function union(a, b) {
    return {
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY),
    };
  }

  // Share of the narrower extent that two boxes overlap horizontally.
  function overlapRatio(a, b) {
    const overlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const narrower = Math.max(2, Math.min(a.maxX - a.minX, b.maxX - b.minX));
    return overlap / narrower;
  }

  HW.bounds = bounds;

  HW.segment = function segment(strokes, joinRatio = 0.35) {
    const items = strokes
      .filter((s) => s.length >= 2)
      .map((s) => ({ s, b: bounds(s) }))
      .sort((a, b) => a.b.minX - b.b.minX);
    const groups = [];
    for (const item of items) {
      const last = groups[groups.length - 1];
      if (last && overlapRatio(last.b, item.b) > joinRatio) {
        last.strokes.push(item.s);
        last.b = union(last.b, item.b);
      } else {
        groups.push({ strokes: [item.s], b: item.b });
      }
    }
    return groups.map((group) => group.strokes);
  };
})(globalThis);
