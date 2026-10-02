# Pathloom engineering principles

1. Ship a standalone offline HTML app and viewer. No runtime network dependency or telemetry.
2. Keep authoring source readable in `src/`; keep vendored libraries separate. Build with a small deterministic script. No build is needed to open the delivered app.
3. Rendering is the core feature. Errors retain the last valid diagram; optional geometry must not prevent rendering.
4. Use Mermaid's graph model for connections and exact SVG classes for edge matching. Do not infer connections with text splitting or substring guesses.
5. Preserve source as entered, export with safe script escaping, and skip persistence in viewers. Handle unavailable storage gracefully.
6. Provide keyboard access, visible focus, meaningful status, and a layout that works when the toolbar wraps.
7. Add regression coverage for consequential behavior changes. Keep documentation aligned with the implementation.
8. Use fictional sample content and repository identity. Preserve third-party attribution and license notices.

Amendment: readable source, assembly scripts, and regression tests now remain in the repository. The original temporary-source convention made the generated artifact unnecessarily difficult to maintain; distribution is still one file.
