// Route flowchart connections in SVG user coordinates. Inflated node bounds are
// obstacles; a rectilinear A* search finds a path ending vertically at the top port.
function routeFlowchart(svg, graph) {
  if (!graph.length) return;
  // Use a shared group frame: browsers differ in whether a root SVG's CTM
  // includes its viewBox mapping before the first paint.
  const coordinateRoot = svg.querySelector("g");
  if (!coordinateRoot) return;
  const inverse = coordinateRoot.getCTM().inverse();
  const boxes = new Map();
  const nodeElements = new Map();
  svg.querySelectorAll("g.node").forEach((node) => {
    const id = node.id.replace(/^flowchart-/, "").replace(/-\d+$/, "");
    nodeElements.set(id, node);
    const box = node.getBBox(),
      matrix = inverse.multiply(node.getCTM());
    const corners = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
    boxes.set(id, {
      left: Math.min(...corners.map((p) => p.x)),
      right: Math.max(...corners.map((p) => p.x)),
      top: Math.min(...corners.map((p) => p.y)),
      bottom: Math.max(...corners.map((p) => p.y)),
    });
  });
  const paths = Array.from(svg.querySelectorAll("g.edgePaths path"));
  const connections = paths
    .map((path) => {
      const edge = graph.find(
        (e) =>
          path.classList.contains("LS-" + e.start) &&
          path.classList.contains("LE-" + e.end),
      );
      return edge && boxes.has(edge.start) && boxes.has(edge.end)
        ? { path, edge }
        : null;
    })
    .filter(Boolean);
  if (!connections.length) return;
  const bounds = Array.from(boxes.values());
  const branching = new Set(
    [...boxes.keys()].filter(
      (id) =>
        new Set(
          connections.filter((c) => c.edge.start === id).map((c) => c.edge.end),
        ).size > 1,
    ),
  );
  let ignoredSource = null;
  function routesWithClearance(clearance, selectedConnections) {
    const portGap = Math.max(clearance, 8);
    const obstacles = bounds.map((b) => ({
      left: b.left - clearance,
      right: b.right + clearance,
      top: b.top - clearance,
      bottom: b.bottom + clearance,
    }));
    const xs = [
      ...new Set(
        bounds.flatMap((b) => [
          b.left - clearance,
          b.right + clearance,
          (b.left + b.right) / 2,
        ]),
      ),
    ].sort((a, b) => a - b);
    const ys = [
      ...new Set(
        bounds.flatMap((b) => [
          b.top - clearance,
          b.bottom + clearance,
          b.top - portGap,
          b.bottom + portGap,
        ]),
      ),
    ].sort((a, b) => a - b);
    const leftLane = Math.min(...bounds.map((b) => b.left)) - 80 - clearance;
    const rightLane = Math.max(...bounds.map((b) => b.right)) + 80 + clearance;
    xs.push(leftLane, rightLane);
    xs.sort((a, b) => a - b);
    const nx = xs.length;
    const point = (id) => ({ x: xs[id % nx], y: ys[Math.floor(id / nx)] });
    const idOf = (p) => ys.indexOf(p.y) * nx + xs.indexOf(p.x);
    const visibility = new Map();
    function segmentFree(a, b) {
      const key = a < b ? a + ":" + b : b + ":" + a;
      if (visibility.has(key)) return visibility.get(key);
      const p = point(a),
        q = point(b),
        eps = 0.001;
      const blocked = obstacles.some((o) =>
        p.y === q.y
          ? p.y > o.top + eps &&
            p.y < o.bottom - eps &&
            Math.max(p.x, q.x) > o.left + eps &&
            Math.min(p.x, q.x) < o.right - eps
          : p.x > o.left + eps &&
            p.x < o.right - eps &&
            Math.max(p.y, q.y) > o.top + eps &&
            Math.min(p.y, q.y) < o.bottom - eps,
      );
      visibility.set(key, !blocked);
      return !blocked;
    }
    function search(start, end, downward = false) {
      const source = idOf(start),
        target = idOf(end),
        heap = [],
        cost = new Map(),
        parents = new Map();
      const heuristic = (id) => {
        const p = point(id);
        return Math.abs(p.x - end.x) + Math.abs(p.y - end.y);
      };
      function push(item) {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (heap[p].score <= item.score) break;
          heap[i] = heap[p];
          i = p;
        }
        heap[i] = item;
      }
      function pop() {
        const first = heap[0],
          last = heap.pop();
        if (heap.length) {
          let i = 0;
          while (i * 2 + 1 < heap.length) {
            let j = i * 2 + 1;
            if (j + 1 < heap.length && heap[j + 1].score < heap[j].score) j++;
            if (heap[j].score >= last.score) break;
            heap[i] = heap[j];
            i = j;
          }
          heap[i] = last;
        }
        return first;
      }
      const initial = source * 3;
      cost.set(initial, 0);
      push({
        id: source,
        dir: 0,
        key: initial,
        cost: 0,
        score: heuristic(source),
      });
      while (heap.length) {
        const current = pop();
        if (cost.get(current.key) !== current.cost) continue;
        if (current.id === target) {
          const route = [];
          let key = current.key;
          while (key !== undefined) {
            route.push(point(Math.floor(key / 3)));
            key = parents.get(key);
          }
          return route.reverse();
        }
        const x = current.id % nx,
          y = Math.floor(current.id / nx);
        const adjacent = [
          [x - 1, y, 1],
          [x + 1, y, 1],
          [x, y - 1, 2],
          [x, y + 1, 2],
        ];
        for (const [xx, yy, dir] of adjacent) {
          if (xx < 0 || xx >= nx || yy < 0 || yy >= ys.length) continue;
          if (downward && yy < y) continue;
          const id = yy * nx + xx;
          if (!segmentFree(current.id, id)) continue;
          const p = point(current.id),
            q = point(id),
            key = id * 3 + dir;
          const nextCost =
            current.cost +
            Math.abs(p.x - q.x) +
            Math.abs(p.y - q.y) +
            (current.dir && current.dir !== dir ? 8 : 0);
          if (nextCost >= (cost.get(key) ?? Infinity)) continue;
          cost.set(key, nextCost);
          parents.set(key, current.key);
          push({
            id,
            dir,
            key,
            cost: nextCost,
            score: nextCost + heuristic(id),
          });
        }
      }
      return null;
    }
    const routes = [];
    for (const { path, edge } of selectedConnections) {
      const source = boxes.get(edge.start),
        target = boxes.get(edge.end);
      const sourceX = (source.left + source.right) / 2,
        targetX = (target.left + target.right) / 2;
      const reversed = path.hasAttribute("marker-start");
      const start = {
        x: sourceX,
        y: reversed ? source.top - portGap : source.bottom + portGap,
      };
      const end = { x: targetX, y: target.top - portGap };
      const downward = !reversed && target.top - 5 > source.bottom;
      if (downward && start.y > end.y) return null;
      let middle;
      if (downward) middle = search(start, end, true);
      else {
        // Return connections rise in a lane outside the entire chart instead
        // of weaving through the forward flow. Try the nearer side first.
        const lanes = [leftLane, rightLane].sort(
          (a, b) =>
            Math.abs(a - sourceX) +
            Math.abs(a - targetX) -
            Math.abs(b - sourceX) -
            Math.abs(b - targetX),
        );
        for (const x of lanes) {
          const departure = { x, y: start.y },
            approach = { x, y: end.y };
          const outbound = search(start, departure),
            inbound = search(approach, end);
          if (outbound && inbound) {
            middle = [...outbound, approach, ...inbound.slice(1)];
            break;
          }
        }
      }
      if (!middle) return null;
      // Mermaid's arrow marker extends 5 user units beyond the path endpoint.
      const points = [
        { x: sourceX, y: reversed ? source.top - 5 : source.bottom },
        ...middle,
        { x: targetX, y: target.top - 5 },
      ];
      // Remove collinear grid points to keep paths and flyovers compact.
      const compact = points.filter(
        (p, i) =>
          !i ||
          i === points.length - 1 ||
          !(
            ((points[i - 1].x === p.x && p.x === points[i + 1].x) ||
              (points[i - 1].y === p.y && p.y === points[i + 1].y)) &&
            (p.x - points[i - 1].x) * (points[i + 1].x - p.x) +
              (p.y - points[i - 1].y) * (points[i + 1].y - p.y) >=
              0
          ),
      );
      // Check the port stems too; they are outside the search's inflated grid.
      const crossesNode = compact.some((q, i) => {
        if (!i) return false;
        const p = compact[i - 1],
          eps = 0.001;
        return bounds.some((o) =>
          p.y === q.y
            ? p.y > o.top + eps &&
              p.y < o.bottom - eps &&
              Math.max(p.x, q.x) > o.left + eps &&
              Math.min(p.x, q.x) < o.right - eps
            : p.x > o.left + eps &&
              p.x < o.right - eps &&
              Math.max(p.y, q.y) > o.top + eps &&
              Math.min(p.y, q.y) < o.bottom - eps,
        );
      });
      if (crossesNode) return null;
      routes.push({ path, points: compact, downward, edge });
    }
    return routes;
  }
  // Give each connection its own broad corridor. A tightly spaced forward
  // edge must not force a return loop to hug every neighboring box.
  const routes = [];
  for (const connection of connections) {
    let routed;
    for (const gap of [48, 32, 24, 16, 12, 6, 2, 0.5]) {
      routed = routesWithClearance(gap, [connection]);
      if (routed) break;
    }
    if (!routed)
      throw new Error(
        "Cannot route connections around overlapping node bounds. Increase flowchart nodeSpacing or rankSpacing.",
      );
    routes.push(...routed);
  }
  const mix = (a, b, t = 0.5) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  // Subdivide Bezier hulls until they are disjoint from node interiors. This
  // checks the whole curve, including narrow collisions between sample points.
  function curveFree(curve, depth = 0) {
    const left = Math.min(...curve.map((p) => p.x)),
      right = Math.max(...curve.map((p) => p.x)),
      top = Math.min(...curve.map((p) => p.y)),
      bottom = Math.max(...curve.map((p) => p.y));
    if (
      !bounds.some(
        (b) =>
          b !== ignoredSource &&
          left < b.right - 0.001 &&
          right > b.left + 0.001 &&
          top < b.bottom - 0.001 &&
          bottom > b.top + 0.001,
      )
    )
      return true;
    if (depth === 14) return false;
    const [a, b, c, d] = curve,
      ab = mix(a, b),
      bc = mix(b, c),
      cd = mix(c, d),
      abc = mix(ab, bc),
      bcd = mix(bc, cd),
      middle = mix(abc, bcd);
    return (
      curveFree([a, ab, abc, middle], depth + 1) &&
      curveFree([middle, bcd, cd, d], depth + 1)
    );
  }
  function flowingCurves(points, reversed, downward, centered) {
    const start = points[0],
      end = points[points.length - 1];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const handle = downward
      ? (end.y - start.y) * 0.4
      : Math.max(8, Math.abs(end.y - start.y) * 0.5, distance * 0.25);
    // Prefer a single flowing S-curve with vertical endpoint tangents. Loops
    // and blocked direct connections instead follow the obstacle corridor.
    const direct = [
      start,
      centered
        ? {
            x: start.x + (end.x - start.x) * 0.35,
            y: start.y + (end.y - start.y) * 0.25,
          }
        : { x: start.x, y: start.y + (reversed ? -handle : handle) },
      { x: end.x, y: end.y - handle },
      end,
    ];
    if (downward && distance > 0 && curveFree(direct)) return [direct];
    let polygon = points;
    for (let attempt = 0; attempt < 10; attempt++) {
      const curves = [];
      let cursor = polygon[0];
      for (let i = 1; i < polygon.length - 1; i++) {
        const control = polygon[i],
          end = mix(control, polygon[i + 1]);
        // Degree-elevated quadratic B-spline: adjacent segments share a
        // tangent and consume the full corridor, without radius-based elbows.
        curves.push([
          cursor,
          mix(cursor, control, 2 / 3),
          mix(end, control, 2 / 3),
          end,
        ]);
        cursor = end;
      }
      const end = polygon[polygon.length - 1];
      curves.push([
        cursor,
        mix(cursor, end, 1 / 3),
        mix(cursor, end, 2 / 3),
        end,
      ]);
      const unsafe = curves.map((curve) => !curveFree(curve));
      if (!unsafe.some(Boolean)) return curves;
      // Refine only near an obstacle; broad unobstructed sweeps remain intact.
      const refined = [polygon[0]];
      for (let i = 1; i < polygon.length; i++) {
        if (unsafe[i - 1] || unsafe[i])
          refined.push(mix(polygon[i - 1], polygon[i]));
        refined.push(polygon[i]);
      }
      polygon = refined;
    }
    throw new Error(
      "Cannot create a smooth connection clear of nodes. Increase flowchart nodeSpacing or rankSpacing.",
    );
  }
  const allPoints = [];
  routes.forEach(({ path, points, downward, edge }, index) => {
    const centered =
      branching.has(edge.start) && !path.hasAttribute("marker-start");
    ignoredSource = centered ? boxes.get(edge.start) : null;
    if (centered) {
      points = [
        {
          x: (ignoredSource.left + ignoredSource.right) / 2,
          y: (ignoredSource.top + ignoredSource.bottom) / 2,
        },
        ...points.slice(1),
      ];
    }
    const matrix = path.getCTM().inverse().multiply(coordinateRoot.getCTM());
    const commands = [];
    const command = (type, ...vertices) => {
      commands.push(
        type +
          vertices
            .map((p) => {
              const q = new DOMPoint(p.x, p.y).matrixTransform(matrix);
              return q.x + "," + q.y;
            })
            .join(" "),
      );
    };
    const curves = flowingCurves(
      points,
      path.hasAttribute("marker-start"),
      downward,
      centered,
    );
    command("M", curves[0][0]);
    curves.forEach((curve) => command("C", ...curve.slice(1)));
    path.setAttribute("d", commands.join(" "));
    if (centered) {
      // Keep the center-origin geometry for tracing, but hide the portion
      // inside the source shape even when that node is dimmed or transparent.
      const ns = "http://www.w3.org/2000/svg";
      let defs = svg.querySelector("defs");
      if (!defs) {
        defs = document.createElementNS(ns, "defs");
        coordinateRoot.prepend(defs);
      }
      const mask = document.createElementNS(ns, "mask");
      mask.id = svg.id + "-branch-source-" + index;
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      mask.setAttribute("maskContentUnits", "userSpaceOnUse");
      const vertices = curves
        .flat()
        .map((p) => new DOMPoint(p.x, p.y).matrixTransform(matrix));
      const sourceNode = nodeElements.get(edge.start);
      const shapes = [
        ...sourceNode.querySelectorAll("rect,polygon,circle,ellipse,path"),
      ].filter((shape) => !shape.closest(".label"));
      const shapePoints = shapes.flatMap((shape) => {
        const b = shape.getBBox(),
          m = path.getCTM().inverse().multiply(shape.getCTM());
        return [
          [b.x, b.y],
          [b.x + b.width, b.y + b.height],
        ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      });
      const extent = [...vertices, ...shapePoints];
      const x = Math.min(...extent.map((p) => p.x)) - 16,
        y = Math.min(...extent.map((p) => p.y)) - 16,
        width = Math.max(...extent.map((p) => p.x)) - x + 16,
        height = Math.max(...extent.map((p) => p.y)) - y + 16;
      for (const [key, value] of Object.entries({ x, y, width, height }))
        mask.setAttribute(key, value);
      const background = document.createElementNS(ns, "rect");
      for (const [key, value] of Object.entries({ x, y, width, height }))
        background.setAttribute(key, value);
      background.style.setProperty("fill", "white", "important");
      mask.append(background);
      shapes.forEach((shape) => {
        const silhouette = shape.cloneNode(true),
          m = path.getCTM().inverse().multiply(shape.getCTM());
        silhouette.removeAttribute("id");
        silhouette.removeAttribute("class");
        silhouette.setAttribute(
          "transform",
          `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`,
        );
        silhouette.setAttribute(
          "style",
          "fill:black!important;stroke:black!important;opacity:1!important",
        );
        mask.append(silhouette);
      });
      defs.append(mask);
      path.setAttribute("mask", `url(#${mask.id})`);
      path.dataset.centerRouted = "true";
    }
    path.style.strokeLinejoin = "round";
    path.dataset.topRouted = "true";
    const rootTransform =
      coordinateRoot.transform.baseVal.consolidate()?.matrix || new DOMMatrix();
    allPoints.push(
      ...curves
        .flat()
        .map((p) => new DOMPoint(p.x, p.y).matrixTransform(rootTransform)),
    );
  });
  const box = svg.getBBox();
  const left = Math.min(box.x, ...allPoints.map((p) => p.x)) - 16,
    top = Math.min(box.y, ...allPoints.map((p) => p.y)) - 16;
  const right = Math.max(box.x + box.width, ...allPoints.map((p) => p.x)) + 16,
    bottom = Math.max(box.y + box.height, ...allPoints.map((p) => p.y)) + 16;
  svg.setAttribute("viewBox", `${left} ${top} ${right - left} ${bottom - top}`);
}
