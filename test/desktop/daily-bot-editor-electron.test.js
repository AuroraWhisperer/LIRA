const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');

test('daily libraries use the authenticated desktop bridge, retain cache across reload and preserve failed drafts', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'daily-library-desktop-'));
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
  await page.getByRole('button', { name: '编辑签到词库', exact: true }).click();
  await page.locator('#dailyLibraryCount').filter({ hasText: '30 条' }).waitFor();
  const field = page.getByRole('textbox', { name: '第 1 条祝福语', exact: true });
  const before = await app.evaluate(() => global.dailyLibraryTest.requests.length);
  await field.fill('合成桌面祝福。');
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.requests.length), before);
  await page.locator('#dailyLibrarySave').click();
  await page.locator('#dailyLibraryStatus').filter({ hasText: '词库已保存到云端' }).waitFor();
  assert.equal(await app.evaluate(() => global.dailyLibraryTest.libraries.checkin[0]), '合成桌面祝福。');
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), false);
  await page.reload();
  await page.getByRole('button', { name: '编辑签到词库', exact: true }).click();
  await page.locator('#dailyLibraryCount').filter({ hasText: '30 条' }).waitFor();
  assert.equal(await field.inputValue(), '合成桌面祝福。');
  assert.match(await app.evaluate(() => global.dailyLibraryTest.requests.at(-1).input.version), /^[a-f0-9]{64}$/);
  await app.evaluate(() => { global.dailyLibraryTest.failNext = true; });
  await field.fill('失败保留的草稿。');
  await page.locator('#dailyLibrarySave').click();
  await page.locator('#dailyLibraryStatus').filter({ hasText: '保存尚未确认' }).waitFor();
  assert.equal(await field.inputValue(), '失败保留的草稿。');
  await page.getByRole('button', { name: '编辑抽签词库', exact: true }).click();
  await page.locator('#dailyLibraryCount').filter({ hasText: '20 条' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '第 1 条签级', exact: true }).inputValue(), '上上签');
  assert.equal(await page.getByRole('textbox', { name: '第 1 条签名', exact: true }).inputValue(), '云开见日');
  const rejected = await page.evaluate(() => window.dailyBots.invoke({ action: 'library-read', contextId: 'forged', payload: { kind: 'fortune' } }));
  assert.equal(rejected.error, 'DAILY_BOT_ACCOUNT_CHANGED');
});
