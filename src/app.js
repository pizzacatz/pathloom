// Pathloom: offline diagram editing and tracing.
const DEFAULT_SRC = `flowchart TD
    Start([New workspace request]) --> Review[Mara Vale reviews the request]
    Review --> Account[Find Alderwick Systems in Harbor CRM]
    Account --> Decision{Workspace approved?}
    Decision -->|Yes| Setup[Create a workspace in Lantern Desk]
    Decision -->|Needs information| Followup[Ask the requester for details]
    Followup --> Review
    Setup --> Invite[Invite the project team]
    Invite --> Done([Workspace ready])
`;

const srcEl = document.getElementById("src");
const stage = document.getElementById("stage");
const errEl = document.getElementById("err");
const KEY = "pathloom.source.v1";
const statusEl = document.getElementById("status");
let storageAvailable = true;
let lastRenderedSource = null;
let pendingPreview = false;
let traceState = { current: null, history: [] };
let previousFile = null;
let downloadedSource = null;
const BAKED_SRC = window.__FLOWCHART_SRC__ ?? null;
const VIEWER = !!window.__FLOWCHART_VIEWER__;
const byId = id => document.getElementById(id);
function restoreSource() {
  if (VIEWER) return BAKED_SRC ?? DEFAULT_SRC;
  try {
    localStorage.removeItem("mermaid_studio_src");
    return localStorage.getItem(KEY) ?? DEFAULT_SRC;
  } catch { storageAvailable = false; return DEFAULT_SRC; }
}
function saveSource() {
  if (VIEWER) return;
  try { localStorage.setItem(KEY, srcEl.value); storageAvailable = true; }
  catch { storageAvailable = false; }
  byId("save-status").textContent = storageAvailable ? "Saved in this browser" : "Not saved in this browser · Download source to keep a copy";
  byId("example-note").hidden = srcEl.value !== DEFAULT_SRC;
}
function setStatus(message) { statusEl.textContent = message; }
function clearError() {
  errEl.textContent = "";
  byId("err-details").textContent = "";
  byId("error-box").hidden = true;
}
function showError(error, operation = "render") {
  const detail = String(error?.message || error);
  const line = detail.match(/line\s+(\d+)/i);
  errEl.textContent = (operation === "export" ? "Viewer not exported. " : "Unable to render. ") +
    (VIEWER ? "Ask the author for a corrected viewer." : `Check the Mermaid syntax${line ? " near line " + line[1] : ""}, then try again.`);
  byId("err-details").textContent = detail;
  byId("error-box").hidden = false;
  setStatus(lastRenderedSource === null ? "No preview available" : "Preview is out of date · Showing the last valid diagram");
}
function showView(view) {
  document.body.dataset.view = view;
  byId("source-view").setAttribute("aria-pressed", String(view === "source"));
  byId("preview-view").setAttribute("aria-pressed", String(view === "preview"));
  requestAnimationFrame(resizeCanvas);
}
srcEl.value = restoreSource();
if (VIEWER) { document.body.classList.add("viewer"); document.body.dataset.view = "preview"; }
saveSource();

mermaid.initialize({ startOnLoad:false, theme:"dark", securityLevel:"strict",
  flowchart:{ useMaxWidth:false, htmlLabels:true } });

