'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { randomUUID } = require('node:crypto');

test('A06/A07: expired mixed recovery renders every component with no live provider or complete owner cache', { timeout: 45000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  const created = fixture.service.create({ title: '恢复全部组件', canvas: { width: 1920, height: 1080 } });
  const types = ['clock', 'queue', 'danmaku', 'overtime'];
  const document = { ...created.document, items: types.map((type, index) => ({ id: randomUUID(), type, name: type,
    x: index * 360, y: 100, width: 320, height: 200, visible: true, locked: false,
    appearance: { mode: 'independent', config: fixture.configs[type] } })) };
  fixture.service.save({ id: document.id, expectedRevision: 1, document });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('.scene-editor-item iframe').length === 4);
  const key = (await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.links
    .find(({ component }) => component === 'canvas').draftKey;
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(`lira.preview-draft.v1.${key}`))?.components.canvas, key);
  await desktop.evaluate(() => window.previewHandle.close());
  await page.getByRole('status').filter({ hasText: '预览连接已结束' }).waitFor();
  await page.evaluate(key => {
    const name = `lira.preview-draft.v1.${key}`;
    const snapshot = JSON.parse(localStorage.getItem(name));
    delete snapshot.components.queue;
    localStorage.setItem(name, JSON.stringify(snapshot));
  }, key);
  let writes = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/component-preview') && ['edit', 'save', 'publish'].includes(request.postDataJSON()?.action)) writes++;
  });
  await page.reload();
  await page.getByRole('status').filter({ hasText: '实际数据不可用' }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.scene-editor-item .component-preview-load-state')]
    .length === 4 && [...document.querySelectorAll('.scene-editor-item .component-preview-load-state')].every(node => node.hidden));
  assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.scene-editor-stage-host').evaluate(node => node.inert), true);
  assert.equal(writes, 0);
  assert.equal(fixture.service.list()[0].publishedVersion, 0);
  assert.deepEqual(errors, []);
});

test('refresh keeps desktop-owned drafts editable and saves later changes once', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  const commands = [];
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  for (const target of [desktop, page]) target.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/component-preview') commands.push(request.postDataJSON());
  });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="clock"]').click();
  await page.locator('.preview-picker-style').first().click();
  const width = page.getByRole('spinbutton', { name: '宽度', exact: true });
  const label = page.locator('[data-preview-field="clockCustomLabel"]');
  await width.fill('777');
  await width.press('Tab');
  await label.fill('刷新前未保存');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items[0]?.width === 777
    && window.controllers.canvas.getState().draft.document.items[0]?.appearance.config.label === '刷新前未保存');
  await page.reload();
  await page.getByRole('button', { name: '添加组件', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isEnabled(), true);
  await page.locator('.preview-canvas-layer-select').click();
  assert.equal(await width.isEnabled(), true);
  assert.equal(await width.inputValue(), '777');
  assert.equal(await label.inputValue(), '刷新前未保存');
  assert.equal(fixture.service.list()[0].publishedVersion, 0);
  assert.equal(await desktop.evaluate(() => window.controllers.canvas.getState().dirty), true);
  await label.fill('刷新后继续编辑');
  await width.fill('888');
  await width.press('Tab');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor().catch(async error => {
    throw new Error(`Publication status: ${await page.locator('.preview-canvas-status').textContent()}; version: ${fixture.service.list()[0].publishedVersion}`, { cause: error });
  });
  assert.equal(fixture.service.list()[0].publishedVersion, 1);
  assert.equal(fixture.service.list()[0].document.items[0].width, 888);
  assert.equal(fixture.service.list()[0].document.items[0].appearance.config.label, '刷新后继续编辑');
  assert.equal(commands.filter(command => command.action === 'close').length, 0, 'Pagehide only detaches the page.');
});

test('refresh recovers unsent edits and does not repeat a publication whose response was lost', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  let blockEdits = false;
  let blockedAttachment;
  let losePublication = false;
  let publishedRequests = 0;
  let blocked;
  let accepted;
  const editBlocked = new Promise(resolve => { blocked = resolve; });
  const publicationAccepted = new Promise(resolve => { accepted = resolve; });
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  for (const target of [desktop, page]) target.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/component-preview', async route => {
    const command = route.request().postDataJSON();
    if (blockEdits && command.action === 'edit') {
      blockedAttachment ??= command.attachmentId;
      if (command.attachmentId === blockedAttachment) {
        await route.abort('connectionfailed');
        blocked();
        return;
      }
    }
    if (command.action === 'publish') publishedRequests++;
    if (losePublication && command.action === 'publish') {
      losePublication = false;
      await route.fetch();
      await route.abort('connectionfailed');
      accepted();
    } else await route.continue();
  });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="clock"]').click();
  await page.locator('.preview-picker-style').first().click();
  const save = page.getByRole('button', { name: '保存并应用', exact: true });
  const status = page.getByRole('status');
  await save.click();
  await status.filter({ hasText: '已保存并应用到直播源' }).waitFor();
  blockEdits = true;
  const width = page.getByRole('spinbutton', { name: '宽度', exact: true });
  const label = page.locator('[data-preview-field="clockCustomLabel"]');
  await width.fill('777');
  await width.press('Tab');
  await label.fill('尚未送达客户端');
  await editBlocked;
  const draftKey = (await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.links
    .find(({ component }) => component === 'canvas').draftKey;
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(`lira.preview-draft.v1.${key}`))
    ?.components.canvas.draft.document.items[0]?.appearance.config.label === '尚未送达客户端', draftKey);
  await page.reload();
  await page.locator('.preview-canvas-layer-select').click();
  assert.equal(await width.inputValue(), '777');
  assert.equal(await label.inputValue(), '尚未送达客户端');
  assert.equal(await save.isEnabled(), true);
  assert.equal(fixture.service.list()[0].publishedVersion, 1, 'Restoring a draft must not publish it.');
  losePublication = true;
  await save.click();
  await publicationAccepted;
  await page.reload();
  await page.locator('.preview-canvas-layer-select').click();
  assert.equal(await width.inputValue(), '777');
  assert.equal(await label.inputValue(), '尚未送达客户端');
  assert.equal(await save.isEnabled(), true);
  assert.equal(fixture.service.list()[0].publishedVersion, 2);
  assert.equal(publishedRequests, 2, 'The accepted publication must not be replayed by the refreshed page.');
  assert.equal(await desktop.evaluate(() => window.controllers.canvas.getState().dirty), false);
});

