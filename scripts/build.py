"""Assemble the offline app and its fictional example viewer (no dependencies)."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent.parent

def build():
    shell = (ROOT / 'src/shell.html').read_text()
    app = (ROOT / 'src/app.js').read_text()
    scripts = '\n'.join('<script>\n' + (ROOT / name).read_text() + '\n</script>' for name in (
        'vendor/mermaid.min.js', 'vendor/svg-pan-zoom.min.js', 'src/app.js'))
    html = shell.replace('<!-- SCRIPTS -->', scripts)
    (ROOT / 'index.html').write_text(html)
    source = re.search(r'const DEFAULT_SRC = `([\s\S]*?)`;', app).group(1)
    flags = '<script>window.__FLOWCHART_VIEWER__=true;window.__FLOWCHART_SRC__=' + json.dumps(source).replace('<', '\\u003c') + ';</script>'
    (ROOT / 'flowchart.html').write_text(html.replace('</head>', flags + '\n</head>', 1))
    print('Built index.html and flowchart.html')

if __name__ == '__main__':
    build()
