const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');

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
  assert.equal(await page.locator('#danmakuFixedEditorTitle').innerText(), '完整匹配回复');
  await page.locator('#danmakuExactKeywordInput').fill('月卡');
  await page.locator('#danmakuExactReplyInput').fill('上舰解锁点歌月卡');
  await page.locator('#danmakuExactReplyAddBtn').click();
  await page.locator('#danmakuExactReplySaveBtn').click();
  await page.locator('#danmakuExactReplyStatus').filter({ hasText: '已保存 1 条' }).waitFor();
  assert.equal(await page.locator('#danmakuExactState').innerText(), '1 条自定义');
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.fixedReplies.customExactReplies),
    [{ trigger: '月卡', reply: '上舰解锁点歌月卡' }]);
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  await page.locator('#danmakuScheduledMode').selectOption('random');
  await page.locator('#danmakuScheduledMin').fill('120');
  await page.locator('#danmakuScheduledMax').fill('240');
  await page.locator('#danmakuScheduledLibraryAdd').click();
  await page.getByLabel('定时弹幕第 1 条', { exact: true }).fill('上舰解锁点歌月卡');
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '已保存到云端' }).waitFor();
  await page.locator('#danmakuScheduledToggle + .switch-track').click();
  await page.waitForFunction(() => {
    const toggle = document.getElementById('danmakuScheduledToggle');
    return toggle.checked && !toggle.disabled;
  });
  assert.equal(await page.locator('#danmakuScheduledState').textContent(), '');
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.fixedReplies.scheduledDanmakuEnabled), true);
  await app.evaluate(() => { global.dailyLibraryTest.failNext = true; });
  await page.getByLabel('定时弹幕第 1 条', { exact: true }).fill('修改未保存的词条');
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '草稿已保留' }).waitFor();
  assert.equal(await page.getByLabel('定时弹幕第 1 条', { exact: true }).inputValue(), '修改未保存的词条');
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.fixedReplies.scheduledDanmaku.messages[0]), '上舰解锁点歌月卡');
  const invalid = await page.evaluate(() => window.liraLicense.updateFixedReplySettings({ streamerId: 2 }));
  assert.equal(invalid.error, 'INVALID_FIXED_REPLY_SETTINGS');
  await page.getByRole('button', { name: '查看查询回复指令清单' }).click();
  await page.getByLabel('查找指令').fill('2026年');
  assert.equal(await page.locator('.danmaku-query-reply-row:visible').count(), 2);
  await page.locator('#danmakuQueryToggle + .switch-track').click();
  await page.waitForFunction(() => document.getElementById('danmakuQueryToggle').checked);
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.giftState.values),
    { giftAutoThanksEnabled: true, giftStatsQueryEnabled: true });
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.requests.filter((item) => item.operation === 'gift-interaction')),
    [{ operation: 'gift-interaction', key: 'giftStatsQueryEnabled', enabled: true }]);
  const query = await page.locator('[data-fixed-item="query"]').boundingBox();
  const thanks = await page.locator('[data-fixed-item="thanks"]').boundingBox();
  assert.equal(query.y, thanks.y);
  assert.ok(thanks.x > query.x);
  await page.getByRole('button', { name: '编辑礼物答谢文案', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '礼物答谢', exact: true });
  assert.equal(await editor.locator('[contenteditable="false"]').count(), 3);
  await editor.fill('谢谢{称呼}支持{礼物}；{金额}');
  assert.equal(await page.locator('#danmakuThanksgiftPreview').textContent(), '谢谢小明支持人气票×1；共1电池');
  await page.getByRole('button', { name: '保存答谢文案', exact: true }).click();
  await page.locator('#danmakuGiftThanksSaveState').filter({ hasText: '文案已保存到云端' }).waitFor();
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.giftState.templates.gift), '谢谢{称呼}支持{礼物}；{金额}');
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.giftState.values.giftAutoThanksEnabled), true);
  const rejected = await page.evaluate(() => window.liraLicense.setGiftThanksTemplates({ streamerId: 2 }));
  assert.equal(rejected.error, 'INVALID_GIFT_THANKS_TEMPLATES');
});
