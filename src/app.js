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
function setStatus(message) {
  statusEl.textContent = message;
  byId("toggle").title = message;
  byId("toggle").dataset.attention = String(/out of date|No preview|Source is empty/.test(message));
  byId("notice").textContent = message;
}
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
  if (VIEWER) {
    byId("trace").querySelector(".panel-content").prepend(statusEl, byId("error-box"));
    setPanel("trace", true);
  } else setPanel("editor", true);
}
const panelButtons = { editor: "toggle", trace: "trace-toggle", help: "help-toggle" };
const PANEL_KEY = "pathloom.panels.v1";
let animationFrame = null;
function cancelFlyover() {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  stage.removeAttribute("aria-busy");
}
function setPanel(id, open, returnFocus = false) {
  cancelFlyover();
  const panel = byId(id);
  if (open && matchMedia("(max-width:1000px)").matches) {
    Object.keys(panelButtons).filter(key => key !== id).forEach(key => {
      byId(key).classList.add("hidden");
      byId(panelButtons[key]).setAttribute("aria-expanded", "false");
    });
  }
  panel.classList.toggle("hidden", !open);
  byId(panelButtons[id]).setAttribute("aria-expanded", String(open));
  if (returnFocus) byId(panelButtons[id]).focus();
  if (!VIEWER) try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(Object.fromEntries(Object.keys(panelButtons).map(key => [key, !byId(key).classList.contains("hidden")]))));
  } catch { /* Layout persistence is optional. */ }
  resizeCanvas();
}
function showView(view) { if (view === "source") setPanel("editor", true); }
srcEl.value = restoreSource();
if (VIEWER) document.body.classList.add("viewer");
else try {
  const panels = JSON.parse(localStorage.getItem(PANEL_KEY) || "{}");
  for (const id of Object.keys(panelButtons)) {
    if (panels[id] && (!matchMedia("(max-width:1000px)").matches || id === "editor")) {
      byId(id).classList.remove("hidden");
      byId(panelButtons[id]).setAttribute("aria-expanded", "true");
    }
  }
} catch { /* Defaults give the canvas the full workspace. */ }
saveSource();

mermaid.initialize({ startOnLoad:false, theme:"dark", securityLevel:"strict",
  flowchart:{ useMaxWidth:false, htmlLabels:true, rankSpacing:140 } });

