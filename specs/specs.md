# Pathloom specification

## Distribution

`python3 scripts/build.py` joins `src/shell.html`, the two vendored runtime libraries, and `src/app.js`. It produces a standalone studio (`index.html`) and a fictional example viewer (`flowchart.html`). Source markers and viewer flags must be inserted only at intended shell locations.

## Rendering and persistence

Use Mermaid with strict security, dark theme, HTML labels, and no automatic document scanning. Debounce edits for 700 ms; Render clears the debounce. A request generation counter prevents outdated results or errors from replacing newer edits. On invalid input, display an inline alert while retaining the last valid canvas.

Save editor input immediately under `pathloom.source.v1`. At studio startup, remove the legacy draft key without migrating it. Catch storage failures and disclose them in the status bar. Viewer mode neither reads nor writes storage.

## Graph interaction

Read connections from Mermaid's parsed diagram database. Match rendered edges by exact `LS-<source>` and `LE-<target>` classes. Unknown endpoints or missing classes disable those connections. Deduplicate successors while highlighting all parallel paths. Other diagram types render without trace controls.

Clicking a node selects it; successors and connecting edges highlight. Pan to the selected node while preserving zoom. Next starts at Start, if present, or the first node with a recognized outgoing edge; it advances only through a single successor. Back uses history. Branch and terminal states appear in the status bar. Nodes accept keyboard activation; arrow navigation must not interfere with editor typing.

Adaptive labels remain on their actual path curves. Label/path pairing requires matching counts. Optional geometry failures are non-fatal.

## Layout and export

Use a wrapping grouped toolbar, labeled source textarea, inline error alert, preview region, and persistent live status. On narrow screens stack the editor above the preview. Fit, actual-size, zoom, and reset controls remain available in viewers.

Export clones the shell and runtime scripts, clears current diagram/editor/error/status content, and injects viewer flags and the current source. Escape `<` as a JavaScript Unicode escape before embedding JSON. Download an offline HTML viewer; hide all authoring controls and skip persistence.
