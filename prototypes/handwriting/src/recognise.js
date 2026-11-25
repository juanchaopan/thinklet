// Turns the strokes of one answer into text for an answer type.
// The answer type limits which symbols are possible: a number field only
// accepts digits, a Roman numeral field only I and V. That restriction is
// what keeps both recognisers accurate with so few classes to tell apart.
(function (g) {
  const HW = (g.HW = g.HW || {});

  HW.MODES = {
    digits: { name: "数字", labels: "0123456789".split(""), show: {} },
    roman: { name: "罗马数字", labels: ["1", "I", "V"], show: { 1: "I" } },
    notes: { name: "音名", labels: ["A", "B", "C", "D", "E", "F", "G", "#", "b"], show: { "#": "♯", b: "♭" } },
  };

  HW.recogniseAnswer = function recogniseAnswer(recogniser, strokes, mode) {
    const t0 = (g.performance || Date).now();
    const spec = HW.MODES[mode];
    const symbols = HW.segment(strokes).map((group) => recogniser.recognise(group, spec.labels));
    const text = symbols.map((s) => spec.show[s.label] ?? s.label).join("");
    const ms = (g.performance || Date).now() - t0;
    return { text, ms, symbols };
  };
})(globalThis);
