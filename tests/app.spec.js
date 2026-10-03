const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const appURL = pathToFileURL(path.resolve('index.html')).href;

async function openSource(page) {
  if (await page.locator('#editor').evaluate(el => el.classList.contains('hidden'))) await page.locator('#toggle').click();
}
async function openPath(page, jump = false) {
  if (await page.locator('#trace').evaluate(el => el.classList.contains('hidden'))) await page.locator('#trace-toggle').click();
  if (jump) await page.locator('#jump').evaluate(el => { el.open = true; });
}
async function clickEdge(page, selector, fraction = .25) {
  const point = await page.locator(selector).evaluate((edge, fraction) => {
    const point = edge.getPointAtLength(edge.getTotalLength() * fraction);
    const screen = point.matrixTransform(edge.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, fraction);
  await page.mouse.click(point.x, point.y);
}
async function render(page, source) {
  await openSource(page);
  await page.locator('#src').fill(source);
  await page.locator('#render').click();
  await expect(page.locator('#status')).not.toContainText('Rendering');
}

test('offline rendering, exact connections, chains, branches and keyboard trace', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.setOffline(true);
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#stage g.node')).toHaveCount(8);
  await render(page, 'flowchart LR\nA[First step] --> AA[Second step] --> B{Choose path}\nB -->|Yes| C[Finish]\nB -->|No| D[Review]');
  await expect(page.locator('#stage g.node')).toHaveCount(5);
  await openPath(page);
  await page.locator('#next').click();
  await expect(page.locator('.hl-cur')).toContainText('First step');
  await expect(page.locator('.hl-next')).toContainText('Second step');
  await expect(page.locator('.hl-edge')).toHaveCount(1);
  await openPath(page);
  await page.locator('#next').click();
  await expect(page.locator('.hl-cur')).toContainText('Second step');
  await openPath(page);
  await page.locator('#next').click();
  await expect(page.locator('#next')).toBeDisabled();
  await expect(page.locator('#trace-status')).toContainText('Choose a branch');
  await page.locator('#stage g.node').filter({ hasText: 'Finish' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.hl-cur')).toContainText('Finish');
  await page.locator('#back').click();
  await expect(page.locator('.hl-cur')).toContainText('Choose path');
  expect(errors).toEqual([]);
});

test('invalid input preserves diagram, recovery works, newest render wins', async ({ page }) => {
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await render(page, 'flowchart LR\nA[Keep this] --> B[Visible]');
  await expect(page.locator('#stage')).toContainText('Keep this');
  await render(page, 'flowchart LR\nA[');
  await expect(page.locator('#err')).toContainText('Unable to render');
  await expect(page.locator('#stage')).toContainText('Keep this');
  await page.locator('#src').fill('flowchart LR\nX[Older] --> Y');
  await page.locator('#render').click();
  await render(page, 'flowchart LR\nX[Newest] --> Y');
  await expect(page.locator('#stage')).toContainText('Newest');
  await expect(page.locator('#err')).toBeEmpty();
});

test('storage denied does not stop rendering; viewer never accesses storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage denied'); } });
  });
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await expect(page.locator('#save-status')).toContainText('Not saved');
  await page.goto(pathToFileURL(path.resolve('flowchart.html')).href);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#status')).not.toContainText('unavailable');
});

test('legacy draft is removed and new drafts persist', async ({ page }) => {
  await page.goto(appURL);
  await openSource(page);
  await page.evaluate(() => { localStorage.setItem('mermaid_studio_src', 'legacy private draft'); });
  await page.reload();
  await expect(page.locator('#src')).not.toHaveValue('legacy private draft');
  expect(await page.evaluate(() => localStorage.getItem('mermaid_studio_src'))).toBeNull();
  await render(page, 'flowchart TD\nA[Saved draft] --> B');
  await page.reload();
  await expect(page.locator('#src')).toHaveValue('flowchart TD\nA[Saved draft] --> B');
});

