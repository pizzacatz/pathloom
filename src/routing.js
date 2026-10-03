// Every connection follows the single line between its nodes' centers.
// Clip the visible endpoints to the real shapes; leave arrowheads outside.
function routeFlowchart(svg, graph) {
  const root = svg.querySelector("g");
  if (!root || !graph.length) return;
  const inverse = root.getCTM().inverse(),
    nodes = new Map();
  const ns = "http://www.w3.org/2000/svg";
  const domMatrix = (m) => new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
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
    const corners = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
    const bounds = {
      left: Math.min(...corners.map((p) => p.x)),
      right: Math.max(...corners.map((p) => p.x)),
      top: Math.min(...corners.map((p) => p.y)),
      bottom: Math.max(...corners.map((p) => p.y)),
    };
    const parentToRoot = inverse.multiply(node.parentElement.getCTM());
    nodes.set(id, {
      center,
      shapes,
      contains,
      bounds,
      node,
      originalCenter: { x: center.x, y: center.y },
      originalBounds: { ...bounds },
      parentToRoot: domMatrix(parentToRoot),
      local: domMatrix(
        node.parentElement.getCTM().inverse().multiply(node.getCTM()),
      ),
    });
  });
  const connections = [...svg.querySelectorAll("g.edgePaths path")]
    .map((path) => {
      const edge = graph.find(
        (edge) =>
          path.classList.contains("LS-" + edge.start) &&
          path.classList.contains("LE-" + edge.end),
      );
      return edge && nodes.has(edge.start) && nodes.has(edge.end)
        ? { path, edge }
        : null;
    })
    .filter(Boolean);
  const edgeLabels = [...svg.querySelectorAll("g.edgeLabels g.edgeLabel")];
  const labelData =
    edgeLabels.length === connections.length
      ? connections
          .map((connection, index) => {
            const element = edgeLabels[index],
              box = element.getBBox();
            return box.width && box.height
              ? {
                  connection,
                  element,
                  box,
                  width: box.width + 16,
                  height: box.height + 12,
                }
              : null;
          })
          .filter(Boolean)
      : [];
  const overlaps = (a, b, gap = 0) =>
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap;
  function labelPlan(fallback = false) {
    const placed = [],
      failures = new Set();
    for (const label of labelData) {
      const edge = label.connection.edge,
        a = nodes.get(edge.start).center,
        b = nodes.get(edge.end).center;
      const fractions = [0.5];
      for (let i = 1; i <= 45; i++)
        fractions.push(0.5 - i * 0.01, 0.5 + i * 0.01);
      let position;
      const tryPosition = (x, y) => {
        const bounds = {
          left: x - label.width / 2,
          right: x + label.width / 2,
          top: y - label.height / 2,
          bottom: y + label.height / 2,
        };
        if (
          [...nodes.values()].some((node) =>
            overlaps(bounds, node.bounds, 12),
          ) ||
          placed.some((other) => overlaps(bounds, other.bounds, 8))
        )
          return false;
        position = { label, x, y, bounds };
        return true;
      };
      for (const t of fractions)
        if (tryPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) break;
      if (!position) {
        failures.add(label.connection);
        if (fallback) {
          const x = (a.x + b.x) / 2,
            y = (a.y + b.y) / 2;
          // Repel remaining labels into free space rather than ever stacking
          // them. Nodes were already given a chance to create on-line room.
          for (let ring = 1; !position && ring <= 100; ring++)
            for (const sign of [-1, 1])
              if (tryPosition(x + sign * ring * (label.width + 24), y)) break;
        }
      }
      if (!position && fallback) {
        const right = Math.max(
          ...[...nodes.values()].map((node) => node.bounds.right),
          ...placed.map((other) => other.bounds.right),
        );
        tryPosition(right + label.width / 2 + 24, (a.y + b.y) / 2);
      }
      if (position) placed.push(position);
    }
    return { placed, failures };
  }
  function blockedBy(edge) {
    const a = nodes.get(edge.start).center,
      b = nodes.get(edge.end).center;
    if (edge.start === edge.end) return [];
    return [...nodes]
      .filter(([id, node]) => {
        if (id === edge.start || id === edge.end) return false;
        // Conservative slab intersection leaves a little breathing room around
        // the complete shape, avoiding narrow and near-tangent crossings.
        let enter = 0,
          leave = 1;
        const box = node.bounds;
        for (const [axis, low, high] of [
          ["x", box.left - 6, box.right + 6],
          ["y", box.top - 6, box.bottom + 6],
        ]) {
          const delta = b[axis] - a[axis];
          if (Math.abs(delta) < 1e-9) {
            if (a[axis] <= low || a[axis] >= high) return false;
          } else {
            const t1 = (low - a[axis]) / delta,
              t2 = (high - a[axis]) / delta;
            enter = Math.max(enter, Math.min(t1, t2));
            leave = Math.min(leave, Math.max(t1, t2));
            if (enter >= leave) return false;
          }
        }
        return enter < leave;
      })
      .map(([id]) => id);
  }
  function place(node, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("Invalid destination placement.");
    node.center = { x, y };
    const dx = x - node.originalCenter.x,
      dy = y - node.originalCenter.y,
      b = node.originalBounds;
    node.bounds = {
      left: b.left + dx,
      right: b.right + dx,
      top: b.top + dy,
      bottom: b.bottom + dy,
    };
  }
  const score = () =>
    connections.reduce((total, { edge }) => total + blockedBy(edge).length, 0) *
      4 +
    labelPlan().failures.size;
  let collisions = score();
  // Move destinations only. Accept a move only if it reduces the global
  // crossing count without overlapping nodes or reversing existing levels.
  for (let pass = 0; collisions && pass < 32; pass++) {
    let improved = false;
    for (const connection of connections) {
      const { edge } = connection;
      if (!blockedBy(edge).length && !labelPlan().failures.has(connection))
        continue;
      const target = nodes.get(edge.end),
        before = { x: target.center.x, y: target.center.y };
      const step = Math.max(
        100,
        target.bounds.right - target.bounds.left + 40,
        ...labelData
          .filter((label) => label.connection.edge.end === edge.end)
          .map((label) => label.width + 40),
      );
      let best = null;
      const candidates = [];
      for (const dy of [0, 100, 200, 400, 800])
        for (const dx of [
          -step,
          step,
          -step * 2,
          step * 2,
          -step * 4,
          step * 4,
          -step * 8,
          step * 8,
          -step * 16,
          step * 16,
        ])
          candidates.push({ x: before.x + dx, y: before.y + dy });
      candidates.sort(
        (a, b) =>
          Math.hypot(a.x - before.x, a.y - before.y) -
          Math.hypot(b.x - before.x, b.y - before.y),
      );
      for (const candidate of candidates) {
        place(target, candidate.x, candidate.y);
        const overlap = [...nodes.values()].some(
          (other) =>
            other !== target &&
            target.bounds.left < other.bounds.right + 20 &&
            target.bounds.right > other.bounds.left - 20 &&
            target.bounds.top < other.bounds.bottom + 20 &&
            target.bounds.bottom > other.bounds.top - 20,
        );
        const flipped = connections.some(({ edge: e }) => {
          if (e.start === e.end || (e.start !== edge.end && e.end !== edge.end))
            return false;
          const source = nodes.get(e.start),
            destination = nodes.get(e.end),
            original = destination.originalCenter.y - source.originalCenter.y,
            current = destination.center.y - source.center.y;
          return Math.abs(original) > 1 && original * current <= 0;
        });
        if (overlap || flipped || blockedBy(edge).length) continue;
        const next = score();
        if (next < collisions && (!best || next < best.score))
          best = { ...candidate, score: next };
        if (next === 0) break;
      }
      place(target, before.x, before.y);
      if (best) {
        place(target, best.x, best.y);
        collisions = best.score;
        improved = true;
        const dx = best.x - target.originalCenter.x,
          dy = best.y - target.originalCenter.y,
          matrix = target.parentToRoot
            .inverse()
            .multiply(new DOMMatrix().translate(dx, dy))
            .multiply(target.parentToRoot)
            .multiply(target.local);
        target.node.setAttribute(
          "transform",
          `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`,
        );
        target.node.dataset.layoutMoved = "true";
        if (!collisions) break;
      }
    }
    if (!improved) break;
  }
  // Paint labels last and establish a collision-free initial placement.
  // Dynamic navigation re-checks clearance before changing these positions.
  const finalLabels = labelPlan(true);
  for (const group of svg.querySelectorAll("g.edgeLabels"))
    group.parentElement.append(group);
  for (const { label, x, y } of finalLabels.placed) {
    const point = new DOMPoint(x, y).matrixTransform(
      label.element.parentElement.getCTM().inverse().multiply(root.getCTM()),
    );
    label.element.setAttribute(
      "transform",
      `translate(${point.x - label.box.x - label.box.width / 2},${point.y - label.box.y - label.box.height / 2})`,
    );
    if (finalLabels.failures.has(label.connection)) {
      label.element.dataset.labelException = "true";
      const title = document.createElementNS(ns, "title");
      title.textContent = "Label moved off its line to prevent overlap.";
      label.element.append(title);
    }
  }
  // Refresh shape coordinate frames after the accepted node translations.
  for (const node of nodes.values())
    for (const shape of node.shapes)
      shape.inverse = shape.shape.getCTM().inverse().multiply(root.getCTM());
  let exceptions = 0;
  for (const { path, edge } of connections) {
    const blockers = blockedBy(edge);
    if (!blockers.length) continue;
    path.dataset.routingException = "true";
    path.dataset.routingBlockers = blockers.join(",");
    const title = document.createElementNS(ns, "title");
    title.textContent =
      "Layout exception: no clear destination placement found; this straight connection crosses " +
      blockers.join(", ") +
      ".";
    path.append(title);
    exceptions++;
  }
  svg.dataset.routingExceptions = String(exceptions);
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

