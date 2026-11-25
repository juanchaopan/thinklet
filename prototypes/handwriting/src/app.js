// The test page: an answer demo with the handwriting panel, sample collection
// stored in the artifact's shared store, and recognition rates per device.
(function () {
  const HW = window.HW;
  const $ = (id) => document.getElementById(id);
  const local = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage blocked: the preference lasts for this visit only */
      }
    },
  };

  // Touch-first browsers open the panel when an answer needs writing;
  // keyboard-and-mouse browsers keep it closed until the button is pressed.
  const touchFirst = matchMedia("(pointer: coarse)").matches;
  const deviceKind = touchFirst ? (Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet") : "desktop";
  const KIND_NAMES = { phone: "手机", tablet: "平板", desktop: "电脑" };
  const METHODS = {
    cnn: { name: "小模型", recogniser: new HW.Network(HW.WEIGHTS) },
    pdollar: { name: "笔画模板", recogniser: new HW.PDollar(HW.templateStrokes()) },
  };

  function chip(label, value) {
    const span = document.createElement("span");
    span.className = "chip";
    span.append(label + "：");
    const b = document.createElement("b");
    b.textContent = value;
    span.append(b);
    return span;
  }
  $("device").append(
    chip("设备", KIND_NAMES[deviceKind]),
    chip("主要输入", touchFirst ? "触屏" : "键盘和鼠标"),
    chip("手写面板默认", touchFirst ? "打开" : "收起"),
  );

  class Pad {
    constructor(canvas, hint, onStroke) {
      this.canvas = canvas;
      this.hint = hint;
      this.ctx = canvas.getContext("2d");
      this.strokes = [];
      this.pointerTypes = new Set();
      this.pointer = null;
      this.onStroke = onStroke;
      this.frame = 0;
      new ResizeObserver(() => this.resize()).observe(canvas);
      canvas.addEventListener("pointerdown", (e) => this.down(e));
      canvas.addEventListener("pointermove", (e) => this.move(e));
      canvas.addEventListener("pointerup", (e) => this.up(e));
      canvas.addEventListener("pointercancel", (e) => this.up(e));
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.schedule());
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    }
    pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    down(e) {
      if (this.pointer !== null) return;
      e.preventDefault();
      this.pointer = e.pointerId;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a convenience; drawing works without it */
      }
      this.pointerTypes.add(e.pointerType || "mouse");
      this.current = this.pos(e);
      this.strokes.push(this.current);
      this.schedule();
    }
    move(e) {
      if (e.pointerId !== this.pointer) return;
      e.preventDefault();
      const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = this.pos(ev);
        const n = this.current.length;
        if (Math.hypot(x - this.current[n - 2], y - this.current[n - 1]) >= 1) this.current.push(x, y);
      }
      this.schedule();
    }
    up(e) {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      this.current = null;
      this.schedule();
      this.onStroke();
    }
    undo() {
      this.strokes.pop();
      this.schedule();
      this.onStroke();
    }
    clear() {
      this.strokes = [];
      this.pointerTypes.clear();
      this.schedule();
      this.onStroke();
    }
    schedule() {
      if (!this.frame) this.frame = requestAnimationFrame(() => ((this.frame = 0), this.draw()));
    }
    draw() {
      const css = getComputedStyle(document.documentElement);
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = css.getPropertyValue("--guide");
      ctx.lineWidth = 1;
      for (const [y, dashed] of [[0.16, true], [0.48, true], [0.8, false]]) {
        ctx.setLineDash(dashed ? [6, 6] : []);
        ctx.beginPath();
        ctx.moveTo(12, Math.round(h * y) + 0.5);
        ctx.lineTo(w - 12, Math.round(h * y) + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = css.getPropertyValue("--ink");
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of this.strokes) {
        if (s.length === 2) {
          ctx.beginPath();
          ctx.arc(s[0], s[1], 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]);
        for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i], s[i + 1]);
        ctx.stroke();
      }
      this.hint.hidden = this.strokes.length > 0;
    }
    snapshot() {
      return this.strokes.map((s) => s.map((v) => Math.round(v * 10) / 10));
    }
  }

  function recogniseAll(strokes, mode) {
    const out = {};
    for (const [key, method] of Object.entries(METHODS)) {
      out[key] = strokes.length ? HW.recogniseAnswer(method.recogniser, strokes, mode) : null;
    }
    return out;
  }

  function debounce(fn, ms) {
    let t = 0;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // ---- tabs, routed on the hash so each view can be linked ----
  const VIEWS = ["try", "collect", "stats"];
  function show(view) {
    if (!VIEWS.includes(view)) view = "try";
    for (const v of VIEWS) {
      $(v).hidden = v !== view;
      $("tab-" + v).setAttribute("aria-selected", String(v === view));
    }
    if (view === "stats") renderStats();
  }
  for (const v of VIEWS) $("tab-" + v).addEventListener("click", () => ((location.hash = v), show(v)));
  addEventListener("hashchange", () => show(location.hash.slice(1)));

  // ---- answer demo ----
  const panel = $("panel");
  const questions = [...document.querySelectorAll(".q")];
  const closedByUser = new Set();
  let activeQ = null;
  let tryResult = null;

  const tryPad = new Pad($("try-pad"), $("try-hint"), debounce(updateTry, 250));
  const chosenMethod = () => (document.querySelector('input[name="use"]:checked') || {}).value || "cnn";

  function updateTry() {
    tryResult = activeQ ? recogniseAll(tryPad.strokes, activeQ.dataset.mode) : null;
    for (const key of Object.keys(METHODS)) {
      const r = tryResult && tryResult[key];
      $("try-" + key).textContent = r ? r.text || "—" : "—";
      $("try-" + key + "-ms").textContent = r ? r.ms.toFixed(1) + " ms" : "";
    }
    for (const row of panel.querySelectorAll(".reading")) row.classList.toggle("chosen", row.dataset.method === chosenMethod());
    $("try-fill").disabled = !(tryResult && tryResult[chosenMethod()] && tryResult[chosenMethod()].text);
  }

  function setInputMode(q, panelOpen) {
    const input = q.querySelector(".answer");
    input.inputMode = panelOpen ? "none" : q.dataset.mode === "digits" ? "numeric" : "text";
  }

  function openPanel(q) {
    activeQ = q;
    q.querySelector(".slot").append(panel);
    panel.hidden = false;
    for (const other of questions) {
      other.classList.toggle("active", other === q);
      other.querySelector(".pen").setAttribute("aria-pressed", String(other === q));
      setInputMode(other, other === q);
    }
    tryPad.clear();
  }

  function closePanel() {
    panel.hidden = true;
    for (const q of questions) {
      q.querySelector(".pen").setAttribute("aria-pressed", "false");
      setInputMode(q, false);
    }
  }

  function activate(q) {
    for (const other of questions) other.classList.toggle("active", other === q);
    if (touchFirst && !closedByUser.has(q) && (panel.hidden || activeQ !== q)) openPanel(q);
    else activeQ = q;
  }

  for (const q of questions) {
    setInputMode(q, false);
    q.querySelector(".answer").addEventListener("focus", () => activate(q));
    q.querySelector(".pen").addEventListener("click", () => {
      if (!panel.hidden && activeQ === q) {
        closedByUser.add(q);
        closePanel();
      } else {
        closedByUser.delete(q);
        openPanel(q);
      }
    });
  }
  $("try-undo").addEventListener("click", () => tryPad.undo());
  $("try-clear").addEventListener("click", () => tryPad.clear());
  for (const radio of document.querySelectorAll('input[name="use"]')) {
    radio.addEventListener("change", () => (local.set("hw-use", radio.value), updateTry()));
  }
  const savedUse = local.get("hw-use", "cnn");
  if ($("use-" + savedUse)) $("use-" + savedUse).checked = true;
  $("try-fill").addEventListener("click", () => {
    const r = tryResult && tryResult[chosenMethod()];
    if (!r || !activeQ) return;
    activeQ.querySelector(".answer").value = r.text;
    tryPad.clear();
  });
  if (touchFirst) openPanel(questions[0]);

  // ---- sample collection ----
  let db = null;
  let samples = [];
  let storeState = "connecting";
  const session = [];
  let lastSaved = null;
  let target = "";
  let digitDeck = [];

  const writer = () => document.querySelector('input[name="writer"]:checked').value;
  const collectMode = () => document.querySelector('input[name="cmode"]:checked').value;

  function nextTarget() {
    const mode = collectMode();
    if (mode === "digits") {
      if (!digitDeck.length) digitDeck = "0123456789".split("").sort(() => Math.random() - 0.5);
      target = Math.random() < 0.35 ? String(10 + Math.floor(Math.random() * 90)) : digitDeck.pop();
    } else if (mode === "roman") {
      target = ["I", "II", "IV", "V"][Math.floor(Math.random() * 4)];
    } else {
      const r = Math.random();
      target = "ABCDEFG"[Math.floor(Math.random() * 7)] + (r < 0.2 ? "♯" : r < 0.4 ? "♭" : "");
    }
    $("target").textContent = target;
    collectPad.clear();
  }

  const collectPad = new Pad($("collect-pad"), $("collect-hint"), () => {
    $("c-submit").disabled = collectPad.strokes.length === 0;
  });

  function verdict(name, r) {
    const span = document.createElement("span");
    const ok = r.text === target;
    span.className = ok ? "ok" : "bad";
    span.textContent = `${name} ${ok ? "✓" : "✗"} ${r.text || "（空）"}`;
    return span;
  }

  async function submitSample() {
    const strokes = collectPad.snapshot();
    if (!strokes.length) return;
    const mode = collectMode();
    const results = recogniseAll(collectPad.strokes, mode);
    const sample = {
      v: 1,
      target,
      mode,
      writer: writer(),
      device: { kind: deviceKind, touchFirst, ua: navigator.userAgent.slice(0, 200) },
      pointer: [...collectPad.pointerTypes].sort().join("+"),
      pad: { w: Math.round(collectPad.canvas.clientWidth), h: Math.round(collectPad.canvas.clientHeight) },
      strokes,
      results: {
        cnn: { text: results.cnn.text, ms: Math.round(results.cnn.ms * 100) / 100 },
        pdollar: { text: results.pdollar.text, ms: Math.round(results.pdollar.ms * 100) / 100 },
      },
      at: Date.now(),
    };
    const line = $("c-result");
    line.replaceChildren(document.createTextNode(`刚才写的“${target}”：`), verdict("小模型", sample.results.cnn), verdict("笔画模板", sample.results.pdollar));
    session.push(sample);
    lastSaved = null;
    if (db) {
      try {
        lastSaved = await db.collection("samples").add(sample);
        const undo = document.createElement("button");
        undo.className = "btn";
        undo.type = "button";
        undo.textContent = "撤回这一条";
        undo.addEventListener("click", withdraw);
        line.append(undo);
      } catch (e) {
        showStoreNote(e && e.code === "quota_exceeded" ? "存储已满，这一条没有保存。" : "这一条没有保存成功，只算在本机这次的统计里。");
      }
    }
    $("c-count").textContent = `这台设备这次已提交 ${session.length} 条。`;
    nextTarget();
    if (!$("stats").hidden) renderStats();
  }

  async function withdraw(e) {
    const ref = lastSaved;
    e.currentTarget.disabled = true;
    if (!ref) return;
    try {
      await ref.delete();
      session.pop();
      lastSaved = null;
      $("c-result").textContent = "已撤回上一条。";
      $("c-count").textContent = `这台设备这次已提交 ${session.length} 条。`;
    } catch {
      showStoreNote("撤回没有成功，请稍后再试。");
    }
  }

  function showStoreNote(text) {
    const note = $("store-note");
    note.textContent = text;
    note.hidden = false;
  }

  $("c-undo").addEventListener("click", () => collectPad.undo());
  $("c-clear").addEventListener("click", () => collectPad.clear());
  $("c-skip").addEventListener("click", nextTarget);
  $("c-submit").addEventListener("click", submitSample);
  for (const radio of document.querySelectorAll('input[name="cmode"]')) radio.addEventListener("change", nextTarget);
  for (const radio of document.querySelectorAll('input[name="writer"]')) radio.addEventListener("change", () => local.set("hw-writer", radio.value));
  const savedWriter = local.get("hw-writer", "adult");
  if ($("w-" + savedWriter)) $("w-" + savedWriter).checked = true;
  nextTarget();

  // ---- recognition rates ----
  function cell(row, text, cls) {
    const td = document.createElement(row.parentElement && row.parentElement.tagName === "THEAD" ? "th" : "td");
    td.textContent = text;
    if (cls) td.className = cls;
    row.append(td);
    return td;
  }

  function table(el, headers, rows) {
    el.replaceChildren();
    const thead = el.createTHead();
    const hr = thead.insertRow();
    headers.forEach((h, i) => cell(hr, h, i ? "num" : ""));
    const body = el.createTBody();
    if (!rows.length) {
      const r = body.insertRow();
      const td = cell(r, "还没有样本。到“采集样本”里写几条。");
      td.colSpan = headers.length;
    }
    for (const values of rows) {
      const r = body.insertRow();
      values.forEach((v, i) => {
        const td = cell(r, v.text ?? v, i ? "num" : "");
        if (v.bar != null) {
          const bar = document.createElement("span");
          bar.className = "bar";
          bar.style.width = Math.round(v.bar * 48) + "px";
          td.append(bar);
        }
      });
    }
  }

  function summarise(list, method) {
    const n = list.length;
    const ok = list.filter((s) => s.results[method].text === s.target).length;
    const ms = list.map((s) => s.results[method].ms).sort((a, b) => a - b);
    return {
      n,
      rate: n ? ok / n : 0,
      avg: n ? ms.reduce((a, b) => a + b, 0) / n : 0,
      p95: n ? ms[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
    };
  }

  const pct = (x) => (x * 100).toFixed(1) + "%";

  function rateRows(groups) {
    const rows = [];
    for (const [label, list] of groups) {
      if (!list.length) continue;
      for (const key of Object.keys(METHODS)) {
        const s = summarise(list, key);
        rows.push([`${label} · ${METHODS[key].name}`, String(s.n), { text: pct(s.rate), bar: s.rate }, s.avg.toFixed(1) + " ms", s.p95.toFixed(1) + " ms"]);
      }
    }
    return rows;
  }

  function renderStats() {
    const list = db && storeState === "live" ? samples : session;
    $("stats-source").textContent =
      db && storeState === "live" ? `共 ${list.length} 条样本，来自所有设备，随新样本实时更新。` : `共享存储暂时连不上，下面只算这台设备这次提交的 ${list.length} 条。`;
    const byKind = ["phone", "tablet", "desktop"].map((k) => [KIND_NAMES[k], list.filter((s) => s.device.kind === k)]);
    table($("t-device"), ["设备 · 办法", "样本", "整题正确", "平均耗时", "95% 耗时"], rateRows(byKind));
    const byMode = [];
    for (const [mode, spec] of Object.entries(HW.MODES)) {
      for (const [w, wn] of [["adult", "大人"], ["child", "孩子"]]) byMode.push([`${spec.name} · ${wn}`, list.filter((s) => s.mode === mode && s.writer === w)]);
    }
    table($("t-mode"), ["类型 · 谁写 · 办法", "样本", "整题正确", "平均耗时", "95% 耗时"], rateRows(byMode));
    const acc = HW.WEIGHTS.testAccuracy || {};
    const costRows = [
      ["笔画模板", HW.SIZES.pdollar, "不需要训练；靠模板"],
      ["小模型", HW.SIZES.cnn, `测试集：数字 ${pct(acc.digits?.accuracy ?? 0)}，罗马数字 ${pct(acc.roman?.accuracy ?? 0)}，音名 A–G ${pct(acc.notes?.accuracy ?? 0)}`],
    ].map(([name, bytes, extra]) => [name, (bytes / 1024).toFixed(1) + " KB", extra]);
    table($("t-cost"), ["办法", "大小（gzip）", "说明"], costRows);
  }

  // The shared store lights up when the viewer grants it; the page works without it.
  (async () => {
    const timer = setTimeout(() => {
      if (storeState === "connecting") {
        storeState = "offline";
        showStoreNote("共享存储暂时连不上：可以继续写，结果只算在这台设备这次的统计里。");
        renderStats();
      }
    }, 10000);
    try {
      db = window.claude && window.claude.use ? await window.claude.use("db") : null;
    } catch {
      db = null;
    }
    if (!db) {
      clearTimeout(timer);
      storeState = "offline";
      showStoreNote("这个页面现在不能保存样本：可以继续写，结果只算在这台设备这次的统计里。");
      renderStats();
      return;
    }
    db.collection("samples").onSnapshot(
      (snap) => {
        if (!snap.metadata.fromCache) clearTimeout(timer);
        storeState = "live";
        $("store-note").hidden = true;
        samples = snap.docs.map((d) => d.data());
        if (!$("stats").hidden) renderStats();
      },
      () => {
        clearTimeout(timer);
        storeState = "offline";
        showStoreNote("共享存储出错了：可以继续写，结果只算在这台设备这次的统计里。");
        renderStats();
      },
    );
  })();

  show(location.hash.slice(1));
})();
