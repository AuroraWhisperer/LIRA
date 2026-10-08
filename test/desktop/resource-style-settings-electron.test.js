'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');
const { installResourceStyles, mountResourceStylePage } = require('../helpers/resource-style-fixture');
const { createComponentStyleLibrary } = require('../../src/server/component-style-library');

test('desktop resource styles edit native parameters, retain drafts and save independent defaults', { timeout: 90000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const directory = createScratchDirectory('resource-settings-electron-');
  let app;
  t.after(async () => { await app?.close(); removeScratchDirectory(directory); });
  const styles = await installResourceStyles(directory);
  app = await electron.launch({ cwd: root, args: ['test/fixtures/danmaku-canvas-editor.cjs', directory], timeout: 15000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const switches = [];
  await page.route('**/api/settings', route => {
    switches.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await mountResourceStylePage(page);
  async function open(name, wishes = false) {
    await page.getByRole('button', { name: `${wishes ? '预览样式' : '调整样式'}：${name}`, exact: true }).click();
    const panel = page.getByRole('region', { name: `${name}设置`, exact: true });
    await panel.waitFor(); return panel;
  }
  const guard = await open('航海旗帜');
  assert.equal(await guard.locator('[data-component-parameter="textMode"]').isVisible(), false);
  assert.equal(await guard.locator('[data-preview-parameter="months"]').isVisible(), false);
  await guard.locator('label').filter({ has: page.getByRole('checkbox', { name: '启用航海旗帜', exact: true }) }).click();
  await guard.getByRole('status').filter({ hasText: '已启用' }).waitFor();
  assert.deepEqual(switches, [{ guardThanksNauticalEnabled: 'true' }]);
  await guard.getByLabel('显示观众头像', { exact: true }).uncheck();
  await guard.getByLabel('昵称字号', { exact: true }).fill('60');
  await guard.getByLabel('昵称字号', { exact: true }).dispatchEvent('change');
  await guard.getByRole('button', { name: '预览', exact: true }).click();
  const frame = guard.frameLocator('iframe');
  await frame.locator('.ng-name').waitFor();
  assert.equal(await frame.locator('.ng-avatar').count(), 0);
  assert.equal(await frame.locator('.ng-name').evaluate(node => getComputedStyle(node).fontSize), '60px');
  await guard.getByRole('button', { name: '收起预览', exact: true }).click();
  await guard.getByRole('button', { name: '保存设置', exact: true }).click();
  await guard.getByRole('status').filter({ hasText: '已保存并同步到画布' }).waitFor();
  const library = createComponentStyleLibrary(directory);
  const saved = type => library.list().flatMap(pack => pack.styles).find(style => style.type === type).config;
  assert.equal(saved('guard-thanks').showAvatar, false);
  assert.equal(saved('guard-thanks').nameFontSize, 60);

  const clock = await open('配套时钟');
  assert.equal(await page.locator('#otherClockFeature .clock-style-options > [aria-pressed="true"]').count(), 0);
  assert.equal(await page.locator('#clockShowSeconds').isVisible(), false);
  assert.equal(await page.locator('#clockOpenPreview').isVisible(), false);
  const seconds = clock.locator('[data-preview-field="clockShowSeconds"]');
  await seconds.uncheck();
  await clock.getByRole('button', { name: '保存设置', exact: true }).click();
  await clock.getByRole('status').filter({ hasText: '已保存并同步到画布' }).waitFor();
  assert.equal(saved('clock').showSeconds, false);
  assert.equal(await clock.locator('[data-preview-field="clockMoonColors"]').isVisible(), true);
  await page.locator('#otherClockFeature > div [data-clock-style-option="peach"]').first().click();
  assert.equal(await clock.isVisible(), false);
  assert.equal(await page.locator('#clockShowSeconds').isVisible(), true);
  assert.equal(await page.locator('#otherClockFeature .clock-style-options > [data-clock-style-option="peach"]').first().getAttribute('aria-pressed'), 'true');
  await open('配套时钟');
  assert.equal(await seconds.isChecked(), false);

  const danmaku = await open('配套弹幕');
  assert.equal(await danmaku.locator('[data-preview-field="danmakuFontSize"]').isVisible(), true);
  assert.equal(await page.locator('#danmakuFontSize').isVisible(), false);
  await page.getByRole('tab', { name: '区域随机', exact: true }).click();
  await page.locator('#danmakuRandomStyles [data-danmaku-style]').first().click();
  assert.equal(await danmaku.isVisible(), false);
  assert.equal(await page.locator('#danmakuFontSize').isVisible(), true);
  const wishes = await open('配套许愿', true);
  assert.equal(await wishes.getByRole('button', { name: '预览', exact: true }).count(), 0);
  assert.equal(await wishes.getByRole('button', { name: '在画布中使用', exact: true }).count(), 0);
  assert.equal(await page.locator('#giftWishDraftPreview iframe').count(), 1);
  await wishes.getByLabel('显示条数', { exact: true }).fill('4');
  await wishes.getByLabel('显示条数', { exact: true }).dispatchEvent('change');
  let rejectSave = true;
  await page.route('**/api/component-styles/config', async route => {
    if (rejectSave) return route.fulfill({ status: 503, json: { ok: false, error: '模拟保存失败' } });
    return route.continue();
  });
  await wishes.getByRole('button', { name: '保存设置', exact: true }).click();
  await wishes.getByRole('status').filter({ hasText: '草稿已保留' }).waitFor();
  assert.equal(await wishes.getByLabel('显示条数', { exact: true }).inputValue(), '4');
  assert.equal(saved('gift-wishes').limit, 1);
  rejectSave = false;
  await wishes.getByRole('button', { name: '保存设置', exact: true }).click();
  await wishes.getByRole('status').filter({ hasText: '已保存并同步到画布' }).waitFor();
  assert.equal(saved('gift-wishes').limit, 4);

  const queue = await open('配套点歌板');
  assert.equal(await queue.locator('[data-preview-field="identityQueueFontSizeNumber"]').isVisible(), true);
  assert.equal(await page.locator('#queueTitleArea').isVisible(), false);
  await page.locator('#themeForm [data-overlay-style="classic"]').click();
  assert.equal(await queue.isVisible(), false);
  assert.equal(await page.locator('#queueTitleArea').isVisible(), true);
  const lyrics = await open('配套歌词');
  await lyrics.getByLabel('字号', { exact: true }).fill('54');
  await lyrics.getByLabel('字号', { exact: true }).dispatchEvent('change');
  await lyrics.getByRole('button', { name: '保存设置', exact: true }).click();
  await lyrics.getByRole('status').filter({ hasText: '已保存并同步到画布' }).waitFor();
  assert.equal(saved('lyrics').desktopLyricFontSize, '54');
  for (const style of styles) assert.deepEqual(saved(style.type).resourceStyle, style.config.resourceStyle);
  assert.deepEqual(await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  }), []);
  await page.reload(); await mountResourceStylePage(page);
  const reopened = await open('航海旗帜');
  assert.equal(await reopened.getByLabel('显示观众头像', { exact: true }).isChecked(), false);
  assert.equal(await reopened.getByLabel('昵称字号', { exact: true }).inputValue(), '60');
  assert.deepEqual(errors, []);
});
