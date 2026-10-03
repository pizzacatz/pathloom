# Pathloom specification

## Distribution and privacy

`python3 scripts/build.py` joins the readable shell, vendored libraries, routing code, and app code into a standalone studio and fictional example viewer. Both work from file URLs without runtime network access. Preserve third-party licenses. Viewers never read or write browser storage.

## Editing and state

Persist source on input under `pathloom.source.v1`, remove the legacy draft key at studio startup, and report storage failure independently of preview status. Debounce preview updates for 700 ms. Render now clears the timer. The canvas remains visible while mobile panels act as overlays; request generations discard outdated work. Keep the last valid diagram on errors, explicitly distinguish stale/absent/empty previews, and show actionable errors with optional technical details.

Open source files asynchronously without overwriting edits made during reading. Retain the replaced source in memory; undo swaps it with the current source so neither side is lost. Source download preserves exact text, including invalid syntax. Warn on navigation only when storage is unavailable and the current source has not been handed off for download.

## Canvas and trace

Use Mermaid's graph database and exact SVG edge classes for connections. A rectilinear obstacle router changes flowchart edge paths before pan/zoom initialization: outgoing lines leave the source bottom, incoming arrowheads approach the destination top vertically, and two-headed edges use top ports at both ends. Node bounds are inflated for clearance; A* searches an orthogonal visibility grid. Return loops and self-loops avoid node interiors. Tight spacing can reduce clearance, but terminal arrow stems remain correctly oriented. Unroutable geometry reports a recoverable error while preserving the last valid diagram. Routing occurs in a hidden candidate SVG before replacing the canvas. Labels, hit targets, overview, and flyovers use the routed paths. Non-flowchart diagrams render without trace. Keep the selected node and valid history entries across renders, and preserve the content point at the canvas center and real zoom when possible. Layout changes resize without refitting. Fit is explicit; Clear view never moves the viewport. The top-strip Start action selects the first node with no incoming flowchart connection (falling back to the first rendered node), resets history, sets real zoom to one, and centers it. Actual-size mode extends relative zoom limits when required for large charts. Direct selection pans minimally to reveal the node. Clicking an edge or its paired label follows the actual curve with a 500 ms eased pan at constant zoom, finishing at the target center. Flyovers cancel on direct manipulation, selection, source edits, rendering, or layout changes; reduced motion uses immediate selection. Edges have invisible 12 px click targets.

Offer equivalent node, step-select, and branch-button controls. Expose the current node with aria-pressed, text, and a solid outline; successors have dashed outlines. Maintain branch-button focus after activation. Node Enter/Space and diagram-scoped arrows navigate without intercepting native form controls. Optional adaptive label geometry cannot block rendering.

## Shell and export

Use coherent color, spacing, type, and control-size roles. The canvas occupies the full workspace height below one compact control strip. Source, Path, and Help are independently collapsible left sidebars, initially closed; studio panel visibility persists. At widths up to 1000 px they become mutually exclusive drawers without shrinking the canvas. Escape closes the active panel and returns focus. No bottom trace panel or branding header reserves canvas space. Routine preview/save feedback lives in Source; viewer errors open Path. The optional collapsible left-aligned Overview map shows the viewport and supports click-to-pan. Full step selection is behind a Jump to step disclosure. Keep file/render controls by the editor, trace controls together, and zoom controls by the preview. Help is a reversible disclosure. Clearly label fictional example content.

Export must render-validate and route-validate the exact source snapshot, disable repeated activation, reject empty/invalid input, and cancel if source changes while validating. Escape less-than characters in embedded source JSON. Clear rendered/editor/error/import feedback from the cloned viewer. Report download initiation accurately. Viewer error messages must remain visible outside hidden authoring content.
