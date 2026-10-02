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
  await expect(page.locator('#status')).toContainText('Choose a highlighted branch');
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
  await expect(page.locator('#err')).toContainText('Render error');
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
  await expect(page.locator('#status')).toContainText('Local saving unavailable');
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
  await expect(page.locator('#stage svg')).toHaveCount(1);
  const header = await page.locator('header').boundingBox();
  const editor = await page.locator('#editor').boundingBox();
  expect(editor.y).toBeGreaterThanOrEqual(header.y + header.height);
  await render(page, 'sequenceDiagram\nAlice->>Bob: Hello');
  await expect(page.locator('#stage svg')).toHaveCount(1);
  await expect(page.locator('#next')).toBeDisabled();
});
