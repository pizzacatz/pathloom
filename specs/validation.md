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
- Responsive view switching at 320, 390, 768, and 1440 px, long labels, non-ASCII input, an 81-node graph, and 200% root text size.
- axe WCAG A/AA checks on the initial and selected-branch states. Edge-label contrast was corrected based on measured findings.

Visual review: desktop 1440 × 900 and mobile 320/390 × 900. Inspect the editor, preview, trace controls, and wrapped toolbar.

Environment limits: Chromium and Firefox verified; WebKit fails to launch because libavif16 is absent. This is an environment block, not a passed test or an established app defect. Actual Safari, real mobile keyboard behavior, and manual assistive-technology checks remain open. Automated accessibility scans and enlarged-root-text tests are not substitutes for those checks.
