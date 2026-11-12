const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');

test('three interaction thanks switches and libraries save independently through desktop IPC', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'interaction-thanks-desktop-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await launchElectron({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/daily-bot-editor.cjs', directory], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  await page.waitForURL('**/admin');
  assert.equal((await fetch(page.url())).status, 401);
  await page.locator('[data-danmaku-tab="welcome"]').click();
  for (const [kind, label] of [['like', '点赞'], ['share', '分享'], ['follow', '关注']]) {
    const prefix = `#danmaku${kind}Thanks`;
    await page.locator(`${prefix}Toggle + .switch-track`).click();
    await page.waitForFunction(id => {
      const toggle = document.getElementById(id);
      return toggle.checked && !toggle.disabled;
    }, `danmaku${kind}ThanksToggle`);
    await page.getByRole('button', { name: `编辑${label}感谢词库`, exact: true }).click();
    const input = page.getByRole('textbox', { name: `${label}感谢第 1 条`, exact: true });
    await input.fill(`${label}测试 {username}`);
    if (kind === 'like') {
      await app.evaluate(() => { global.dailyLibraryTest.failNext = true; });
      await page.locator(`${prefix}Save`).click();
      await page.locator(`${prefix}SaveState`).filter({ hasText: '草稿已保留' }).waitFor();
      assert.equal(await input.inputValue(), `${label}测试 {username}`);
    }
    await page.locator(`${prefix}Save`).click();
    await page.locator(`${prefix}SaveState`).filter({ hasText: '已保存到云端' }).waitFor();
    await page.keyboard.press('Escape');
  }
  await page.locator('#danmakulikeThanksToggle + .switch-track').click();
  await page.waitForFunction(() => !document.getElementById('danmakulikeThanksToggle').disabled);
  await page.reload();
  await page.locator('[data-danmaku-tab="welcome"]').click();
  const saved = await app.evaluate(() => global.dailyLibraryTest.fixedReplies);
  for (const [kind, label] of [['like', '点赞'], ['share', '分享'], ['follow', '关注']]) {
    assert.equal(await page.locator(`#danmaku${kind}ThanksToggle`).isChecked(), kind !== 'like');
    assert.deepEqual(saved[`${kind}ThanksMessages`], [`${label}测试 {username}`]);
    await page.getByRole('button', { name: `编辑${label}感谢词库`, exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: `${label}感谢第 1 条`, exact: true }).inputValue(), `${label}测试 {username}`);
    await page.keyboard.press('Escape');
  }
  const writes = await app.evaluate(() => global.dailyLibraryTest.requests.filter(item => item.operation === 'fixed-reply-update'));
  assert.equal(writes.length, 8, 'each action produces one narrow write, including the deliberately failed save');
  assert.ok(writes.every(item => Object.keys(item.input).length === 1));
});

test('gift reply libraries save all four scenes through the real preload and IPC', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'gift-thanks-desktop-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await launchElectron({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/daily-bot-editor.cjs', directory, 'gift-thanks'], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  await page.waitForURL('**/admin');
  await page.locator('[data-danmaku-tab="welcome"]').click();
  await page.getByRole('button', { name: '编辑礼物答谢文案', exact: true }).click();
  const library = page.locator('#danmakuGiftThanksLibrary');
  await library.getByRole('button', { name: '加入示例', exact: true }).click();
  await library.getByLabel('礼物答谢发送方式', { exact: true }).selectOption('mention');
  for (const [kind, label] of [['captain', '舰长'], ['admiral', '提督'], ['governor', '总督']]) {
    await library.locator('[data-thanks-scene]').selectOption(kind);
    await library.getByRole('textbox', { name: `${label}答谢第 1 条`, exact: true }).fill(`欢迎{称呼}成为${label}！`);
    await library.getByLabel(`${label}答谢发送方式`, { exact: true }).selectOption(kind === 'admiral' ? 'plain' : 'mention');
  }
  await page.locator('#danmakuGiftThanksSave').click();
  await page.locator('#danmakuGiftThanksSaveState').filter({ hasText: '已保存到云端' }).waitFor();
  const saved = await app.evaluate(() => global.dailyLibraryTest.giftState.replies);
  assert.equal(saved.gift.messages.length, 2);
  assert.equal(saved.gift.mode, 'mention');
  for (const [kind, label] of [['captain', '舰长'], ['admiral', '提督'], ['governor', '总督']]) {
    assert.equal(saved[kind].messages[0].text, `欢迎{称呼}成为${label}！`);
    assert.equal(saved[kind].mode, kind === 'admiral' ? 'plain' : 'mention');
  }
  await page.reload();
  await page.locator('[data-danmaku-tab="welcome"]').click();
  await page.getByRole('button', { name: '编辑礼物答谢文案', exact: true }).click();
  assert.equal(await library.getByLabel('礼物答谢发送方式', { exact: true }).inputValue(), 'mention');
  assert.equal(await library.getByRole('textbox').count(), 2);
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.requests.filter(item => item.operation === 'gift-thanks-replies').length), 1);
});

