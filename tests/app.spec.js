const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const appURL = pathToFileURL(path.resolve('index.html')).href;

async function render(page, source) {
  await page.locator('#src').fill(source);
  await page.locator('#render').click();
  await expect(page.locator('#status')).not.toContainText('Rendering');
}

test('offline rendering, exact connections, chains, branches and keyboard trace', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.setOffline(true);
  await page.goto(appURL);
  await expect(page.locator('#stage g.node')).toHaveCount(8);
  await render(page, 'flowchart LR\nA[First step] --> AA[Second step] --> B{Choose path}\nB -->|Yes| C[Finish]\nB -->|No| D[Review]');
  await expect(page.locator('#stage g.node')).toHaveCount(5);
  await page.locator('#next').click();
  await expect(page.locator('.hl-cur')).toContainText('First step');
  await expect(page.locator('.hl-next')).toContainText('Second step');
  await expect(page.locator('.hl-edge')).toHaveCount(1);
  await page.locator('#next').click();
  await expect(page.locator('.hl-cur')).toContainText('Second step');
  await page.locator('#next').click();
  await expect(page.locator('#next')).toBeDisabled();
  await expect(page.locator('#trace-status')).toContainText('Choose a branch');
  await page.locator('g.node').filter({ hasText: 'Finish' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.hl-cur')).toContainText('Finish');
  await page.locator('#back').click();
  await expect(page.locator('.hl-cur')).toContainText('Choose path');
  expect(errors).toEqual([]);
});

test('invalid input preserves diagram, recovery works, newest render wins', async ({ page }) => {
  await page.goto(appURL);
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
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await expect(page.locator('#save-status')).toContainText('Not saved');
  await page.goto(pathToFileURL(path.resolve('flowchart.html')).href);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#status')).not.toContainText('unavailable');
});

test('legacy draft is removed and new drafts persist', async ({ page }) => {
  await page.goto(appURL);
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
  await expect(page.locator('#stage svg')).toHaveCount(1);
  const source = 'flowchart TD\nA[Exported chart] --> B[Done]\n%% </script><script>window.injected=true</script>';
  await page.locator('#src').fill(source);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  const output = testInfo.outputPath('viewer.html');
  await download.saveAs(output);
  const html = await fs.readFile(output, 'utf8');
  expect(html).not.toContain('</script><script>window.injected');
  await context.setOffline(true);
  await page.goto(pathToFileURL(output).href);
  await expect(page.locator('#stage')).toContainText('Exported chart');
  await expect(page.locator('#editor')).toBeHidden();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('mobile toolbar does not overlap editor; non-flowchart diagrams render', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appURL);
  await expect(page.locator('#save-status')).toContainText('Saved');
  const header = await page.locator('header').boundingBox();
  const editor = await page.locator('#editor').boundingBox();
  expect(editor.y).toBeGreaterThanOrEqual(header.y + header.height);
  await render(page, 'sequenceDiagram\nAlice->>Bob: Hello');
  await page.locator('#preview-view').click();
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await expect(page.locator('#next')).toBeDisabled();
});

test('invalid and empty exports never download; initial viewer failures stay visible', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto(appURL);
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await render(page, 'flowchart LR\nA[');
  await page.locator('#export').click();
  await expect(page.locator('#err')).toContainText('Viewer not exported');
  await expect(page.locator('#error-box')).toBeVisible();
  await expect(page.locator('#status')).toContainText('out of date');
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
  await expect(page.locator('#status')).toContainText('up to date');
  await page.locator('#next').click();
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
  await expect(page.locator('#status')).toContainText('up to date');
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
    await page.locator('#src').fill('flowchart TD\nA["' + 'Long request '.repeat(12) + '"] --> B["確認済み"]');
    await page.locator('#render').click();
    if (width <= 700) await page.locator('#preview-view').click();
    await expect(page.locator('#status')).toContainText('up to date');
    await expect(page.locator('#stage svg')).toBeVisible();
    await page.locator('#step-picker').selectOption('A');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const view = await page.evaluate(() => captureView());
    expect(view.scale).toBeGreaterThan(0);
    if (width <= 700) {
      await page.locator('#source-view').click();
      await expect(page.locator('#src')).toBeVisible();
      await page.locator('#preview-view').click();
      await expect(page.locator('.hl-cur')).toContainText('Long request');
    }
    expect(errors).toEqual([]);
  });
}

test('large flowchart and enlarged text remain usable', async ({ page }) => {
  await page.goto(appURL);
  await render(page, 'flowchart TD\n' + Array.from({ length: 80 }, (_, i) => `N${i}[Step ${i}] --> N${i + 1}`).join('\n'));
  await expect(page.locator('#stage g.node')).toHaveCount(81);
  await page.locator('#step-picker').selectOption('N60');
  await expect(page.locator('#trace-status')).toContainText('Step 60');
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await expect(page.locator('#next')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#next').click();
  await expect(page.locator('#trace-status')).toContainText('Step 61');
});

test('editor and traced diagram pass automated accessibility checks', async ({ page }) => {
  const { default: AxeBuilder } = require('@axe-core/playwright');
  await page.goto(appURL);
  await expect(page.locator('#status')).toContainText('up to date');
  for (const selection of ['', 'Decision']) {
    if (selection) await page.locator('#step-picker').selectOption(selection);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  }
});

test('export rejects edits made during validation and prevents duplicate activation', async ({ page }) => {
  await page.goto(appURL);
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