// ---- persistent frame loop so labels track every pan/zoom, across re-renders ----
let VP = null;
function frame() {
  if (VP && VP.panZoom) {
    try {
      const p = VP.panZoom.getPan(), z = VP.panZoom.getZoom();
      const key = z.toFixed(4) + "|" + Math.round(p.x) + "|" + Math.round(p.y);
      if (key !== VP.lastKey) { VP.lastKey = key; VP.relayout(); }
    } catch (e) { /* ignore between renders */ }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let _panZoom = null, _rid = 0;

async function renderGraph() {
  const src = srcEl.value;
  const requestId = ++_rid;
  saveSource();
  clearError();
  if (!src.trim()) {
    setStatus(lastRenderedSource === null ? "Start a diagram · Enter Mermaid source to see a preview" : "Source is empty · Showing the last valid diagram");
    if (lastRenderedSource === null) stage.innerHTML = '<p class="empty">Start with flowchart TD, then connect two steps: A --> B. Open Help for an example.</p>';
    return false;
  }
  if (!stage.clientWidth || !stage.clientHeight) {
    pendingPreview = true;
    setStatus("Preview will update when opened");
    return false;
  }
  pendingPreview = false;
  setStatus(lastRenderedSource === null ? "Rendering…" : "Rendering… · Previous preview remains visible");

  let svg, graph;
  try {
    // Use Mermaid's parsed graph so chains, labels, and node shapes agree with rendering.
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(src);
    graph = diagram.type.startsWith("flowchart") && typeof diagram.db.getEdges === "function" ? diagram.db.getEdges() : [];
    if (!Array.isArray(graph)) graph = [];
    const res = await mermaid.render("studioGraph" + requestId, src);
    if (requestId !== _rid) return;
    svg = res.svg;
  } catch (e) {
    if (requestId !== _rid) return;
    document.getElementById("dstudioGraph" + requestId)?.remove();
    showError(e);
    return false;
  }

  if (!stage.clientWidth || !stage.clientHeight) { pendingPreview = true; return false; }
  const savedView = captureView();

  VP = null;
  if (_panZoom) { try { _panZoom.destroy(); } catch (e) {} _panZoom = null; }
  stage.innerHTML = svg;
  const svgEl = stage.querySelector("svg");
  if (!svgEl) { errEl.textContent = "No diagram produced."; return; }
  svgEl.removeAttribute("style");
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", "100%");

  const panZoom = svgPanZoom(svgEl, { zoomEnabled:true, panEnabled:true, controlIconsEnabled:false,
    dblClickZoomEnabled:false,
    fit:true, center:true, minZoom:0.2, maxZoom:12, zoomScaleSensitivity:0.35 });
  _panZoom = panZoom;
  if (savedView) restoreView(savedView);
  lastRenderedSource = src;
  setStatus("Preview up to date");
  ["zin", "zout", "fit", "onehundred"].forEach(id => byId(id).disabled = false);

  // double-click normalizes to 100% at the pointer -- never past 100%, no compounding
  stage.ondblclick = (ev) => {
    ev.preventDefault();
    try {
      const rz = panZoom.getSizes().realZoom;
      if (rz > 0) panZoom.zoomAtPoint(panZoom.getZoom() / rz, { x: ev.clientX, y: ev.clientY });
    } catch (e) {}
  };

  const succ = Object.create(null);
  const nodeEls = Object.create(null);
  stage.querySelectorAll("g.node").forEach(g => {
    const k = (g.id || "").replace(/^flowchart-/, "").replace(/-\d+$/, "");
    if (k) nodeEls[k] = g;
  });
  const edgeEls = Array.from(stage.querySelectorAll("g.edgePaths path"));
  const tracedEdges = [];
  for (const edge of graph) {
    const { start, end } = edge;
    if (!nodeEls[start] || !nodeEls[end]) continue;
    const paths = edgeEls.filter(p => p.classList.contains("LS-" + start) && p.classList.contains("LE-" + end));
    if (!paths.length) continue;
    if (!succ[start]) succ[start] = [];
    if (!succ[start].includes(end)) succ[start].push(end);
    paths.forEach(path => { if (!tracedEdges.some(e => e.path === path)) tracedEdges.push({ start, end, path }); });
  }
  const findEdges = (s, t) => tracedEdges.filter(e => e.start === s && e.end === t).map(e => e.path);

  // ---- adaptive edge labels ----
  const viewport = stage.querySelector(".svg-pan-zoom_viewport");
  const labelEls = Array.from(stage.querySelectorAll("g.edgeLabels g.edgeLabel"));
  const edgeLabelData = (viewport && labelEls.length === edgeEls.length)
    ? edgeEls.map((path, i) => { try { const len = path.getTotalLength(); if (!len) return null;
        return { el: labelEls[i], path: path, len: len }; } catch (e) { return null; } }).filter(Boolean)
    : [];

  function visibleContentRect() {
    const ctm = viewport.getScreenCTM(), inv = ctm.inverse(), sr = stage.getBoundingClientRect();
    const cs = [[sr.left,sr.top],[sr.right,sr.top],[sr.right,sr.bottom],[sr.left,sr.bottom]];
    const xs = [], ys = [];
    for (const c of cs) { const pt = svgEl.createSVGPoint(); pt.x = c[0]; pt.y = c[1];
      const q = pt.matrixTransform(inv); xs.push(q.x); ys.push(q.y); }
    return { minX:Math.min.apply(0,xs), maxX:Math.max.apply(0,xs),
             minY:Math.min.apply(0,ys), maxY:Math.max.apply(0,ys), scale: ctm.a };
  }
  function inRect(pt, R) { return pt.x >= R.minX && pt.x <= R.maxX && pt.y >= R.minY && pt.y <= R.maxY; }
  function relayoutLabels() {
    if (!edgeLabelData.length) return;
    const z = panZoom.getZoom();
    if (z <= 1.0001) {
      for (const d of edgeLabelData) { const m = d.path.getPointAtLength(0.5 * d.len);
        d.el.setAttribute("transform", "translate(" + m.x + "," + m.y + ")"); }
      return;
    }
    const R = visibleContentRect();
    const minLen = 55 / (R.scale || 1);
    const STEPS = 48;
    for (const d of edgeLabelData) {
      const len = d.len; let f;
      const src0 = d.path.getPointAtLength(0);
      if (!inRect(src0, R)) { f = 0.5; }
      else {
        let fExit = 1;
        for (let k = 1; k <= STEPS; k++) { const u = k / STEPS;
          if (!inRect(d.path.getPointAtLength(u * len), R)) { fExit = (k - 1) / STEPS; break; } }
        f = 0.5 * fExit;
        const minF = Math.min(minLen / len, fExit);
        if (f < minF) f = minF;
      }
      const pt = d.path.getPointAtLength(f * len);
      d.el.setAttribute("transform", "translate(" + pt.x + "," + pt.y + ")");
    }
  }

  // ---- highlight + centering ----
  function clearHL() {
    stage.querySelectorAll(".hl-cur,.hl-next,.hl-edge,.dim")
      .forEach(e => e.classList.remove("hl-cur","hl-next","hl-edge","dim"));
  }
  function centerOn(el) {
    try {
      const sr = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
      const dx = (sr.left + sr.width/2) - (r.left + r.width/2);
      const dy = (sr.top + sr.height/2) - (r.top + r.height/2);
      const ctm = svgEl.getScreenCTM();
      panZoom.panBy({ x: dx / ctm.a, y: dy / ctm.d });
    } catch (e) {}
  }
  function focus(key, center = true) {
    if (!nodeEls[key]) return;
    clearHL();
    Object.values(nodeEls).forEach(e => e.classList.add("dim"));
    edgeEls.forEach(e => e.classList.add("dim"));
    const cur = nodeEls[key];
    cur.classList.remove("dim"); cur.classList.add("hl-cur");
    (succ[key] || []).forEach(t => {
      if (nodeEls[t]) { nodeEls[t].classList.remove("dim"); nodeEls[t].classList.add("hl-next"); }
      findEdges(key, t).forEach(ed => { ed.classList.remove("dim"); ed.classList.add("hl-edge"); });
    });
    Object.entries(nodeEls).forEach(([id, node]) => node.setAttribute("aria-pressed", String(id === key)));
    if (center) centerOn(cur);
  }

  // ---- stepper ----
  let current = nodeEls[traceState.current] ? traceState.current : null;
  const history = traceState.history.filter(key => nodeEls[key]);
  const picker = byId("step-picker");
  picker.replaceChildren(new Option("Select a step", ""));
  Object.entries(nodeEls).forEach(([key, node]) => picker.add(new Option(node.textContent.trim() || key, key)));
  picker.disabled = !Object.keys(nodeEls).length;
  picker.onchange = () => { if (picker.value) go(picker.value); };
  function updateTraceControls() {
    traceState = { current, history: [...history] };
    byId("back").disabled = history.length === 0;
    const outs = succ[current] || [];
    byId("next").disabled = current ? outs.length !== 1 : !Object.keys(nodeEls).length;
    byId("reset").disabled = !current;
    picker.value = current || "";
    byId("trace-status").textContent = !current
      ? (Object.keys(nodeEls).length ? "Select a step to begin." : "This diagram has no traceable flowchart steps.")
      : "Current step: " + (nodeEls[current].textContent.trim() || current) + (outs.length > 1 ? " · Choose a branch below." : outs.length === 0 ? " · End of path." : " · Next step available.");
    const branches = byId("branches");
    const hadBranchFocus = branches.contains(document.activeElement);
    branches.replaceChildren();
    outs.forEach(target => {
      const button = document.createElement("button");
      const labels = graph.filter(edge => edge.start === current && edge.end === target).map(edge => String(edge.text || "").replace(/<[^>]*>/g, "")).filter(Boolean);
      button.textContent = (labels.length ? [...new Set(labels)].join(" / ") + ": " : "Next: ") + (nodeEls[target].textContent.trim() || target);
      button.onclick = () => go(target);
      branches.appendChild(button);
    });
    if (hadBranchFocus) (branches.querySelector("button") || picker).focus();
  }
  function go(key, record) { if (!nodeEls[key]) return;
    if (record !== false && current && current !== key) history.push(current);
    current = key; focus(key); updateTraceControls(); }
  function stepNext() { if (!current) { const first = nodeEls.Start ? "Start" : Object.keys(nodeEls)[0]; if (first) go(first); return; }
    const outs = succ[current] || []; if (outs.length === 1) go(outs[0]); }
  function stepBack() { if (history.length) go(history.pop(), false); }

  Object.entries(nodeEls).forEach(([k, g]) => {
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-pressed", String(k === current));
    g.setAttribute("aria-label", "Trace " + (g.textContent.trim() || k));
    g.addEventListener("click", ev => { ev.stopPropagation(); go(k); });
    g.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(k); }
    });
  });
  const aligned = labelEls.length === edgeEls.length;
  edgeEls.forEach((p, i) => {
    const hit = tracedEdges.find(e => e.path === p);
    if (!hit) return;
    const jump = ev => { ev.stopPropagation(); go(hit.end); };
    p.addEventListener("click", jump);
    if (aligned && labelEls[i]) labelEls[i].addEventListener("click", jump);
  });

  document.getElementById("zin").onclick   = () => panZoom.zoomIn();
  document.getElementById("zout").onclick  = () => panZoom.zoomOut();
  document.getElementById("fit").onclick   = () => { panZoom.resize(); panZoom.fit(); panZoom.center(); };
  document.getElementById("onehundred").onclick = () => {
    const rz = panZoom.getSizes().realZoom;
    if (rz > 0) panZoom.zoomBy(1 / rz);
    if (current && nodeEls[current]) centerOn(nodeEls[current]);
  };
  document.getElementById("back").onclick  = () => stepBack();
  document.getElementById("next").onclick  = () => stepNext();
  document.getElementById("reset").onclick = () => { clearHL(); current = null; history.length = 0;
    Object.values(nodeEls).forEach(node => node.setAttribute("aria-pressed", "false")); updateTraceControls(); };
  document.onkeydown = ev => {
    if (!stage.contains(document.activeElement)) return;   // don't hijack typing in the editor
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") { ev.preventDefault(); stepNext(); }
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") { ev.preventDefault(); stepBack(); }
  };

  VP = { panZoom: panZoom, relayout: relayoutLabels, lastKey: "" };
  try { relayoutLabels(); } catch { /* Optional geometry enhancement. */ }
  if (current) focus(current, false);
  updateTraceControls();
  return true;
}

