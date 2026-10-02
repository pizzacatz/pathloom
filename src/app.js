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
const BAKED_SRC = window.__FLOWCHART_SRC__ ?? null;
const VIEWER = !!(typeof window !== "undefined" && window.__FLOWCHART_VIEWER__);
function restoreSource() {
  if (VIEWER) return BAKED_SRC ?? DEFAULT_SRC;
  try {
    // Remove the legacy workspace draft; never migrate identifying content.
    localStorage.removeItem("mermaid_studio_src");
    return localStorage.getItem(KEY) ?? DEFAULT_SRC;
  } catch { storageAvailable = false; return DEFAULT_SRC; }
}
function saveSource() {
  if (VIEWER) return;
  try { localStorage.setItem(KEY, srcEl.value); }
  catch { storageAvailable = false; }
}
function setStatus(message) {
  statusEl.textContent = message + (!VIEWER && !storageAvailable ? " · Local saving unavailable" : "");
}
srcEl.value = restoreSource();
if (VIEWER) {
  document.getElementById("editor").classList.add("hidden");
  ["render","toggle","export"].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = "none"; });
  const h = document.getElementById("hint");
  if (h) h.textContent = "Click node, line, or label to trace · Next or arrow keys advance · double-click for 100%";
}

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
  errEl.textContent = "";
  setStatus("Rendering…");

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
    setStatus("Unable to render · Showing the last valid diagram");
    // Keep the last good diagram; just report the error.
    errEl.textContent = "Render error: " + (e && e.message ? e.message : e);
    return;
  }

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
  function focus(key) {
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
    centerOn(cur);
  }

  // ---- stepper ----
  let current = null; const history = [];
  function updateTraceControls() {
    document.getElementById("back").disabled = history.length === 0;
    const outs = succ[current] || [];
    document.getElementById("next").disabled = current ? outs.length !== 1 : !Object.keys(succ).length;
    if (!current) setStatus(Object.keys(succ).length ? "Ready · Select a step to trace" : "Ready · Diagram has no traceable connections");
    else setStatus((nodeEls[current].textContent.trim() || current) + (outs.length > 1 ? " · Choose a highlighted branch" : outs.length === 0 ? " · End of path" : " · Next step available"));
  }
  function go(key, record) { if (!nodeEls[key]) return;
    if (record !== false && current && current !== key) history.push(current);
    current = key; focus(key); updateTraceControls(); }
  function stepNext() { if (!current) { const first = nodeEls.Start ? "Start" : Object.keys(succ)[0]; if (first) go(first); return; }
    const outs = succ[current] || []; if (outs.length === 1) go(outs[0]); }
  function stepBack() { if (history.length) go(history.pop(), false); }

  Object.entries(nodeEls).forEach(([k, g]) => {
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
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
    panZoom.resize(); panZoom.fit(); panZoom.center(); updateTraceControls(); };
  document.onkeydown = ev => {
    if (document.activeElement === srcEl) return;   // don't hijack typing in the editor
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") { ev.preventDefault(); stepNext(); }
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") { ev.preventDefault(); stepBack(); }
  };

  VP = { panZoom: panZoom, relayout: relayoutLabels, lastKey: "" };
  try { relayoutLabels(); } catch { /* Optional geometry enhancement. */ }
  updateTraceControls();
}

// ---- toolbar wiring (persists across renders) ----
document.getElementById("render").onclick = () => { clearTimeout(_typeTimer); renderGraph(); };
document.getElementById("toggle").onclick = () => {
  const hidden = document.getElementById("editor").classList.toggle("hidden");
  document.getElementById("toggle").setAttribute("aria-expanded", String(!hidden));
  if (_panZoom) { _panZoom.resize(); _panZoom.fit(); _panZoom.center(); }
};

const exportBtn = document.getElementById("export");
if (exportBtn) exportBtn.onclick = exportViewer;

function exportViewer() {
  const src = srcEl.value;
  const clone = document.documentElement.cloneNode(true);
  const st = clone.querySelector("#stage"); if (st) st.innerHTML = "";
  clone.querySelector("#status").textContent = "Loading…";
  const er = clone.querySelector("#err"); if (er) er.textContent = "";
  const ta = clone.querySelector("#src"); if (ta) ta.textContent = "";
  const flag = document.createElement("script");
  flag.textContent = "window.__FLOWCHART_VIEWER__=true;window.__FLOWCHART_SRC__="
    + JSON.stringify(src).replace(/</g, "\\u003c") + ";";
  clone.querySelector("head").appendChild(flag);
  const html = "<!DOCTYPE html>\n" + clone.outerHTML;
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "flowchart.html";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// live re-render on edit, debounced
let _typeTimer = null;
if (!VIEWER) srcEl.addEventListener("input", () => { saveSource(); ++_rid; setStatus("Changes pending…"); clearTimeout(_typeTimer); _typeTimer = setTimeout(renderGraph, 700); });

window.addEventListener("resize", () => { if (_panZoom) { _panZoom.resize(); _panZoom.fit(); _panZoom.center(); } });

renderGraph();
