# Pathloom

An offline Mermaid diagram workspace. Write source, follow a process step by step, and export an interactive HTML viewer. Open `index.html` directly in your browser; no server, installation, or internet connection is required.

The labeled example is fictional: Mara Vale reviews an Alderwick Systems workspace request using Harbor CRM and Lantern Desk.

## Write and keep your source

- Changes save immediately in this browser when storage is available and render after 700 ms. **Render now** updates immediately. The canvas is always visible; open **Source** when you want to edit.
- The save indicator reports success or failure independently of preview and trace status. When storage is unavailable, download your source; leaving with an unprotected draft prompts the browser's standard warning.
- **Open Mermaid file** accepts source files. **Undo file replacement** restores the previous draft, including after further edits; pressing it again switches back. This recovery lasts for the current session.
- **Download source** creates an editable `diagram.mmd` file, including unfinished or invalid source.
- **Help** provides syntax, tracing, and sharing guidance without leaving the app.

## Inspect a diagram

- The canvas fills the window below a compact control strip. **Source**, **Path**, and **Help** each open a collapsible sidebar on the left. The overview also opens at the left edge of the canvas. They start closed, and studio panel visibility is remembered locally. On screens up to 1000 px, one temporary drawer opens at a time; Escape closes it and restores focus. No panel occupies a strip above or below the diagram.
- **Start** selects the first entry step, resets the trace history, switches to actual size, and centers that step. It works even when a large chart needs zoom beyond the default fit-based limit. **Clear view** removes selection, dimming, and highlighting without moving the camera.
- **Fit**, **Actual size**, zoom buttons, and dragging control the canvas. Re-rendering, resizing, and panel toggling preserve the content point at the canvas center and the scale where possible. The optional **Overview** map shows the viewport and lets you click to pan; it also collapses.
- Select a diagram node or open **Path → Jump to step** for the labeled **Step** list. The current step and available next steps also appear as text. Use branch buttons at decisions, **Next** for one successor, and **Back** to retrace your path.
- Each flowchart connection is a single straight line aligned with the centers of its two objects. Visible endpoints are clipped to the actual shapes, and arrowheads sit outside the destination. Blocked connections trigger destination repositioning, with overlap checks and existing vertical order preserved. If the bounded placement search cannot clear a connection, it remains a marked layout exception; hover the line or Path branch choice for details. Shape masks keep unresolved crossings off node text. There are no curves or elbows. Two-headed connections retain external arrowheads at both ends.
- Clicking a connecting line or its label flies along the actual edge route for 500 ms to the destination, keeping zoom unchanged. Path Next, branch choices, and arrow-key navigation use the same transition; Back follows the connection in reverse. Direct node selection pans only enough to reveal the node. Dragging, zooming, layout changes, editing, or another selection cancel a flight. Reduced-motion preferences skip the animation.
- Nodes support Tab and Enter/Space. With the diagram focused, arrows navigate, F fits, +/− zoom, and 0 restores actual size. Current selection is exposed programmatically; successor outlines are dashed. Focused nodes remain fully visible.
- **Clear view** clears selection/history without moving the canvas. Rendering preserves selected node and history when their IDs still exist.
- Invalid source keeps the last valid diagram and opens the Source panel with recovery guidance and expandable technical details. Source status reports outdated/empty/absent previews; a small dot on the Source control flags an outdated preview. Viewer errors open the Path sidebar. Routine feedback stays out of the canvas.

## Share a viewer

**Export viewer** validates the exact current source and its routed connections by rendering it before downloading `flowchart.html`. Empty or invalid source cannot produce a broken export. Editing during validation cancels that export; retry with the updated source. Repeated activation is disabled while validating.

The viewer contains the source and all runtime code, works offline, hides authoring controls, and never uses browser storage. Its errors open the Path sidebar. A download-started message reports the browser handoff, not a guarantee that a file was saved.

## Develop

Edit `src/shell.html` and `src/app.js`, then rebuild:

```sh
python3 scripts/build.py
npm ci
npm test
```

Python 3 is required to build; Node.js is needed only for tests. Neither is required to open the distributed HTML. Commit readable source and regenerated HTML together.

| Location | Purpose |
| --- | --- |
| `src/shell.html` | Layout, design tokens, accessible controls |
| `src/app.js` | Rendering, persistence, trace, import, export |
| `src/routing.js` | Top-entry connections and obstacle avoidance |
| `vendor/` | Existing runtime bundles and provenance notes |
| `scripts/build.py` | Deterministic app and fictional viewer assembly |
| `tests/app.spec.js` | Behavior, layout, and automated accessibility checks |
| `index.html` | Standalone editor |
| `flowchart.html` | Standalone example viewer |

`npm test` runs Chromium using `/usr/bin/google-chrome`; set `CHROME_BIN` for another Chromium binary. To test other engines, install their Playwright browsers and system prerequisites, then run `npx playwright test --project=firefox` or `--project=webkit`. `npm run test:browsers` runs all three projects. Automated accessibility checks use axe and do not establish complete accessibility conformance.

## Privacy and limitations

- Project examples and repository identity are fictional. Third-party attribution remains intact.
- The studio deletes its legacy `mermaid_studio_src` draft key on startup when accessible. The replacement key is `pathloom.source.v1`. Other profiles, exported copies, and external backups are untouched.
- Browser storage is a convenience, not a portable backup. Download source to keep editable copies elsewhere. Imported-file undo and trace history are session-only.
- Trace depends on Mermaid's flowchart model and SVG classes. Other diagram types render without flowchart tracing. Adaptive edge-label association still depends on matching render order/counts.
- HTML exports include hidden authoring code and remain approximately 3.4 MB.
- The inherited Mermaid bundle's exact release provenance still needs verification before upgrading it.
- Chromium and Firefox were verified. WebKit could not launch here because its required `libavif16` system dependency is absent. Safari, real mobile keyboards, and manual screen-reader behavior remain unverified.
