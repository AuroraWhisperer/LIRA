const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');

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
  await page.locator('[data-fixed-open="welcome"]').click();
  await page.waitForFunction(() => !document.getElementById('danmakuWelcomeReturningToggle').disabled);
  await page.locator('#danmakuWelcomeReturningToggle + .switch-track').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeReturningToggle').checked);
  await page.locator('#danmakuWelcomeReturningLibraryBtn').click();
  await page.getByLabel('重逢客套话词库第 1 条').fill('老朋友，来听首歌吧～');
  await page.locator('#danmakuWelcomeSaveBtn').click();
  await page.waitForFunction(() => document.getElementById('danmakuWelcomeSaveBtn').disabled);
  assert.deepEqual(await app.evaluate(() => global.dailyLibraryTest.requests.filter((item) => item.operation === 'welcome-update')),
    [{ operation: 'welcome-update', input: { returningEnabled: true } },
      { operation: 'welcome-update', input: { returningMessages: ['老朋友，来听首歌吧～', '很高兴又见到你～'] } }]);
  await app.evaluate(() => { global.dailyLibraryTest.failNext = true; });
  await page.getByLabel('重逢客套话词库第 1 条').fill('未保存的问候');
  await page.locator('#danmakuWelcomeSaveBtn').click();
  await page.locator('#danmakuWelcomeStatus').filter({ hasText: '保存未确认' }).waitFor({ state: 'attached' });
  assert.equal(await page.getByLabel('重逢客套话词库第 1 条').inputValue(), '未保存的问候');
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.welcomeSettings.returningMessages[0]), '老朋友，来听首歌吧～');
  await app.evaluate(() => {
    delete global.dailyLibraryTest.welcomeSettings.returningEnabled;
    delete global.dailyLibraryTest.welcomeSettings.returningMessages;
  });
  await page.reload();
  await page.locator('[data-fixed-open="welcome"]').click();
  await page.locator('#danmakuWelcomeReturningCapability').waitFor();
  assert.equal(await page.locator('#danmakuWelcomeReturningToggle').isDisabled(), true);
  assert.equal(await page.locator('#danmakuWelcomeGreetingToggle').isDisabled(), false);
});