test('nickname management uses the shared editor, pages, preserves failed edits and clears a switched account', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'viewer-names-desktop-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await launchElectron({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/daily-bot-editor.cjs', directory, 'viewer-names'], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  await page.waitForURL('**/admin');
  assert.equal((await fetch(page.url())).status, 401);
  await page.locator('[data-danmaku-tab="welcome"]').click();
  await app.evaluate(() => { global.dailyLibraryTest.failNext = true; });
  await page.locator('#danmakuViewerNamesToggle + .switch-track').click();
  await page.locator('#danmakuViewerNamesStatus').filter({ hasText: '未确认' }).waitFor();
  assert.equal(await page.locator('#danmakuViewerNamesPanel').isHidden(), true);
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.viewerNames.enabled), true);
  await page.getByRole('button', { name: '管理观众昵称', exact: true }).click();
  await page.locator('#danmakuViewerNamesList > div').nth(19).waitFor();
  assert.equal(await page.locator('#danmakuViewerNamesToggle').isChecked(), true);
  await page.locator('#danmakuViewerNamesNext').click();
  const lastRow = page.locator('#danmakuViewerNamesList > div').filter({ hasText: 'UID 120' });
  await lastRow.getByRole('button', { name: '修改', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'UID 120 的昵称', exact: true });
  await input.fill('星星🌟');
  await app.evaluate(() => { global.dailyLibraryTest.failNext = true; });
  await lastRow.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('#danmakuViewerNamesNotice').filter({ hasText: '未保存' }).waitFor();
  assert.equal(await input.inputValue(), '星星🌟');
  await lastRow.getByRole('button', { name: '保存', exact: true }).click();
  await lastRow.locator('.danmaku-viewer-name-value').filter({ hasText: '星星🌟' }).waitFor();
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.viewerNames.items.find(item => item.uid === '120').name), '星星🌟');
  await lastRow.getByRole('button', { name: '删除', exact: true }).click();
  await lastRow.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.locator('#danmakuViewerNamesList > div').nth(19).waitFor();
  assert.equal(await page.locator('#danmakuViewerNamesPagination').isHidden(), true);
  await page.keyboard.press('Escape');
  await page.locator('#danmakuViewerNamesToggle + .switch-track').click();
  await page.waitForFunction(() => {
    const toggle = document.getElementById('danmakuViewerNamesToggle');
    return !toggle.checked && !toggle.disabled;
  });
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.viewerNames.items.length), 20);
  await page.getByRole('button', { name: '管理观众昵称', exact: true }).click();
  await app.evaluate(() => { global.dailyLibraryTest.holdNamesRead = true; });
  await page.locator('#danmakuViewerNamesRefresh').click();
  await page.waitForFunction(() => document.getElementById('danmakuViewerNamesPanel').getAttribute('aria-busy') === 'true');
  await app.evaluate(() => global.dailyLibraryTest.switchNamesAccount());
  await page.locator('#danmakuViewerNamesList').filter({ hasText: '另一账号' }).waitFor();
  await app.evaluate(() => global.dailyLibraryTest.releaseNamesRead());
  assert.equal(await page.locator('#danmakuViewerNamesList > div').count(), 1);
  assert.equal(await page.locator('#danmakuViewerNamesList').textContent().then(text => text.includes('UID 100')), false);
});

