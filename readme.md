# Pathloom

An offline Mermaid diagram workspace. Write source, follow a process step by step, and export an interactive HTML viewer. Open `index.html` directly in your browser; no server, installation, or internet connection is required.

The example is fictional: Mara Vale reviews an Alderwick Systems workspace request using Harbor CRM and Lantern Desk.

## Use

- Edit the source; changes save locally and render after 700 ms. **Render** updates immediately.
- Select a node, edge, or edge label to trace. **Next** follows a single connection; choose a highlighted branch at decisions. **Back** retraces your path.
- Nodes support Tab and Enter/Space. Arrow keys navigate the trace outside the editor.
- **Fit**, **100%**, zoom buttons, and dragging control the canvas. **Editor** toggles the source panel.
- **Export HTML** downloads `flowchart.html`, containing the current source and all runtime code. Viewers do not use browser storage.
- Invalid source leaves the last valid diagram visible. Status messages explain rendering, branching, and unavailable local storage.

## Develop

The delivered app remains a single file. Edit the readable source files, then rebuild:

```sh
python3 scripts/build.py
```

| Location | Purpose |
| --- | --- |
| `src/shell.html` | Layout, styles, accessible controls |
| `src/app.js` | Rendering, persistence, graph tracing, export |
| `vendor/` | Existing bundled dependencies, unchanged |
| `scripts/build.py` | Deterministic assembly of app and fictional viewer |
| `tests/app.spec.js` | Browser regression coverage |
| `index.html` | Generated standalone editor |
| `flowchart.html` | Generated standalone example viewer |

For browser tests, install Node.js dependencies with `npm ci`, then run `npm test`. Tests use Google Chrome at `/usr/bin/google-chrome`; set `CHROME_BIN` for another Chromium executable. Python 3 is required only to rebuild. Commit source and regenerated HTML together.

Third-party dependency names and license notices remain intact. See `vendor/README.md` for bundle hashes and provenance limitations.

## Privacy

All project-specific identifying sample content was replaced, including the pre-generated viewer. The studio uses `pathloom.source.v1` and deletes its legacy `mermaid_studio_src` key on startup when browser storage is accessible. This applies to the origin/storage context in which the updated app is opened; copies, exports, backups, and other browser profiles outside this project are not modified. Newly entered source remains on that device and is included when exported.

## Limitations and next improvements

- Trace depends on the bundled Mermaid flowchart model and SVG classes. Other diagram types render with pan/zoom but do not offer tracing. Unmatched flowchart edges are omitted from trace.
- Adaptive labels are paired by render order only when label/path counts agree. Explicit label-to-edge mapping is a worthwhile next improvement.
- Both artifacts include the runtime libraries and are approximately 3.4 MB. Exports contain hidden editor code.
- The inherited Mermaid bundle was not upgraded; its exact release provenance needs verification before a dependency upgrade.
- Automated verification covers Chromium. Firefox and Safari remain manual checks.

Prioritize dependency provenance and cross-browser coverage next, followed by `.mmd` import/source download and undoable named documents. Keep those features focused on real authoring tasks.
