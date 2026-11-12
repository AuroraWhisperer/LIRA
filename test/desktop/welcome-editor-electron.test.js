const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');

test('welcome audience and medal edits persist through the authorized desktop editor and reload', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'welcome-audience-editor-'));
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
  const open = async () => {
    await page.locator('[data-danmaku-tab="welcome"]').click();
    await page.locator('[data-fixed-open="welcome"]').click();
    await page.locator('[data-welcome-view="audience"]').click();
  };
  await open();
  await page.locator('#danmakuWelcomeOwnMedalToggle + .switch-track').click();
  await page.waitForFunction(() => {
    const field = document.getElementById('danmakuWelcomeOwnMedalToggle');
    return field.checked && !field.disabled;
  });
  await page.locator('#danmakuWelcomeWhitelistAddBtn').click();
  await page.getByLabel('白名单第 1 位观众的 B 站 UID').fill('18446744073709551615');
  await page.locator('#danmakuWelcomeWhitelistSaveBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeWhitelistSaveBtn').disabled);
  await page.locator('#danmakuWelcomeBlacklistAddBtn').click();
  await page.getByLabel('黑名单第 1 位观众的 B 站 UID').fill('42');
  await page.locator('#danmakuWelcomeBlacklistSaveBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeBlacklistSaveBtn').disabled);
  await page.reload();
  await open();
  assert.equal(await page.locator('#danmakuWelcomeOwnMedalToggle').isChecked(), true);
  assert.equal(await page.getByLabel('白名单第 1 位观众的 B 站 UID').inputValue(), '18446744073709551615');
  assert.equal(await page.getByLabel('黑名单第 1 位观众的 B 站 UID').inputValue(), '42');
  await page.getByRole('button', { name: '从黑名单删除第 1 位观众', exact: true }).click();
  await page.locator('#danmakuWelcomeBlacklistSaveBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeBlacklistSaveBtn').disabled);
  await page.reload();
  await open();
  assert.equal(await page.locator('#danmakuWelcomeBlacklistList input').count(), 0);
});

test('time welcome changes the displayed library and persists edits through desktop IPC', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'welcome-time-editor-'));
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
  const open = async () => {
    await page.locator('[data-danmaku-tab="welcome"]').click();
    await page.locator('[data-fixed-open="welcome"]').click();
    await page.locator('[data-welcome-view="libraries"]').click();
  };
  await open();
  await page.getByLabel('欢迎词库第 1 条').fill('普通欢迎保留');
  await page.locator('#danmakuWelcomeSaveBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeSaveBtn').disabled);
  await page.locator('#danmakuWelcomeTimeToggle + .switch-track').click();
  await page.locator('#danmakuWelcomeTimePeriodRow').waitFor();
  await page.locator('#danmakuWelcomeTimePeriod').selectOption('afternoon');
  await page.getByLabel('下午欢迎词库第 1 条').fill('下午来听歌 {username}');
  await page.locator('#danmakuWelcomeSaveBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeSaveBtn').disabled);
  await page.reload();
  await open();
  await page.locator('#danmakuWelcomeTimePeriodRow').waitFor();
  await page.locator('#danmakuWelcomeTimePeriod').selectOption('afternoon');
  assert.equal(await page.getByLabel('下午欢迎词库第 1 条').inputValue(), '下午来听歌 {username}');
  await page.locator('#danmakuWelcomeTimeToggle + .switch-track').click();
  await page.locator('#danmakuWelcomeTimePeriodRow').waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('欢迎词库第 1 条').inputValue(), '普通欢迎保留');
  const writes = await app.evaluate(() => global.dailyLibraryTest.requests.filter(item => item.operation === 'welcome-update'));
  assert.equal(writes.length, 4);
  assert.equal(writes[2].input.timeWelcomeMessages.afternoon[0], '下午来听歌 {username}');
});

test('returning welcome saves independent libraries through authorized desktop IPC and retains failed drafts', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'welcome-editor-'));
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
  await page.locator('[data-fixed-open="welcome"]').click();
  await page.waitForFunction(() => !document.getElementById('danmakuWelcomeReturningToggle').disabled);
  await page.locator('#danmakuWelcomeReturningToggle + .switch-track').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeReturningToggle').checked);
  await page.locator('#danmakuWelcomeReturningLibraryBtn').click();
  await page.getByLabel('多天未到词库第 1 条').fill('{username}，{days}天不见，来听首歌吧～');
  await page.locator('#danmakuWelcomeSaveBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeSaveBtn').disabled);
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.requests.filter((item) => item.operation === 'welcome-update')),
    [{ operation: 'welcome-update', input: { returningEnabled: true } },
      { operation: 'welcome-update', input: { returningMessages: ['{username}，{days}天不见，来听首歌吧～', '很高兴又见到你～'] } }]);
  await app.evaluate(() => { global.dailyLibraryTest.failNext = true; });
  await page.getByLabel('多天未到词库第 1 条').fill('未保存的问候');
  await page.locator('#danmakuWelcomeSaveBtn').click();
  await page.locator('#danmakuWelcomeStatus').filter({ hasText: '保存未确认' }).waitFor({ state: 'attached' });
  assert.equal(await page.getByLabel('多天未到词库第 1 条').inputValue(), '未保存的问候');
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.welcomeSettings.returningMessages[0]), '{username}，{days}天不见，来听首歌吧～');
  await app.evaluate(() => {
    delete global.dailyLibraryTest.welcomeSettings.returningEnabled;
    delete global.dailyLibraryTest.welcomeSettings.returningMessages;
  });
  await page.reload();
  await page.locator('[data-danmaku-tab="welcome"]').click();
  await page.locator('[data-fixed-open="welcome"]').click();
  await page.locator('#danmakuWelcomeReturningCapability').waitFor();
  assert.equal(await page.locator('#danmakuWelcomeReturningToggle').isDisabled(), true);
  assert.equal(await page.locator('#danmakuWelcomeGreetingToggle').isDisabled(), false);
});
