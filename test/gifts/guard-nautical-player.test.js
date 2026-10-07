'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');
const { createNauticalGuardZip } = require('../../scripts/package-guard-nautical');
const { buildGuardThanksEvents } = require('../../src/bilibili/gift/guard-thanks-config');

test('client imports nautical style, applies it and renders tier, live identity, deduplication and reset', { timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'guard-nautical-live-'));
  const archive = path.join(directory, 'nautical.zip'); fs.writeFileSync(archive, createNauticalGuardZip());
  const fixture = await startCanvasOutputFixture({ dataDir: directory, notifications: true });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close(); await fixture.close();
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(root)); fs.rmSync(directory, { recursive: true });
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desktop = await context.newPage();
  const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  desktop.on('pageerror', error => errors.push(error.message));
  await openCanvasDesktop(desktop, fixture);
  await desktop.evaluate(async html => {
    const panel = new DOMParser().parseFromString(html, 'text/html').getElementById('guardThanksPanel');
    panel.hidden = false; document.body.append(panel);
    const { initComponentStyleLibraries } = await import('/js/admin/component-style-client.js');
    initComponentStyleLibraries();
  }, fs.readFileSync('public/pages/admin/toolbox/gift.html', 'utf8'));
  const library = desktop.locator('#guardThanksStyleLibrary');
  await library.getByRole('button', { name: '＋ 添加样式', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await library.getByRole('button', { name: '导入套装', exact: true }).count(), 0);
  await library.getByRole('button', { name: '＋ 添加样式', exact: true }).click();
  const importDialog = desktop.getByRole('dialog', { name: '添加第三方样式' });
  const fileChooser = desktop.waitForEvent('filechooser');
  await importDialog.getByRole('button', { name: '选择 LIRA 样式包（ZIP）', exact: true }).click();
  await (await fileChooser).setFiles(archive);
  const confirmation = desktop.getByRole('dialog', { name: '确认添加样式' });
  await confirmation.getByRole('button', { name: '添加样式', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  await library.getByRole('button', { name: '添加到画布：航海旗帜 · 上舰感谢', exact: true }).click();
  await desktop.waitForFunction(() => window.controllers.canvas.getState().draft.document.items.length === 1);
  const canvas = await context.newPage();
  const editorUrl = await desktop.evaluate(() => window.externalPreviewUrl);
  assert.equal((await fetch(editorUrl)).status, 200);
  await canvas.goto(editorUrl);
  await canvas.locator('.scene-editor-item[data-component="guard-thanks"]').waitFor();
  await canvas.waitForFunction(() => document.querySelector('.scene-editor-item .component-preview-load-state')?.hidden);
  await canvas.getByRole('button', { name: '添加组件', exact: true }).click();
  const picker = canvas.getByRole('dialog', { name: '添加组件', exact: true });
  await picker.locator('[data-category="suites"]').click();
  await picker.locator('.component-style-library [role="status"]').filter({ hasText: '套装由多个组件类型' }).waitFor();
  assert.equal(await picker.locator('[data-custom-style-id]').count(), 0, 'One guard style must not appear as a suite.');
  await picker.locator('[data-category="guard-thanks"]').click();
  await picker.getByRole('button', { name: '添加到画布：航海旗帜 · 上舰感谢', exact: true }).waitFor();
  await picker.getByRole('button', { name: '关闭', exact: true }).click();
  await canvas.getByRole('button', { name: '保存并应用', exact: true }).click();
  await canvas.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  assert.equal(saved.document.items[0].appearance.config.resourceStyle.preset, 'nautical-guard-thanks');
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  // One context-wide fake clock replaces three natural five-second plays.
  await context.clock.install();
  const output = await context.newPage();
  await output.setViewportSize({ width: 1920, height: 1080 });
  await output.route('https://i0.hdslb.com/bfs/face/synthetic-viewer.png', route => route.fulfill({ contentType: 'image/png',
    body: fs.readFileSync('public/img/overlays/guard-nautical/avatar.png') }));
  await output.goto(outputUrl);
  const stage = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await stage.locator('.ng-stage').waitFor({ state: 'attached' });
  const child = await output.locator('.scene-version:not(.is-staging) iframe').elementHandle();
  const frame = await child.contentFrame();
  await frame.evaluate(() => {
    window.played = []; window.revoked = [];
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); window.played.push({ url, size: blob.size }); return url; };
    URL.revokeObjectURL = url => { window.revoked.push(url); revoke(url); };
  });
  fixture.runtime.settings.guardThanksAuroraEnabled = fixture.runtime.settings.guardThanksClassicEnabled = 'true';
  const sizes = Object.fromEntries(['captain', 'admiral', 'governor'].map((tier) =>
    [tier, fs.statSync(`public/img/overlays/guard-nautical/${tier}.webp`).size]));
  const tiers = ['captain', 'admiral', 'governor', 'captain'];
  for (const [index, tier] of tiers.entries()) {
    const events = buildGuardThanksEvents({ id: index + 1, gift_id: `guard-${tier === 'captain' ? 3 : tier === 'admiral' ? 2 : 1}`,
      user_name: index === 3 ? '<img src=x onerror=alert(1)>' : `真实观众${index}`, num: 1, detection_status: 'final',
      avatar_url: 'https://i0.hdslb.com/bfs/face/synthetic-viewer.png' }, fixture.runtime.settings);
    assert.equal(events.length, 2);
    for (const event of events) fixture.receiveGift(event);
    fixture.notify({ types: ['guard-thanks'] });
    await stage.locator(`.ng-stage[data-tier="${tier}"]:not([hidden])`).waitFor();
    assert.equal(await stage.locator('.ng-name').textContent(), events[0].userName);
    assert.equal(await stage.locator('.ng-name img').count(), 0);
    assert.equal(await stage.locator('.ng-avatar').getAttribute('src'), events[0].avatarUrl);
    const plays = await frame.evaluate(() => window.played);
    assert.equal(plays.length, index + 1, 'Native style variants share one purchase animation.');
    assert.equal(plays.at(-1).size, sizes[tier], 'The correct original animated WebP is selected.');
    if (index < 3) {
      await context.clock.runFor(5000);
      await stage.locator('.ng-stage').waitFor({ state: 'hidden' });
    }
  }
  await output.evaluate(() => {
    document.querySelector('.scene-version:not(.is-staging) iframe').contentWindow.postMessage(
      { type: 'component-preview:data', data: { reset: true, events: [] } }, location.origin);
  });
  await stage.locator('.ng-stage').waitFor({ state: 'hidden' });
  assert.equal(await stage.locator('.ng-name').count(), 0);
  assert.equal(await frame.evaluate(() => window.revoked.length), 4);
  assert.equal(new Set(await frame.evaluate(() => window.played.map(play => play.url))).size, 4, 'Repeated tiers restart with a fresh animation URL.');
  assert.deepEqual(errors, []);
});
