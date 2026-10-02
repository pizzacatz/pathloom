# Pathloom validation

Run `npm ci`, `npm run build`, and `npm test` with Python 3 and Google Chrome installed. Override the browser binary with `CHROME_BIN` if necessary.

Automated Chromium checks:

- Offline opening from a file URL renders the fictional starter diagram.
- Chained edges, overlapping node names, branch choices, keyboard activation, and Back use correct connections.
- Invalid source retains the last valid diagram; correction recovers and recent edits win.
- Denied storage does not block rendering; viewer mode renders with storage inaccessible.
- Legacy draft removal and new draft persistence work.
- Export contains current source, safely escapes a script closing tag, and opens offline.
- A 390 px viewport does not overlap toolbar and editor; sequence diagrams render without trace controls.

Visual review: desktop at 1440 × 900 and mobile at 390 × 844. Inspect toolbar grouping, source readability, preview fit, and status placement.

Manual follow-up: Firefox/Safari, large diagrams, long labels at extreme zoom, parallel edges, printing, and screen-reader navigation. Do not treat Chromium coverage as cross-browser verification.