test('export preserves current source safely and opens offline', async ({ page, context }, testInfo) => {
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await render(page, 'flowchart TD\nA[Previous unshared label] --> B');
  const source = 'flowchart TD\nA[Exported chart] --> B[Done]\n%% </script><script>window.injected=true</script>';
  await page.locator('#src').fill(source);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  const output = testInfo.outputPath('viewer.html');
  await download.saveAs(output);
  const html = await fs.readFile(output, 'utf8');
  expect(html).not.toContain('</script><script>window.injected');
  expect(html).not.toContain('Previous unshared label');
  await context.setOffline(true);
  await page.goto(pathToFileURL(output).href);
  await expect(page.locator('#stage')).toContainText('Exported chart');
  await expect(page.locator('#editor')).toBeHidden();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('mobile toolbar does not overlap editor; non-flowchart diagrams render', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#save-status')).toContainText('Saved');
  const header = await page.locator('#controls').boundingBox();
  const editor = await page.locator('#editor').boundingBox();
  expect(editor.y).toBeGreaterThanOrEqual(header.y + header.height);
  await render(page, 'sequenceDiagram\nAlice->>Bob: Hello');
  await page.locator('#source-close').click();
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await expect(page.locator('#next')).toBeDisabled();
});

test('invalid and empty exports never download; initial viewer failures stay visible', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await render(page, 'flowchart LR\nA[');
  await page.locator('#export').click();
  await expect(page.locator('#err')).toContainText('Viewer not exported');
  await expect(page.locator('#error-box')).toBeVisible();
  await expect(page.locator('#status')).toContainText('out of date');
  await openPath(page);
  await page.locator('#next').click();
  await expect(page.locator('#status')).toContainText('out of date');
  await render(page, '');
  await expect(page.locator('#status')).toContainText('Source is empty');
  await page.locator('#export').click();
  await expect(page.locator('#err')).toContainText('Viewer not exported');
  expect(downloads).toBe(0);
  await page.addInitScript(() => { window.__FLOWCHART_VIEWER__ = true; window.__FLOWCHART_SRC__ = 'flowchart LR\nA['; });
  await page.reload();
  await expect(page.locator('#err')).toContainText('Ask the author');
  await expect(page.locator('#error-box')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('No preview available');
});

test('file import, editing, reversible replacement and exact source download', async ({ page }) => {
  await page.goto(appURL);
  await openSource(page);
  const original = await page.locator('#src').inputValue();
  const imported = 'flowchart TD\nA[Imported request] --> B[Done]';
  await page.locator('#file-input').setInputFiles({ name: 'sample.mmd', mimeType: 'text/plain', buffer: Buffer.from(imported) });
  await expect(page.locator('#src')).toHaveValue(imported);
  await expect(page.locator('#example-note')).toBeHidden();
  await page.locator('#src').fill(imported + '\n%% extra edit');
  await page.locator('#undo-import').click();
  await expect(page.locator('#src')).toHaveValue(original);
  await page.locator('#undo-import').click();
  await expect(page.locator('#src')).toHaveValue(imported + '\n%% extra edit');
  const pending = page.waitForEvent('download');
  await page.locator('#download-source').click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe('diagram.mmd');
  expect(await fs.readFile(await file.path(), 'utf8')).toBe(imported + '\n%% extra edit');
});

test('rerender, editor toggle, resizing and clear trace preserve canvas context', async ({ page }) => {
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#status')).toContainText('up to date');
  await openPath(page);
  await page.locator('#next').click();
  await openPath(page);
  await page.locator('#next').click();
  await page.locator('#zin').click();
  const before = await page.evaluate(() => captureView());
  await page.locator('#render').click();
  await expect(page.locator('#status')).toContainText('up to date');
  await expect(page.locator('.hl-cur')).toContainText('Mara Vale');
  await expect(page.locator('#back')).toBeEnabled();
  await page.locator('#toggle').click();
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.locator('#reset').click();
  await expect(page.locator('.hl-cur')).toHaveCount(0);
  await expect.poll(async () => {
    const after = await page.evaluate(() => captureView());
    return Math.max(...['x', 'y', 'scale'].map(key => Math.abs(after[key] - before[key])));
  }).toBeLessThan(0.1);
});

test('branch buttons and step picker expose trace state without changing preview status', async ({ page }) => {
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#status')).toContainText('up to date');
  await openPath(page, true);
  await page.locator('#step-picker').selectOption('Decision');
  await expect(page.locator('#trace-status')).toContainText('Current step: Workspace approved?');
  await expect(page.locator('.hl-cur')).toHaveAttribute('aria-pressed', 'true');
  const branch = page.locator('#branches button').filter({ hasText: 'Yes: Create' });
  await branch.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#trace-status')).toContainText('Create a workspace');
  await expect(page.locator('#branches button')).toBeFocused();
  await expect(page.locator('#status')).toContainText('up to date');
});

for (const width of [320, 390, 768, 1440]) {
  test(`layout, mobile view switching and long content at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(appURL);
    await openSource(page);
    await page.locator('#src').fill('flowchart TD\nA["' + 'Long request '.repeat(12) + '"] --> B["確認済み"]');
    await page.locator('#render').click();
    if (width <= 1000) await page.locator('#source-close').click();
    await expect(page.locator('#status')).toContainText('up to date');
    await expect(page.locator('#stage svg')).toBeVisible();
    await openPath(page, true);
    await page.locator('#step-picker').selectOption('A');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const view = await page.evaluate(() => captureView());
    expect(view.scale).toBeGreaterThan(0);
    if (width <= 1000) {
      await openSource(page);
      await expect(page.locator('#src')).toBeVisible();
      await page.locator('#source-close').click();
      await expect(page.locator('.hl-cur')).toContainText('Long request');
    }
    expect(errors).toEqual([]);
  });
}

test('large flowchart and enlarged text remain usable', async ({ page }) => {
  await page.goto(appURL);
  await openSource(page);
  await render(page, 'flowchart TD\n' + Array.from({ length: 80 }, (_, i) => `N${i}[Step ${i}] --> N${i + 1}`).join('\n'));
  await expect(page.locator('#stage g.node')).toHaveCount(81);
  await openPath(page, true);
  await page.locator('#step-picker').selectOption('N60');
  await expect(page.locator('#trace-status')).toContainText('Step 60');
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await expect(page.locator('#next')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openPath(page);
  await page.locator('#next').click();
  await expect(page.locator('#trace-status')).toContainText('Step 61');
});

test('editor and traced diagram pass automated accessibility checks', async ({ page }) => {
  const { default: AxeBuilder } = require('@axe-core/playwright');
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#status')).toContainText('up to date');
  for (const selection of ['', 'Decision']) {
    if (selection) { await openPath(page, true); await page.locator('#step-picker').selectOption(selection); }
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  }
});

test('export rejects edits made during validation and prevents duplicate activation', async ({ page }) => {
  await page.goto(appURL);
  await openSource(page);
  await expect(page.locator('#status')).toContainText('up to date');
  await page.evaluate(() => {
    const original = mermaid.render.bind(mermaid);
    mermaid.render = async (...args) => {
      if (args[0].startsWith('exportCheck')) await new Promise(resolve => { window.releaseExport = resolve; });
      return original(...args);
    };
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.locator('#export').click();
  await expect(page.locator('#export')).toBeDisabled();
  await page.locator('#src').fill('flowchart LR\nA[Changed during export] --> B');
  await page.evaluate(() => window.releaseExport());
  await expect(page.locator('#export')).toBeEnabled();
  expect(downloads).toBe(0);
});

test('canvas uses full height and panels collapse independently without changing zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(appURL);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  const stage = await page.locator('#stage').boundingBox();
  expect(stage.height).toBeGreaterThan(850);
  expect(stage.width).toBe(1440);
  await page.locator('#zin').click();
  const before = await page.evaluate(() => captureView());
  await openSource(page);
  await openPath(page);
  await page.locator('#help-toggle').click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#trace')).toBeVisible();
  await expect(page.locator('#help')).toBeVisible();
  await page.locator('#help-close').click();
  await page.locator('#source-close').click();
  await expect(page.locator('#trace')).toBeVisible();
  await page.locator('#trace-close').click();
  await expect.poll(async () => {
    const after = await page.evaluate(() => captureView());
    return Math.max(...['x', 'y', 'scale'].map(key => Math.abs(after[key] - before[key])));
  }).toBeLessThan(.1);
  await openPath(page);
  await page.reload();
  await expect(page.locator('#trace')).toBeVisible();
});

test('mobile drawers close on Escape and return focus without shrinking the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appURL);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  const before = await page.locator('#stage').boundingBox();
  await openSource(page);
  await openPath(page);
  await expect(page.locator('#editor')).toBeHidden();
  expect((await page.locator('#stage').boundingBox()).height).toBe(before.height);
  await page.keyboard.press('Escape');
  await expect(page.locator('#trace')).toBeHidden();
  await expect(page.locator('#trace-toggle')).toBeFocused();
});

test('line click follows the curve for 500 ms, preserves zoom and lands on destination', async ({ page }) => {
  await page.goto(appURL);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await page.locator('#onehundred').click();
  const edgeSelector = '#stage g.edgePaths path.LS-Decision.LE-Setup';
  await page.evaluate(() => {
    const node = stage.querySelector('g.node[data-id="Decision"]');
    const svg = stage.querySelector('svg'), viewport = stage.querySelector('.svg-pan-zoom_viewport');
    const box = node.getBBox(), point = svg.createSVGPoint();
    point.x = box.x + box.width/2; point.y = box.y + box.height/2;
    const center = point.matrixTransform(node.getCTM()).matrixTransform(viewport.getCTM().inverse());
    restoreView({ ...captureView(), x: center.x, y: center.y });
  });
  await page.evaluate(() => {
    window.flightSamples = [];
    window.flightStart = null;
    const sample = time => {
      if (stage.getAttribute('aria-busy') === 'true') {
        window.flightStart ??= time;
        window.flightSamples.push({ time, ...captureView() });
      } else if (window.flightStart !== null) window.flightEnd = time;
      if (!window.flightEnd) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const scale = await page.evaluate(() => captureView().scale);
  await clickEdge(page, edgeSelector);
  await expect(page.locator('#stage')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#stage .hl-cur')).toContainText('Create a workspace');
  await expect.poll(() => page.evaluate(() => window.flightEnd || 0)).toBeGreaterThan(0);
  const result = await page.evaluate(() => {
    const path = stage.querySelector('path.LS-Decision.LE-Setup'), viewport = stage.querySelector('.svg-pan-zoom_viewport');
    const matrix = viewport.getCTM().inverse().multiply(path.getCTM());
    const curve = Array.from({ length: 101 }, (_, i) => path.getPointAtLength(path.getTotalLength()*i/100).matrixTransform(matrix));
    const middle = window.flightSamples.slice(Math.floor(window.flightSamples.length*.3), Math.floor(window.flightSamples.length*.7));
    const curveDistance = Math.max(...middle.map(sample => Math.min(...curve.map(point => Math.hypot(sample.x-point.x, sample.y-point.y)))));
    const node = stage.querySelector('.hl-cur').getBoundingClientRect(), canvas = stage.getBoundingClientRect();
    return { curveDistance, elapsed: window.flightEnd - window.flightStart, samples: window.flightSamples,
      dx: node.left + node.width/2 - canvas.left - canvas.width/2,
      dy: node.top + node.height/2 - canvas.top - canvas.height/2, scale:captureView().scale };
  });
  expect(result.elapsed).toBeGreaterThan(430);
  expect(result.elapsed).toBeLessThan(700);
  expect(result.samples.length).toBeGreaterThan(8);
  expect(result.curveDistance).toBeLessThan(5);
  expect(Math.abs(result.samples[0].x - result.samples.at(-1).x) + Math.abs(result.samples[0].y - result.samples.at(-1).y)).toBeGreaterThan(20);
  expect(result.scale).toBeCloseTo(scale, 4);
  expect(Math.abs(result.dx)).toBeLessThan(2);
  expect(Math.abs(result.dy)).toBeLessThan(2);
});

test('flyover cancels on manual navigation and reduced motion skips animation', async ({ page }) => {
  await page.goto(appURL);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await clickEdge(page, '#stage g.edgePaths path.LS-Decision.LE-Setup');
  await expect(page.locator('#stage')).toHaveAttribute('aria-busy', 'true');
  await page.locator('#fit').click();
  await expect(page.locator('#stage')).not.toHaveAttribute('aria-busy', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await clickEdge(page, '#stage g.edgePaths path.LS-Decision.LE-Setup');
  await expect(page.locator('#stage .hl-cur')).toContainText('Create a workspace');
  await expect(page.locator('#stage')).not.toHaveAttribute('aria-busy', 'true');
});

test('overview can be collapsed and used to pan without changing zoom', async ({ page }) => {
  await page.goto(appURL);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await page.locator('#overview-toggle').click();
  await expect(page.locator('#overview')).toBeVisible();
  const before = await page.evaluate(() => captureView());
  await page.locator('#overview-map').click({ position: { x: 95, y: 90 } });
  const after = await page.evaluate(() => captureView());
  expect(after.scale).toBeCloseTo(before.scale, 4);
  expect(Math.abs(after.y - before.y)).toBeGreaterThan(10);
  await page.locator('#overview-close').click();
  await expect(page.locator('#overview')).toBeHidden();
});

test('Start centers the first entry step at actual size and Clear view restores all text', async ({ page }) => {
  await page.goto(appURL);
  await render(page, 'flowchart TD\nZ[Finish]\nA[First step] --> B[Middle] --> Z');
  await page.locator('#start').click();
  await expect(page.locator('#stage .hl-cur')).toContainText('First step');
  expect(await page.evaluate(() => _panZoom.getSizes().realZoom)).toBeCloseTo(1, 4);
  await expect.poll(() => page.evaluate(() => {
    const node = stage.querySelector('.hl-cur').getBoundingClientRect(), canvas = stage.getBoundingClientRect();
    return Math.max(Math.abs(node.left+node.width/2-canvas.left-canvas.width/2), Math.abs(node.top+node.height/2-canvas.top-canvas.height/2));
  })).toBeLessThan(2);
  await expect(page.locator('#stage .dim')).not.toHaveCount(0);
  const before = await page.evaluate(() => captureView());
  await page.locator('#reset').click();
  await expect(page.locator('#stage .dim, #stage .hl-cur, #stage .hl-next, #stage .hl-edge')).toHaveCount(0);
  expect(await page.evaluate(() => captureView())).toEqual(before);
  await render(page, 'flowchart TD\n' + Array.from({ length: 160 }, (_, i) => `N${i}[Step ${i}] --> N${i+1}`).join('\n'));
  await page.locator('#start').click();
  await expect(page.locator('#stage .hl-cur')).toContainText('Step 0');
  expect(await page.evaluate(() => _panZoom.getSizes().realZoom)).toBeCloseTo(1, 4);
});

test('all sidebars and the overview open on the left', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(appURL);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await openSource(page);
  await openPath(page);
  await page.locator('#help-toggle').click();
  const canvas = await page.locator('#stage').boundingBox();
  for (const id of ['editor', 'trace', 'help']) {
    const panel = await page.locator('#' + id).boundingBox();
    expect(panel.x + panel.width).toBeLessThanOrEqual(canvas.x);
  }
  await page.locator('#overview-toggle').click();
  expect((await page.locator('#overview').boundingBox()).x).toBe(canvas.x + 10);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of ['editor', 'trace', 'help']) {
    await page.locator('#' + ({ editor:'toggle', trace:'trace-toggle', help:'help-toggle' }[id])).click();
    if (await page.locator('#' + id).isHidden()) await page.locator('#' + ({ editor:'toggle', trace:'trace-toggle', help:'help-toggle' }[id])).click();
    expect((await page.locator('#' + id).boundingBox()).x).toBe(0);
  }
});

for (const fixture of [
  'flowchart TD\nA[Start] --> B{Decision}\nB -->|Yes| C[Accept]\nB -->|No| D[Review]\nD --> A\nC --> E[Done]\nA --> E',
  'flowchart LR\nA[Start] --> B[Work] --> C[Done]\nC --> A\nB --> B',
  'flowchart TD\nA[One] <--> B[Two]\nA --> B\nB --> C[Three]\nC --> A',
  '%%{init: {"flowchart": {"rankSpacing": 18}}}%%\nflowchart TD\nA[Start] --> B[Work] --> C[Done]\nC --> A',
]) {
  test('routing enters tops and never crosses node interiors: ' + fixture.split('\n')[0] + fixture.length, async ({ page }) => {
    await page.goto(appURL);
    await render(page, fixture);
    await expect(page.locator('#status')).toContainText('up to date');
    const violations = await page.evaluate(() => {
      const svg = stage.querySelector('svg'), errors = [];
      const nodes = [...stage.querySelectorAll('g.node')].map(node => ({ id:node.dataset.id, rect:node.getBoundingClientRect() }));
      for (const path of stage.querySelectorAll('g.edgePaths path[data-top-routed]')) {
        const length = path.getTotalLength(), matrix = path.getScreenCTM();
        const end = path.getPointAtLength(length).matrixTransform(matrix);
        const previous = path.getPointAtLength(Math.max(0,length-2)).matrixTransform(matrix);
        const target = nodes.find(node => path.classList.contains('LE-' + node.id));
        if (Math.abs(end.x-(target.rect.left+target.rect.width/2))>1 || end.y>target.rect.top+1 || previous.y>=end.y || Math.abs(previous.x-end.x)>1) errors.push('Not a top entry: '+path.id);
        if (path.hasAttribute('marker-start')) {
          const start = path.getPointAtLength(0).matrixTransform(matrix), after = path.getPointAtLength(2).matrixTransform(matrix);
          const source = nodes.find(node => path.classList.contains('LS-' + node.id));
          if (Math.abs(start.x-(source.rect.left+source.rect.width/2))>1 || start.y>source.rect.top+1 || after.y>=start.y) errors.push('Not a top start arrow: '+path.id);
        }
        for (let i=1;i<200;i++) {
          const point = path.getPointAtLength(length*i/200).matrixTransform(matrix);
          const crossed = nodes.find(node => point.x>node.rect.left+.5 && point.x<node.rect.right-.5 && point.y>node.rect.top+.5 && point.y<node.rect.bottom-.5);
          if(crossed) {errors.push('Crossed '+crossed.id+': '+path.id);break;}
        }
      }
      return errors;
    });
    expect(violations).toEqual([]);
    expect(await page.locator('#stage g.edgePaths path[data-top-routed]').evaluateAll(paths => paths.some(path => path.getAttribute('d').includes('Q')))).toBe(true);
    await expect(page.locator('#stage g.edgePaths path[data-top-routed]')).not.toHaveCount(0);
  });
}
