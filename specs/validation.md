# Pathloom validation

Build with `npm run build`. Run Chromium with `npm test`, Firefox with `npx playwright test --project=firefox`, or all configured engines with `npm run test:browsers` after installing their browsers and system dependencies.

Regression coverage:

- Offline file URL rendering; exact/chained edges and keyboard trace.
- Error preservation/recovery, recent edits, legacy storage cleanup, persistence, denied storage, and storage-free viewers.
- Script-safe offline export, invalid/empty export rejection, and visible initial viewer errors.
- Edits during export validation cancel download; pending export disables repeated activation.
- File import, edits after import, undo/switch-back, and exact source downloads.
- Center/zoom and selected step/history survive rendering, editor toggles, and resize; Clear trace preserves the viewport.
- Branch buttons and step picker provide textual, keyboard-operable selection while preview warnings remain independent.
- Responsive drawers and layout at 320, 390, 768, and 1440 px, long labels, non-ASCII input, an 81-node graph, and 200% root text size.
- axe WCAG A/AA checks on the initial and selected-branch states. Edge-label contrast was corrected based on measured findings.

Additional coverage: top-entry routing and sampled exclusion of every node interior for branches, return loops, self-loops, two-headed connections, and reduced rank spacing; left placement for every sidebar and overview; Start selecting/centering the entry step at real zoom one, including a 161-node chart; Clear view restoring all text without moving the camera; maximum canvas height, independent sidebar collapse, persisted panel visibility, mobile Escape/focus recovery, optional overview panning, and 500 ms edge flyovers. Flyover checks sample the camera against the curve, verify destination centering/constant zoom, and test cancellation/reduced motion.

Visual review: desktop 1440 × 900 and mobile 320/390 × 900. Inspect the editor, preview, trace controls, and wrapped toolbar.

Environment limits: Chromium and Firefox verified; WebKit fails to launch because libavif16 is absent. This is an environment block, not a passed test or an established app defect. Actual Safari, real mobile keyboard behavior, and manual assistive-technology checks remain open. Automated accessibility scans and enlarged-root-text tests are not substitutes for those checks.

Rounded routing verification: all 56 Chromium/Firefox checks passed. Branches, loops, bidirectional edges, and tight spacing include quadratic bends while preserving top-entry stems and avoiding node interiors. The default chart was also visually reviewed.

Flowing Bézier update: 16 focused checks passed across Chromium and Firefox, covering curves around node interiors, top-entry arrowheads, self/return loops, bidirectional edges, tight spacing, large diagrams, exports, Start, and the 500 ms flyover. Default-chart curves were visually reviewed. Each connection gets its own clearance corridor; paths use cubic Béziers throughout.

Gentler vertical flow: all 56 Chromium/Firefox checks passed, plus eight routing checks with added downward-monotonicity and outer-return-lane assertions. Default rank spacing increased to 140; explicit source overrides remain supported. The taller default chart was visually reviewed.

Path transitions: 12 focused Chromium/Firefox checks passed, covering Next, branch selection, keyboard traversal, reverse Back, cancellation without losing history, reduced motion, curve-following duration/geometry, and view preservation on rerender.

Centered branches: focused Chromium/Firefox checks cover center-origin geometry, fanning in opposite directions, source-shape masks, isolated overview references, exports, accessibility, routing clearance, top-entry arrowheads, and forward/reverse flyovers. Center-origin segments inside their own source are intentionally masked; click tests use an exposed portion of the curve. The default chart was visually reviewed.

Straight-line routing: connections now use only M/L commands and sharp joins. Focused Chromium/Firefox checks verify downward-only forward routes, outer return lanes, source-center branch masks, top-entry arrowheads, box clearance, exports, overview, and 500 ms forward/reverse transitions. The default chart was visually reviewed.

Incoming junction centers: 14 focused Chromium/Firefox checks passed. Incoming paths to branching objects terminate at their geometric center; masks hide internal target segments. Tests cover centered endpoints, node clearance, forward/reverse path transitions, overview references, and exported viewers.

Vertical arrivals and visible arrowheads: 16 focused Chromium/Firefox checks passed. Diagonal shortcuts were removed; incoming junctions retain masked center geometry and a visible vertical arrowhead at the top boundary. Tests verify arrival-stem direction/marker preservation, centered paths, obstacle clearance, exports, and path-following animation. Default-chart appearance was visually reviewed.

Single-segment connections: focused Chromium/Firefox checks pass for center collinearity, exactly one M/L segment, actual-shape clipping, external arrowhead tips, isolated overview masks, exported viewers, large charts, Start, and forward/reverse path transitions. The default chart was visually reviewed. Geometry tests account for SVG scaling when measuring marker length.

Destination repositioning: the 64-case Chromium/Firefox suite covered layout, exports, accessibility, geometry, and tracing. Three failures exposed outdated test expectations (initial selection and clipped-line-only flight sampling); corrected checks passed on focused rerun. New cases verify destination-only movement clearing an intervening node and a bounded-search exception retaining a single straight line and external arrowhead. The default chart now moves Review and reports zero exceptions; its layout was visually reviewed.

Label collision layout: focused Chromium/Firefox checks passed for front paint order, 12 parallel labeled connections without label/label or label/node overlaps, destination expansion, anchored positions through zoom/Fit, exported viewer regeneration, accessibility, overview, straight-path geometry, large diagrams, routing exceptions, and 500 ms transitions. The default chart was visually reviewed. Remaining labels that cannot fit on their line are placed in free space and marked as label offsets rather than allowed to overlap.