test('fixed reply editors save through authorized desktop IPC and preserve failed drafts', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'fixed-replies-desktop-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await launchElectron({ cwd: path.resolve(__dirname, '../..'),
    args: ['test/fixtures/daily-bot-editor.cjs', directory], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  await page.waitForURL('**/admin');
  assert.equal((await fetch(page.url())).status, 401);
  await page.getByRole('button', { name: '编辑完整匹配回复', exact: true }).click();
  await page.locator('#danmakuExactKeywordInput').fill('月卡');
  await page.locator('#danmakuExactReplyInput').fill('上舰解锁点歌月卡');
  const drawer = page.locator('#danmakuFixedEditorDialog');
  const bounds = await drawer.boundingBox();
  await page.mouse.click(bounds.x / 2, bounds.y + bounds.height / 2);
  await drawer.waitFor({ state: 'hidden' });
  await page.locator('[data-danmaku-tab="send"]').click();
  await page.locator('[data-danmaku-tab="replies"]').click();
  await page.getByRole('button', { name: '编辑完整匹配回复', exact: true }).click();
  assert.equal(await page.locator('#danmakuExactKeywordInput').inputValue(), '月卡');
  assert.equal(await page.locator('#danmakuExactReplyInput').inputValue(), '上舰解锁点歌月卡');
  await page.locator('#danmakuExactReplyAddBtn').click();
  await page.locator('#danmakuExactReplySaveBtn').click();
  await page.locator('#danmakuExactReplyStatus').filter({ hasText: '已保存 1 条' }).waitFor();
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.fixedReplies.customExactReplies),
    [{ trigger: '月卡', reply: '上舰解锁点歌月卡' }]);
  await page.keyboard.press('Escape');
  await page.locator('[data-danmaku-tab="send"]').click();
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  await page.locator('#danmakuScheduledMode').selectOption('random');
  await page.locator('#danmakuScheduledMin').fill('120');
  await page.locator('#danmakuScheduledMax').fill('240');
  await page.locator('#danmakuScheduledLibraryAdd').click();
  await page.getByLabel('定时弹幕第 1 条', { exact: true }).fill('上舰解锁点歌月卡');
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '已保存到云端' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#danmakuScheduledToggle + .switch-track').click();
  await page.waitForFunction(() => {
    const toggle = document.getElementById('danmakuScheduledToggle');
    return toggle.checked && !toggle.disabled;
  });
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.fixedReplies.scheduledDanmakuEnabled), true);
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  await app.evaluate(() => { global.dailyLibraryTest.failNext = true; });
  await page.getByLabel('定时弹幕第 1 条', { exact: true }).fill('修改未保存的词条');
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '草稿已保留' }).waitFor();
  assert.equal(await page.getByLabel('定时弹幕第 1 条', { exact: true }).inputValue(), '修改未保存的词条');
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.fixedReplies.scheduledDanmaku.messages[0]), '上舰解锁点歌月卡');
  const invalid = await page.evaluate(() => window.liraLicense.updateFixedReplySettings({ streamerId: 2 }));
  assert.equal(invalid.error, 'INVALID_FIXED_REPLY_SETTINGS');
  await page.keyboard.press('Escape');
  await page.locator('[data-danmaku-tab="replies"]').click();
  await page.locator('#danmakuQueryToggle + .switch-track').click();
  await page.waitForFunction(() => document.getElementById('danmakuQueryToggle').checked);
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.giftState.values),
    { giftAutoThanksEnabled: true, giftStatsQueryEnabled: true });
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.requests.filter((item) => item.operation === 'gift-interaction')),
    [{ operation: 'gift-interaction', key: 'giftStatsQueryEnabled', enabled: true }]);
  await page.locator('[data-danmaku-tab="welcome"]').click();
  await page.getByRole('button', { name: '编辑礼物答谢文案', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '礼物答谢', exact: true });
  await editor.fill('谢谢{称呼}支持{礼物}；{金额}');
  await page.getByRole('button', { name: '保存答谢文案', exact: true }).click();
  await page.locator('#danmakuGiftThanksSaveState').filter({ hasText: '文案已保存到云端' }).waitFor();
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.giftState.templates.gift), '谢谢{称呼}支持{礼物}；{金额}');
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.giftState.values.giftAutoThanksEnabled), true);
  const rejected = await page.evaluate(() => window.liraLicense.setGiftThanksTemplates({ streamerId: 2 }));
  assert.equal(rejected.error, 'INVALID_GIFT_THANKS_TEMPLATES');
});