// Reposition labels along the visible part of their straight connection, while
// retaining the same node/label clearance used by the initial layout.
function createDynamicLabelLayout(svg, stage) {
  const root =
    svg.querySelector(".svg-pan-zoom_viewport") || svg.querySelector("g");
  const inverse = root.getCTM().inverse();
  const boundsOf = (element) => {
    const box = element.getBBox(),
      matrix = inverse.multiply(element.getCTM());
    const points = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
    return {
      left: Math.min(...points.map((p) => p.x)),
      right: Math.max(...points.map((p) => p.x)),
      top: Math.min(...points.map((p) => p.y)),
      bottom: Math.max(...points.map((p) => p.y)),
    };
  };
  const nodes = [...svg.querySelectorAll("g.node")].map(boundsOf);
  const paths = [
    ...svg.querySelectorAll("g.edgePaths path[data-straight-routed]"),
  ];
  const labels = [...svg.querySelectorAll("g.edgeLabels g.edgeLabel")];
  if (paths.length !== labels.length) return () => {};
  const data = labels
    .map((element, index) => {
      const box = element.getBBox(),
        path = paths[index],
        len = path.getTotalLength();
      if (!box.width || !box.height || !len) return null;
      const matrix = inverse.multiply(path.getCTM()),
        bounds = boundsOf(element);
      return {
        element,
        box,
        width: box.width + 16,
        height: box.height + 12,
        a: path.getPointAtLength(0).matrixTransform(matrix),
        b: path.getPointAtLength(len).matrixTransform(matrix),
        original: {
          x: (bounds.left + bounds.right) / 2,
          y: (bounds.top + bounds.bottom) / 2,
        },
        parent: element.parentElement
          .getCTM()
          .inverse()
          .multiply(root.getCTM()),
      };
    })
    .filter(Boolean);
  const overlaps = (a, b, gap) =>
    a.left < b.right + gap &&
    a.right > b.left - gap &&
    a.top < b.bottom + gap &&
    a.bottom > b.top - gap;
  return () => {
    const screen = stage.getBoundingClientRect(),
      matrix = root.getScreenCTM().inverse(),
      topLeft = new DOMPoint(screen.left, screen.top).matrixTransform(matrix),
      bottomRight = new DOMPoint(screen.right, screen.bottom).matrixTransform(
        matrix,
      ),
      placed = [];
    for (const label of data) {
      const { a, b } = label;
      let low = 0,
        high = 1;
      for (const [axis, min, max] of [
        [
          "x",
          topLeft.x + label.width / 2 + 12,
          bottomRight.x - label.width / 2 - 12,
        ],
        [
          "y",
          topLeft.y + label.height / 2 + 12,
          bottomRight.y - label.height / 2 - 12,
        ],
      ]) {
        const delta = b[axis] - a[axis];
        if (min > max || (!delta && (a[axis] < min || a[axis] > max))) {
          low = 1;
          high = 0;
          break;
        }
        if (delta) {
          const t1 = (min - a[axis]) / delta,
            t2 = (max - a[axis]) / delta;
          low = Math.max(low, Math.min(t1, t2));
          high = Math.min(high, Math.max(t1, t2));
        }
      }
      const visible = low <= high,
        preferred = visible ? (low + high) / 2 : 0.5;
      const fractions = [
        preferred,
        ...Array.from({ length: 99 }, (_, i) => (i + 1) / 100),
      ];
      fractions.sort((x, y) => {
        const rank = (t) =>
          (visible && (t < low || t > high) ? 2 : 0) + Math.abs(t - preferred);
        return rank(x) - rank(y);
      });
      let chosen;
      const tryPoint = (x, y) => {
        const box = {
          left: x - label.width / 2,
          right: x + label.width / 2,
          top: y - label.height / 2,
          bottom: y + label.height / 2,
        };
        if (
          nodes.some((node) => overlaps(box, node, 12)) ||
          placed.some((other) => overlaps(box, other, 8))
        )
          return false;
        chosen = { x, y, box };
        return true;
      };
      for (const t of fractions)
        if (tryPoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) break;
      if (!chosen) tryPoint(label.original.x, label.original.y);
      if (!chosen) {
        const x = a.x + (b.x - a.x) * preferred,
          y = a.y + (b.y - a.y) * preferred;
        for (let ring = 1; !chosen && ring <= 12; ring++)
          for (const sign of [-1, 1])
            if (tryPoint(x + sign * ring * (label.width + 24), y)) break;
        if (!chosen)
          tryPoint(
            Math.max(
              ...nodes.map((node) => node.right),
              ...placed.map((box) => box.right),
            ) +
              label.width / 2 +
              24,
            y,
          );
      }
      const point = new DOMPoint(chosen.x, chosen.y).matrixTransform(
        label.parent,
      );
      label.element.setAttribute(
        "transform",
        `translate(${point.x - label.box.x - label.box.width / 2},${point.y - label.box.y - label.box.height / 2})`,
      );
      placed.push(chosen.box);
    }
  };
}
