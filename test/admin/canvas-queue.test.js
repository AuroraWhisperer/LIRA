'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

async function fittedPanel(frame, style) {
  await frame.waitForFunction(style => {
    const panel = document.querySelector(`.queue-${style}`);
    if (!panel?.textContent.includes('待唱歌曲')) return false;
    const bounds = panel.getBoundingClientRect();
    return Math.abs(innerWidth - bounds.width - 2 * bounds.left) < 1
      && Math.abs(innerHeight - bounds.height - 2 * bounds.top) < 1;
  }, style);
  return frame.locator('.overlay-panel').evaluate(panel => ({ width: innerWidth, height: innerHeight,
    blur: getComputedStyle(panel).backdropFilter, panelWidth: panel.getBoundingClientRect().width }));
}

test('queue canvas frames fit each style and transparent artwork has no frosted backdrop', { timeout: 45000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const childRequests = [];
  for (const target of [desktop, page]) target.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.frame().parentFrame()) childRequests.push(request.url());
  });
  t.after(async () => {
    await browser.close();
    await fixture.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(childRequests, [], 'queue frames only consume their existing parent data channel');
  });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const sizes = {};
  let frame;
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="queue"]').click();
  const styles = await page.locator('[data-picker-style]').evaluateAll(buttons => buttons.map(button => button.dataset.pickerStyle));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  for (const style of ['classic', 'identity', 'storybook', 'neon-vinyl', 'cherry-ribbon']) assert.ok(styles.includes(style), style);
  for (const [index, style] of styles.entries()) {
    await page.getByRole('button', { name: '添加组件', exact: true }).click();
    await page.locator('[data-category="queue"]').click();
    await page.locator(`[data-picker-style="${style}"]`).click();
    frame = await page.locator('.scene-editor-item.is-selected iframe').elementHandle().then(handle => handle.contentFrame());
    sizes[style] = await fittedPanel(frame, style);
    if (style === 'classic') assert.notEqual(sizes[style].blur, 'none', 'classic retains its explicit blur setting');
    else assert.equal(sizes[style].blur, 'none', style);
    if (style === 'identity') assert.ok(sizes[style].panelWidth <= 430, 'identity retains its original maximum scale');
    if (index < styles.length - 1) await page.getByRole('button', { name: '移除组件', exact: true }).click();
  }
  assert.ok(sizes.storybook.height > sizes['cherry-ribbon'].height);
  assert.ok(sizes['cherry-ribbon'].height > sizes['neon-vinyl'].height);
  await page.locator('[data-overlay-style="storybook"]').click();
  assert.equal((await fittedPanel(frame, 'storybook')).height, sizes.storybook.height);
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).fill('320');
  await page.getByRole('spinbutton', { name: '宽度', exact: true }).press('Tab');
  await frame.waitForFunction(() => innerWidth === 320);
  const resized = await fittedPanel(frame, 'storybook');
  assert.ok(resized.height < sizes.storybook.height);
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items[0].width, resized.width);
  assert.equal(saved.document.items[0].height, resized.height);
  const source = fixture.service.getSource(saved.document.id);
  const output = await browser.newPage();
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  await output.goto(outputUrl);
  const panel = output.frameLocator('.scene-version:not(.is-staging) iframe').locator('.queue-storybook');
  await panel.waitFor();
  const outputSize = await panel.evaluate(node => ({ width: innerWidth, height: innerHeight,
    blur: getComputedStyle(node).backdropFilter }));
  assert.deepEqual(outputSize, { width: resized.width, height: resized.height, blur: 'none' });
});
