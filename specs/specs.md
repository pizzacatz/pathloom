# Pathloom specification

## Distribution and privacy

`python3 scripts/build.py` joins the readable shell, vendored libraries, and app code into a standalone studio and fictional example viewer. Both work from file URLs without runtime network access. Preserve third-party licenses. Viewers never read or write browser storage.

## Editing and state

Persist source on input under `pathloom.source.v1`, remove the legacy draft key at studio startup, and report storage failure independently of preview status. Debounce preview updates for 700 ms. Render now clears the timer. Hidden mobile previews defer rendering until measurable; request generations discard outdated work. Keep the last valid diagram on errors, explicitly distinguish stale/absent/empty previews, and show actionable errors with optional technical details.

Open source files asynchronously without overwriting edits made during reading. Retain the replaced source in memory; undo swaps it with the current source so neither side is lost. Source download preserves exact text, including invalid syntax. Warn on navigation only when storage is unavailable and the current source has not been handed off for download.

## Canvas and trace

Use Mermaid's graph database and exact SVG edge classes for connections. Non-flowchart diagrams render without trace. Keep the selected node and valid history entries across renders, and preserve the content point at the canvas center and real zoom when possible. Layout changes resize without refitting. Fit is explicit; Clear trace never moves the viewport.

Offer equivalent node, step-select, and branch-button controls. Expose the current node with aria-pressed, text, and a solid outline; successors have dashed outlines. Maintain branch-button focus after activation. Node Enter/Space and diagram-scoped arrows navigate without intercepting native form controls. Optional adaptive label geometry cannot block rendering.

## Shell and export

Use coherent color, spacing, type, and control-size roles. Desktop shows source and preview; narrow layouts switch Source/Preview instead of stacking both. Keep file/render controls by the editor, trace controls together, and zoom controls by the preview. Help is a reversible disclosure. Clearly label fictional example content.

Export must render-validate the exact source snapshot, disable repeated activation, reject empty/invalid input, and cancel if source changes while validating. Escape less-than characters in embedded source JSON. Clear rendered/editor/error/import feedback from the cloned viewer. Report download initiation accurately. Viewer error messages must remain visible outside hidden authoring content.
