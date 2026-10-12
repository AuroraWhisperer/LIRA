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
  await page.getByRole('button', { name: '编辑自定义回复', exact: true }).click();
  await page.locator('#danmakuExactKeywordInput').fill('月卡');
  await page.locator('#danmakuExactReplyInput').fill('上舰解锁点歌月卡');
  await page.locator('#danmakuExactReplyAddBtn').click();
  await page.locator('#danmakuExactReplySaveBtn').click();
  await page.locator('#danmakuExactReplyStatus').filter({ hasText: '已保存 1 条' }).waitFor();
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
  await page.waitForFunction(() => document.getElementById('danmakuScheduledState').textContent.includes('已开启'));
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
  assert.equal(await page.locator('.danmaku-query-reply-row:visible').count(), 4);
  await page.locator('#danmakuQueryToggle + .switch-track').click();
  await page.waitForFunction(() => document.getElementById('danmakuQueryToggle').checked);
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.giftState.values),
    { giftAutoThanksEnabled: true, giftStatsQueryEnabled: true });
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.requests.filter((item) => item.operation === 'gift-interaction')),
    [{ operation: 'gift-interaction', key: 'giftStatsQueryEnabled', enabled: true }]);
});
