const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launchElectron } = require('../helpers/shared-electron');

test('optional owner settings use real preload and isolated login without changing the bot account', { timeout: 45000 }, async (t) => {
  const root = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'guard-expiry-desktop-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(await fs.realpath(directory)), await fs.realpath(root));
    await fs.rm(directory, { recursive: true, force: true });
  });
  app = await launchElectron({ cwd: path.resolve(__dirname, '../..'), args: ['test/fixtures/guard-expiry-settings.cjs', `--guard-expiry-data=${directory}`], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  await page.waitForURL('**/admin');
  assert.equal((await fetch(page.url())).status, 401);
  const source = page.locator('#guardExpirySource');
  async function selectSource(label) {
    await page.locator('#guardExpirySource-trigger').click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }
  await page.locator('#guardExpiryAccountStatus').filter({ hasText: '已复用上方账号' }).waitFor();
  assert.equal(await page.locator('#guardExpiryAccountProfile').isVisible(), false);
  assert.equal(await page.locator('#guardExpiryAccountName').textContent(), '');
  assert.equal(await page.locator('#guardExpiryAccountUid').textContent(), '');
  assert.match(await page.locator('#guardExpirySettings legend').textContent(), /可选/);
  await selectSource('单独登录主播账号（可选）');
  await page.locator('#guardExpiryLoginBtn').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#guardExpiryAccountProfile').isVisible(), false);
  const loginWindow = app.waitForEvent('window');
  await page.locator('#guardExpiryLoginBtn').click();
  const popup = await loginWindow;
  await popup.locator('#signIn').click();
  await page.locator('#guardExpiryAccountStatus').filter({ hasText: '主播账号已登录' }).waitFor();
  assert.equal(await page.locator('#guardExpiryAccountName').textContent(), '合成主播');
  assert.equal(await page.locator('#guardExpiryAccountUid').textContent(), 'UID: 123');
  await page.waitForFunction(() => {
    const avatar = document.getElementById('guardExpiryAccountAvatar');
    return !avatar.hidden && avatar.complete && avatar.naturalWidth > 0;
  });
  assert.equal(await page.locator('#guardExpiryAccountAvatar').getAttribute('class'),
    await page.locator('#bilibiliAuthAvatar').getAttribute('class'));
  assert.equal(await page.locator('#guardExpiryAccountAvatar').getAttribute('src'),
    await page.locator('#bilibiliRoomAvatar').getAttribute('src'));
  assert.equal(await page.locator('#bilibiliAuthName').textContent(), '合成机器人');
  const isolation = await app.evaluate(async ({ session }) => {
    const partition = global.guardExpiryTest.partitions[0];
    return { partition, remaining: (await session.fromPartition(partition).cookies.get({})).length,
      main: (await session.fromPartition('persist:bilibili').cookies.get({})).length, uploads: global.guardExpiryTest.uploaded };
  });
  assert.match(isolation.partition, /^guard-expiry-/);
  assert.equal(isolation.remaining, 0); assert.equal(isolation.main, 0); assert.equal(isolation.uploads, 1);
  await page.locator('#guardExpiryLogoutBtn').click();
  await page.locator('#guardExpiryLoginBtn').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#guardExpiryAccountProfile').isVisible(), false);
  assert.equal(await page.locator('#guardExpiryAccountAvatar').getAttribute('src'), null);
  await app.evaluate(() => { global.guardExpiryTest.failNext = 'GUARD_EXPIRY_UNAVAILABLE'; });
  await selectSource('使用上方登录账号');
  await page.locator('#guardExpiryRetryBtn').waitFor({ state: 'visible' });
  assert.equal(await source.inputValue(), 'separate');
  await page.locator('#guardExpiryRetryBtn').click();
  await page.locator('#guardExpiryRetryBtn').waitFor({ state: 'hidden' });
  const cancellation = app.waitForEvent('window');
  await page.locator('#guardExpiryLoginBtn').click();
  const cancelledPopup = await cancellation;
  await cancelledPopup.locator('#signIn').waitFor();
  await cancelledPopup.close();
  await page.locator('#guardExpiryAccountMessage').filter({ hasText: '已取消登录' }).waitFor();
  await selectSource('使用上方登录账号');
  await page.locator('#guardExpiryAccountStatus').filter({ hasText: '已复用上方账号' }).waitFor();
  assert.equal(await page.locator('#guardExpiryAccountProfile').isVisible(), false);
  assert.equal(await page.locator('#guardExpiryAccountName').textContent(), '');
  assert.equal(await page.locator('#guardExpiryAccountUid').textContent(), '');
});