test('revoked refresh retains unsaved layout and parameters, and reopening restores without publishing', { timeout: 45000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  let blockEdits = false;
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  for (const target of [desktop, page]) target.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/component-preview', async route => {
    if (blockEdits && route.request().postDataJSON().action === 'edit') await route.abort('connectionfailed');
    else await route.continue();
  });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="clock"]').click();
  await page.locator('.preview-picker-style').first().click();
  const width = page.getByRole('spinbutton', { name: '宽度', exact: true });
  const label = page.locator('[data-preview-field="clockCustomLabel"]');
  blockEdits = true;
  await width.fill('777');
  await width.press('Tab');
  await label.fill('尚未完成的配置');
  const { draftKey, token: capability } = (await fixture.post({ action: 'resolve' }, new URL(url).hash.slice(1))).data.links
    .find(({ component }) => component === 'canvas');
  await page.waitForFunction(key => {
    const snapshot = JSON.parse(localStorage.getItem(`lira.preview-draft.v1.${key}`));
    return snapshot?.components.canvas.draft.document.items[0]?.appearance.config.label === '尚未完成的配置';
  }, draftKey);
  assert.equal(fixture.service.list()[0].publishedVersion, 0);
  assert.equal(fixture.service.list()[0].document.items.length, 0);
  await desktop.evaluate(() => window.previewHandle.close());
  await page.getByRole('status').filter({ hasText: '预览连接已结束' }).waitFor();
  blockEdits = false;
  await page.reload();
  await page.getByRole('status').filter({ hasText: '已找回上次编辑进度' }).waitFor();
  assert.match(await page.locator('.scene-editor-item-label').textContent(), /777 ×/);
  assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isDisabled(), true);
  const cached = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('lira.preview-draft.v1.'))
    .map(key => localStorage.getItem(key)).join(''));
  assert.equal(cached.includes(capability), false);
  const metadata = await page.evaluate(() => JSON.stringify(sessionStorage));
  assert.equal(metadata.includes(capability), false);
  assert.equal(metadata.includes(new URL(url).hash.slice(1)), false);

  const reopen = async () => {
    const nextUrl = await openCanvasDesktop(desktop, fixture);
    await page.goto('about:blank');
    await page.goto(nextUrl);
    await page.getByRole('button', { name: '添加组件', exact: true }).waitFor();
  };
  await reopen();
  assert.match(await page.locator('.preview-canvas-status').textContent(), /已恢复上次未保存进度/);
  await page.locator('.preview-canvas-layer-select').click();
  assert.equal(await width.inputValue(), '777');
  assert.equal(await label.inputValue(), '尚未完成的配置');
  await desktop.waitForFunction(() => window.controllers.canvas.getState().dirty);
  assert.equal(fixture.service.list()[0].document.items.length, 0);
  assert.equal(fixture.service.list()[0].publishedVersion, 0);

  await desktop.evaluate(() => window.previewHandle.close());
  const saved = fixture.service.list()[0];
  fixture.service.save({ id: saved.document.id, expectedRevision: saved.revision,
    document: { ...saved.document, canvas: { width: 1600, height: 900 } } });
  await reopen();
  const restore = page.getByRole('button', { name: '恢复上次草稿', exact: true });
  await restore.waitFor();
  assert.equal(await page.locator('.scene-editor-stage-host').evaluate(node => node.inert), true);
  assert.equal(await page.locator('.scene-editor-item').count(), 0, 'A changed baseline must not be overwritten automatically.');
  assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isDisabled(), true);
  await restore.click();
  assert.equal(await page.locator('.scene-editor-stage-host').evaluate(node => node.inert), false);
  await page.locator('.preview-canvas-layer-select').click();
  assert.equal(await width.inputValue(), '777');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存并应用到直播源' }).waitFor();
  assert.equal(fixture.service.list()[0].publishedVersion, 1);
  assert.equal(fixture.service.list()[0].document.items[0].appearance.config.label, '尚未完成的配置');
  await width.fill('888');
  await width.press('Tab');
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.scene-editor-item-label').textContent.includes('777 ×'));
  await reopen();
  await page.locator('.preview-canvas-layer-select').click();
  assert.equal(await width.inputValue(), '777');
  assert.equal(await label.inputValue(), '尚未完成的配置');
  assert.equal(fixture.service.list()[0].publishedVersion, 1);
});