// Preserve the content point at the canvas center, including when its size changes.
function captureView() {
  if (!_panZoom) return null;
  const { width, height, realZoom } = _panZoom.getSizes();
  if (!realZoom || !width || !height) return null;
  const pan = _panZoom.getPan();
  return { scale: realZoom, x: (width / 2 - pan.x) / realZoom, y: (height / 2 - pan.y) / realZoom };
}
function restoreView(view) {
  const sizes = _panZoom.getSizes();
  if (sizes.realZoom > 0) _panZoom.zoomBy(view.scale / sizes.realZoom);
  _panZoom.pan({ x: sizes.width / 2 - view.x * view.scale, y: sizes.height / 2 - view.y * view.scale });
}
function resizeCanvas() {
  if (pendingPreview && stage.clientWidth && stage.clientHeight) { clearTimeout(_typeTimer); renderGraph(); return; }
  if (!_panZoom || !stage.clientWidth || !stage.clientHeight) return;
  const view = captureView();
  _panZoom.resize();
  if (view) restoreView(view);
}
byId("render").onclick = () => { clearTimeout(_typeTimer); renderGraph(); };
byId("toggle").onclick = () => {
  const hidden = byId("editor").classList.toggle("hidden");
  byId("toggle").setAttribute("aria-expanded", String(!hidden));
  byId("toggle").textContent = hidden ? "Show source" : "Hide source";
  resizeCanvas();
};
byId("source-view").onclick = () => {
  byId("editor").classList.remove("hidden");
  byId("toggle").setAttribute("aria-expanded", "true");
  byId("toggle").textContent = "Hide source";
  showView("source");
};
byId("preview-view").onclick = () => showView("preview");
byId("help-toggle").onclick = () => {
  byId("help").hidden = !byId("help").hidden;
  byId("help-toggle").setAttribute("aria-expanded", String(!byId("help").hidden));
  resizeCanvas();
};
function download(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
let exporting = false;
byId("export").onclick = async () => {
  if (exporting) return;
  exporting = true;
  byId("export").disabled = true;
  byId("export").textContent = "Validating…";
  const source = srcEl.value;
  try {
    if (!source.trim()) throw new Error("Enter a Mermaid diagram before exporting.");
    // Validate actual renderability, not just parseability. Mermaid serializes renders.
    const id = "exportCheck" + Date.now();
    try { await mermaid.render(id, source); }
    finally { document.getElementById("d" + id)?.remove(); }
    if (source !== srcEl.value) { setStatus("Source changed during validation · Export again when ready"); return; }
    const clone = document.documentElement.cloneNode(true);
    clone.querySelector("body").classList.add("viewer");
    clone.querySelector("body").dataset.view = "preview";
    clone.querySelector("#stage").replaceChildren();
    clone.querySelector("#src").textContent = "";
    clone.querySelector("#file-status").textContent = "";
    clone.querySelector("#save-status").textContent = "";
    clone.querySelector("#status").textContent = "Loading…";
    clone.querySelector("#error-box").hidden = true;
    clone.querySelector("#err").textContent = "";
    clone.querySelector("#err-details").textContent = "";
    clone.querySelector("#branches").replaceChildren();
    clone.querySelector("#step-picker").replaceChildren();
    clone.querySelector("#trace-status").textContent = "Select a step to begin.";
    const flag = document.createElement("script");
    flag.textContent = "window.__FLOWCHART_VIEWER__=true;window.__FLOWCHART_SRC__=" + JSON.stringify(source).replace(/</g, "\\u003c") + ";";
    clone.querySelector("head").appendChild(flag);
    download("<!DOCTYPE html>\n" + clone.outerHTML, "text/html", "flowchart.html");
    setStatus(source === lastRenderedSource ? "Viewer download started · Preview up to date" : "Viewer download started · Preview update pending");
  } catch (error) { showError(error, "export"); showView("preview"); }
  finally { exporting = false; byId("export").disabled = false; byId("export").textContent = "Export viewer"; }
};
function fileStatus(message) { byId("file-status").hidden = false; byId("file-status").textContent = message; }
byId("download-source").onclick = () => {
  download(srcEl.value, "text/plain;charset=utf-8", "diagram.mmd");
  downloadedSource = srcEl.value;
  fileStatus("Source download started.");
};
byId("open-source").onclick = () => byId("file-input").click();
byId("file-input").onchange = async () => {
  const file = byId("file-input").files[0];
  if (!file) return;
  const startingSource = srcEl.value;
  try {
    const contents = await file.text();
    if (srcEl.value !== startingSource) { fileStatus("Source changed while the file was opening. Open the file again when ready."); return; }
    previousFile = srcEl.value;
    srcEl.value = contents;
    byId("undo-import").hidden = false;
    sourceChanged();
    fileStatus("Opened " + file.name + ". Undo file replacement restores your previous source.");
  } catch { fileStatus("Could not read this file. Try opening it again."); }
  finally { byId("file-input").value = ""; }
};
byId("undo-import").onclick = () => {
  if (previousFile === null) return;
  const current = srcEl.value;
  srcEl.value = previousFile; previousFile = current;
  sourceChanged(); fileStatus("Previous source restored. Undo file replacement again to switch back.");
};
let _typeTimer = null;
function sourceChanged() {
  saveSource(); ++_rid;
  setStatus(lastRenderedSource === null ? "Changes pending · No preview yet" : "Changes pending · Preview is out of date");
  clearTimeout(_typeTimer);
  _typeTimer = setTimeout(renderGraph, 700);
}
if (!VIEWER) srcEl.addEventListener("input", sourceChanged);
window.addEventListener("beforeunload", event => {
  if (!VIEWER && !storageAvailable && downloadedSource !== srcEl.value) { event.preventDefault(); event.returnValue = ""; }
});
new ResizeObserver(resizeCanvas).observe(stage);
renderGraph();