// ---- persistent frame loop so labels track every pan/zoom, across re-renders ----
let VP = null;
function frame() {
  if (VP && VP.panZoom) {
    try {
      const p = VP.panZoom.getPan(), z = VP.panZoom.getZoom();
      const key = z.toFixed(4) + "|" + Math.round(p.x) + "|" + Math.round(p.y);
      if (key !== VP.lastKey) { VP.lastKey = key; VP.relayout(); updateOverview(); }
    } catch (e) { /* ignore between renders */ }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let _panZoom = null, _rid = 0;

async function renderGraph() {
  cancelFlyover();
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

  const candidate = document.createElement("div");
  candidate.style.cssText = "position:absolute;inset:0;visibility:hidden;pointer-events:none";
  candidate.innerHTML = svg;
  stage.append(candidate);
  const svgEl = candidate.querySelector("svg");
  if (!svgEl) { candidate.remove(); showError(new Error("No diagram produced.")); return false; }
  svgEl.removeAttribute("style");
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", "100%");
  try { routeFlowchart(svgEl, graph); }
  catch (error) { candidate.remove(); showError(error); return false; }

  cancelFlyover();
  VP = null;
  if (_panZoom) { try { _panZoom.destroy(); } catch {} _panZoom = null; }
  stage.replaceChildren(svgEl);

  const panZoom = svgPanZoom(svgEl, { zoomEnabled:true, panEnabled:true, controlIconsEnabled:false,
    dblClickZoomEnabled:false,
    fit:true, center:true, minZoom:0.2, maxZoom:12, zoomScaleSensitivity:0.35 });
  _panZoom = panZoom;
  if (savedView) restoreView(savedView);
  buildOverview(svgEl);
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
    // Move only when the selected node is outside a comfortable visible margin.
    try {
      const sr = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
      const margin = 24;
      const dx = r.width > sr.width - margin * 2 ? sr.left + sr.width/2 - (r.left + r.width/2)
        : r.left < sr.left + margin ? sr.left + margin - r.left
        : r.right > sr.right - margin ? sr.right - margin - r.right : 0;
      const dy = r.height > sr.height - margin * 2 ? sr.top + sr.height/2 - (r.top + r.height/2)
        : r.top < sr.top + margin ? sr.top + margin - r.top
        : r.bottom > sr.bottom - margin ? sr.bottom - margin - r.bottom : 0;
      const ctm = svgEl.getScreenCTM();
      panZoom.panBy({ x: dx / ctm.a, y: dy / ctm.d });
    } catch { /* A selected node still has a text equivalent. */ }
  }
  function flyTo(edge) {
    cancelFlyover();
    if (matchMedia("(prefers-reduced-motion:reduce)").matches) { go(edge.end); return; }
    try {
      const len = edge.path.getTotalLength();
      const inverse = viewport.getCTM().inverse();
      const transforms = new Map([edge.path, nodeEls[edge.start], nodeEls[edge.end]].map(element => [element, inverse.multiply(element.getCTM())]));
      const toContent = (element, point) => {
        const svgPoint = svgEl.createSVGPoint();
        svgPoint.x = point.x; svgPoint.y = point.y;
        return svgPoint.matrixTransform(transforms.get(element));
      };
      const nodeCenter = key => {
        const box = nodeEls[key].getBBox();
        return toContent(nodeEls[key], { x: box.x + box.width/2, y: box.y + box.height/2 });
      };
      const view = captureView();
      const start = nodeCenter(edge.start), end = nodeCenter(edge.end);
      const at = fraction => {
        // Include node centers at each end, with most of the trip on the actual curve.
        if (fraction < .08) {
          const first = toContent(edge.path, edge.path.getPointAtLength(0));
          return { x: start.x + (first.x-start.x)*fraction/.08, y: start.y + (first.y-start.y)*fraction/.08 };
        }
        if (fraction > .92) {
          const last = toContent(edge.path, edge.path.getPointAtLength(len));
          return { x: last.x + (end.x-last.x)*(fraction-.92)/.08, y: last.y + (end.y-last.y)*(fraction-.92)/.08 };
        }
        return toContent(edge.path, edge.path.getPointAtLength((fraction-.08)/.84*len));
      };
      if (!view || !len) { go(edge.end); return; }
      // Keep the camera's initial offset and dissolve it as it follows the line.
      const offset = { x: view.x-start.x, y: view.y-start.y };
      const begun = performance.now();
      stage.setAttribute("aria-busy", "true");
      function tick(now) {
        const t = Math.min(1, (now-begun)/500);
        const progress = t*t*(3-2*t);
        const point = at(progress);
        const sizes = panZoom.getSizes();
        panZoom.pan({ x: sizes.width/2-(point.x+offset.x*(1-progress))*view.scale,
          y: sizes.height/2-(point.y+offset.y*(1-progress))*view.scale });
        if (t < 1) animationFrame = requestAnimationFrame(tick);
        else { animationFrame = null; stage.removeAttribute("aria-busy"); go(edge.end, true, false); }
      }
      animationFrame = requestAnimationFrame(tick);
    } catch { cancelFlyover(); go(edge.end); }
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
  function go(key, record, reveal = true) { if (!nodeEls[key]) return;
    cancelFlyover();
    if (record !== false && current && current !== key) history.push(current);
    current = key; focus(key, reveal); updateTraceControls(); }
  const firstNode = Object.keys(nodeEls).find(key => !graph.some(edge => edge.end === key && nodeEls[edge.start])) || Object.keys(nodeEls)[0];
  byId("start").disabled = !firstNode;
  function stepNext() { if (!current) { if (firstNode) go(firstNode); return; }
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
    const jump = ev => { ev.stopPropagation(); flyTo(hit); };
    p.addEventListener("click", jump);
    const hitArea = p.cloneNode(false);
    hitArea.removeAttribute("id");
    hitArea.removeAttribute("data-top-routed");
    hitArea.removeAttribute("marker-start"); hitArea.removeAttribute("marker-end");
    hitArea.removeAttribute("style");
    hitArea.setAttribute("class", "edge-hit");
    hitArea.setAttribute("fill", "none");
    hitArea.setAttribute("stroke", "transparent");
    hitArea.setAttribute("stroke-width", "12");
    hitArea.setAttribute("vector-effect", "non-scaling-stroke");
    hitArea.setAttribute("pointer-events", "stroke");
    hitArea.setAttribute("aria-hidden", "true");
    hitArea.addEventListener("click", jump);
    p.after(hitArea);
    if (aligned && labelEls[i]) labelEls[i].addEventListener("click", jump);
  });

  document.getElementById("zin").onclick   = () => { cancelFlyover(); panZoom.zoomIn(); };
  document.getElementById("zout").onclick  = () => { cancelFlyover(); panZoom.zoomOut(); };
  document.getElementById("fit").onclick   = () => { cancelFlyover(); panZoom.resize(); panZoom.fit(); panZoom.center(); };
  function actualSize() {
    cancelFlyover();
    const rz = panZoom.getSizes().realZoom;
    if (rz > 0) {
      const target = panZoom.getZoom() / rz;
      // Large diagrams can require a relative zoom beyond the default fit-based limit.
      panZoom.setMaxZoom(Math.max(12, target));
      panZoom.setMinZoom(Math.min(.2, target));
      panZoom.zoom(target);
    }
  }
  byId("onehundred").onclick = () => {
    actualSize();
    if (current && nodeEls[current]) centerOn(nodeEls[current]);
  };
  byId("start").onclick = () => {
    if (!firstNode) return;
    actualSize();
    history.length = 0;
    go(firstNode, false, false);
    const node = nodeEls[firstNode], box = node.getBBox(), point = svgEl.createSVGPoint();
    point.x = box.x + box.width/2; point.y = box.y + box.height/2;
    const center = point.matrixTransform(node.getCTM()).matrixTransform(viewport.getCTM().inverse());
    const sizes = panZoom.getSizes();
    panZoom.pan({ x:sizes.width/2-center.x*sizes.realZoom, y:sizes.height/2-center.y*sizes.realZoom });
  };
  document.getElementById("back").onclick  = () => stepBack();
  document.getElementById("next").onclick  = () => stepNext();
  document.getElementById("reset").onclick = () => { cancelFlyover(); clearHL(); current = null; history.length = 0;
    Object.values(nodeEls).forEach(node => node.setAttribute("aria-pressed", "false")); updateTraceControls(); };
  document.onkeydown = ev => {
    if (!stage.contains(document.activeElement)) return;   // don't hijack typing in the editor
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") { ev.preventDefault(); stepNext(); }
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") { ev.preventDefault(); stepBack(); }
    else {
      const control = { f:"fit", F:"fit", "+":"zin", "=":"zin", "-":"zout", "0":"onehundred" }[ev.key];
      if (control) { ev.preventDefault(); byId(control).click(); }
    }
  };

  stage.onpointerdown = cancelFlyover;
  stage.onwheel = cancelFlyover;
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
  cancelFlyover();
  if (pendingPreview && stage.clientWidth && stage.clientHeight) { clearTimeout(_typeTimer); renderGraph(); return; }
  if (!_panZoom || !stage.clientWidth || !stage.clientHeight) return;
  const view = captureView();
  _panZoom.resize();
  if (view) restoreView(view);
}
byId("render").onclick = () => { clearTimeout(_typeTimer); renderGraph(); };
for (const [panel, button] of Object.entries(panelButtons)) {
  byId(button).onclick = () => setPanel(panel, byId(panel).classList.contains("hidden"));
}
byId("source-close").onclick = () => setPanel("editor", false, true);
byId("trace-close").onclick = () => setPanel("trace", false, true);
byId("help-close").onclick = () => setPanel("help", false, true);
function toggleOverview(open) {
  byId("overview").hidden = !open;
  byId("overview-toggle").setAttribute("aria-expanded", String(open));
  updateOverview();
}
byId("overview-toggle").onclick = () => toggleOverview(byId("overview").hidden);
byId("overview-close").onclick = () => { toggleOverview(false); byId("overview-toggle").focus(); };
let overviewBox = null;
function buildOverview(svg) {
  const map = byId("overview-map");
  map.replaceChildren();
  const content = svg.querySelector(".svg-pan-zoom_viewport");
  if (!content) return;
  const copy = content.cloneNode(true);
  copy.removeAttribute("transform");
  copy.style.removeProperty("transform");
  copy.querySelectorAll("style").forEach(style => { style.textContent = style.textContent.replaceAll("#" + svg.id, "#overview-map"); });
  copy.removeAttribute("id");
  copy.querySelectorAll("[tabindex], [role], [aria-pressed]").forEach(el => {
    el.removeAttribute("tabindex"); el.removeAttribute("role"); el.removeAttribute("aria-pressed");
  });
  // Prefix IDs and their references to keep markers and styles isolated from the main SVG.
  copy.querySelectorAll("[id]").forEach(el => el.id = "overview-" + el.id);
  const defs = svg.querySelector("defs")?.cloneNode(true);
  if (defs) { defs.querySelectorAll("[id]").forEach(el => el.id = "overview-" + el.id); map.append(defs); }
  for (const root of [copy, defs].filter(Boolean)) root.querySelectorAll("*").forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.includes("url(#")) el.setAttribute(attr.name, attr.value.replace(/url\(#/g, "url(#overview-"));
    }
  });
  map.append(copy);
  overviewBox = content.getBBox();
  const { x,y,width,height } = overviewBox;
  map.setAttribute("viewBox", `${x-8} ${y-8} ${width+16} ${height+16}`);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.id = "overview-window"; map.append(rect);
  updateOverview();
}
function updateOverview() {
  if (byId("overview").hidden || !overviewBox) return;
  const view = captureView(), rect = byId("overview-window");
  if (!view || !rect) return;
  const { width,height } = _panZoom.getSizes();
  for (const [name,value] of Object.entries({ x:view.x-width/view.scale/2, y:view.y-height/view.scale/2,
    width:width/view.scale, height:height/view.scale })) rect.setAttribute(name, value);
}
byId("overview-map").onclick = event => {
  if (!_panZoom) return;
  cancelFlyover();
  const map = byId("overview-map"), point = map.createSVGPoint();
  point.x = event.clientX; point.y = event.clientY;
  const target = point.matrixTransform(map.getScreenCTM().inverse());
  const view = captureView();
  if (view) restoreView({ ...view, x:target.x, y:target.y });
};
window.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  cancelFlyover();
  const open = Object.keys(panelButtons).filter(id => !byId(id).classList.contains("hidden"));
  const panel = open.find(id => byId(id).contains(document.activeElement)) || open.at(-1);
  if (panel) { setPanel(panel, false, true); event.preventDefault(); }
  else if (!byId("overview").hidden) { toggleOverview(false); byId("overview-toggle").focus(); }
});
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
    try {
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
      const edges = diagram.type.startsWith("flowchart") && typeof diagram.db.getEdges === "function" ? diagram.db.getEdges() : [];
      const result = await mermaid.render(id, source);
      const validation = document.createElement("div");
      validation.style.cssText = "position:absolute;inset:0;visibility:hidden;pointer-events:none";
      validation.innerHTML = result.svg;
      stage.append(validation);
      try { routeFlowchart(validation.querySelector("svg"), Array.isArray(edges) ? edges : []); }
      finally { validation.remove(); }
    }
    finally { document.getElementById("d" + id)?.remove(); }
    if (source !== srcEl.value) { setStatus("Source changed during validation · Export again when ready"); return; }
    const clone = document.documentElement.cloneNode(true);
    clone.querySelector("body").classList.add("viewer");
    clone.querySelector("body").dataset.view = "preview";
    clone.querySelector("#stage").replaceChildren();
    clone.querySelector("#overview-map").replaceChildren();
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
  cancelFlyover();
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
