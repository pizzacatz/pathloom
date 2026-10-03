// Every connection follows the single line between its nodes' centers.
// Clip the visible endpoints to the real shapes; leave arrowheads outside.
function routeFlowchart(svg, graph) {
  const root = svg.querySelector("g");
  if (!root || !graph.length) return;
  const inverse = root.getCTM().inverse(),
    nodes = new Map();
  const ns = "http://www.w3.org/2000/svg";
  svg.querySelectorAll("g.node").forEach((node) => {
    const id = node.id.replace(/^flowchart-/, "").replace(/-\d+$/, "");
    const box = node.getBBox(),
      matrix = inverse.multiply(node.getCTM());
    const center = new DOMPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    ).matrixTransform(matrix);
    const shapes = [
      ...node.querySelectorAll("rect,polygon,circle,ellipse,path"),
    ]
      .filter((shape) => !shape.closest(".label"))
      .map((shape) => ({
        shape,
        inverse: shape.getCTM().inverse().multiply(root.getCTM()),
      }));
    const contains = (point) =>
      shapes.some(({ shape, inverse }) =>
        shape.isPointInFill(
          new DOMPoint(point.x, point.y).matrixTransform(inverse),
        ),
      );
    nodes.set(id, { center, shapes, contains });
  });
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS(ns, "defs");
    root.prepend(defs);
  }
  const masks = new Map(),
    extents = [];
  const at = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  function exitFraction(node, other) {
    if (node.contains(other))
      throw new Error(
        "Connected node shapes overlap. Increase flowchart spacing.",
      );
    let low = 0,
      high = 1;
    for (let i = 0; i < 40; i++) {
      const middle = (low + high) / 2;
      if (node.contains(at(node.center, other, middle))) low = middle;
      else high = middle;
    }
    return high;
  }
  for (const path of svg.querySelectorAll("g.edgePaths path")) {
    const edge = graph.find(
      (edge) =>
        path.classList.contains("LS-" + edge.start) &&
        path.classList.contains("LE-" + edge.end),
    );
    if (!edge || !nodes.has(edge.start) || !nodes.has(edge.end)) continue;
    const source = nodes.get(edge.start),
      target = nodes.get(edge.end),
      a = source.center,
      b = target.center;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const matrix = path.getCTM().inverse().multiply(root.getCTM());
    let start = a,
      end = b;
    if (distance) {
      const sourceExit = exitFraction(source, b),
        targetEntry = 1 - exitFraction(target, a);
      // Mermaid's marker extends five units beyond its endpoint. A further
      // two-unit gap keeps the entire arrowhead outside the destination shape.
      const startGap = path.hasAttribute("marker-start") ? 7 : 1;
      const first = sourceExit + startGap / distance,
        last = targetEntry - 7 / distance;
      if (first >= last)
        throw new Error(
          "Connected shapes leave no room for an arrow. Increase flowchart spacing.",
        );
      start = at(a, b, first);
      end = at(a, b, last);
    }
    const p = new DOMPoint(start.x, start.y).matrixTransform(matrix),
      q = new DOMPoint(end.x, end.y).matrixTransform(matrix);
    path.setAttribute("d", `M${p.x},${p.y} L${q.x},${q.y}`);
    path.dataset.straightRouted = "true";
    path.style.strokeLinejoin = "miter";
    // Mask shape interiors, including any intervening nodes. The line stays
    // straight without painting over text, even when nodes are dimmed.
    const key = [
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
    ].join(",");
    if (!masks.has(key)) {
      const mask = document.createElementNS(ns, "mask");
      mask.id = svg.id + "-straight-mask-" + masks.size;
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      mask.setAttribute("maskContentUnits", "userSpaceOnUse");
      const geometry = [];
      for (const node of nodes.values())
        for (const { shape } of node.shapes) {
          const m = path.getCTM().inverse().multiply(shape.getCTM()),
            box = shape.getBBox();
          for (const [x, y] of [
            [box.x, box.y],
            [box.x + box.width, box.y],
            [box.x, box.y + box.height],
            [box.x + box.width, box.y + box.height],
          ])
            geometry.push(new DOMPoint(x, y).matrixTransform(m));
          const copy = shape.cloneNode(true);
          copy.removeAttribute("id");
          copy.removeAttribute("class");
          copy.setAttribute(
            "transform",
            `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`,
          );
          copy.setAttribute(
            "style",
            "fill:black!important;stroke:black!important;opacity:1!important",
          );
          mask.append(copy);
        }
      const x = Math.min(...geometry.map((p) => p.x)) - 16,
        y = Math.min(...geometry.map((p) => p.y)) - 16,
        width = Math.max(...geometry.map((p) => p.x)) - x + 16,
        height = Math.max(...geometry.map((p) => p.y)) - y + 16;
      const background = document.createElementNS(ns, "rect");
      for (const [key, value] of Object.entries({ x, y, width, height })) {
        mask.setAttribute(key, value);
        background.setAttribute(key, value);
      }
      background.style.setProperty("fill", "white", "important");
      mask.prepend(background);
      defs.append(mask);
      masks.set(key, mask.id);
    }
    path.setAttribute("mask", `url(#${masks.get(key)})`);
    extents.push(start, end);
  }
  const box = svg.getBBox(),
    transform = root.transform.baseVal.consolidate()?.matrix || new DOMMatrix();
  const points = extents.map((p) =>
    new DOMPoint(p.x, p.y).matrixTransform(transform),
  );
  const left = Math.min(box.x, ...points.map((p) => p.x)) - 16,
    top = Math.min(box.y, ...points.map((p) => p.y)) - 16,
    right = Math.max(box.x + box.width, ...points.map((p) => p.x)) + 16,
    bottom = Math.max(box.y + box.height, ...points.map((p) => p.y)) + 16;
  svg.setAttribute("viewBox", `${left} ${top} ${right - left} ${bottom - top}`);
}
