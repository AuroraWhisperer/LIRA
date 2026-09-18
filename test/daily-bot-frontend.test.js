'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readAdminHtml } = require('./helpers/admin-html');
const { createUiFixture } = require('./helpers/ui-edit-state-fixture');
const fixture = createUiFixture();

test('cloud daily controls keep confirmed state, disclose failed close and ignore old account replies', async (t) => {
  const page = await fixture(t, 'daily-bots');
  await page.evaluate(async (html) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const panel = parsed.getElementById('otherDanmakuFeature'); panel.hidden = false; document.body.append(panel);
    window.dailyRequests = [];
    const account = (name) => ({ state: 'authorized', streamer: { accountName: name, songPageUrl: `https://${name}.test` } });
    window.dailyAccount = account;
    const license = { getProfile: async () => account('one'), onStateChanged(fn) { window.dailyState = fn; return () => {}; } };
    const bridge = { invoke: (request) => new Promise((resolve) => window.dailyRequests.push({ request, resolve })) };
    const { initDanmakuDailyBots } = await import('/js/admin/danmaku-daily-bots.js');
    initDanmakuDailyBots({ bridge, license });
    window.resolveDaily = (index, enabled, contextId = 'one') => window.dailyRequests[index].resolve({ ok: true, contextId,
      data: { executionOwner: 'server', observedAt: '2026-09-18T01:00:00.000Z',
        takeover: { state: 'ready', decision: 'no-legacy', revision: 1 },
        checkin: { enabled, revision: index + 1, reason: enabled ? 'running' : 'disabled' },
        fortune: { enabled: false, revision: 0, reason: 'disabled' } } });
  }, readAdminHtml());
  await page.waitForFunction(() => window.dailyRequests.length === 1);
  await page.evaluate(() => window.resolveDaily(0, true));
  await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), true);
  assert.match(await page.locator('#dailyBotcheckinStatus').textContent(), /最后确认/);
  await page.locator('#danmakuCheckinToggle').click();
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), true);
  assert.equal(await page.locator('#danmakuCheckinToggle').isDisabled(), true);
  await page.evaluate(() => window.dailyRequests[1].resolve({ ok: false, error: 'DAILY_BOT_UNAVAILABLE' }));
  await page.waitForFunction(() => document.getElementById('dailyBotStatus').textContent.includes('关闭尚未同步'));
  assert.match(await page.locator('#dailyBotcheckinStatus').textContent(), /状态未知.*最后确认/);
  await page.locator('#dailyBotRefresh').click();
  await page.evaluate(() => window.dailyState(window.dailyAccount('two')));
  await page.waitForFunction(() => window.dailyRequests.length === 4);
  await page.evaluate(() => { window.resolveDaily(3, false, 'two'); window.resolveDaily(2, true); });
  await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), false);
  await page.locator('#dailyBotRefresh').click();
  await page.evaluate(() => window.dailyRequests[4].resolve({ ok: false, error: 'DAILY_BOT_UNSUPPORTED' }));
  await page.waitForFunction(() => document.getElementById('dailyBotStatus').textContent.includes('服务器不支持'));
  assert.equal(await page.locator('#danmakuCheckinToggle').isDisabled(), true);
});

for (const [name, takeover] of [
  ['new account', { state: 'pending', decision: null, revision: 0 }],
  ['restored account', { state: 'ready', decision: 'imported', revision: 2 }],
]) {
  test(`daily controls enable directly without old-data UI for a ${name}`, async (t) => {
    const page = await fixture(t, 'daily-bots');
    await page.evaluate(async ({ html, takeover }) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const panel = parsed.getElementById('otherDanmakuFeature'); panel.hidden = false; document.body.append(panel);
      window.dailyRequests = [];
      const data = { executionOwner: 'server', observedAt: '2026-09-18T01:00:00.000Z', takeover,
        checkin: { enabled: false, revision: 0, reason: 'disabled' },
        fortune: { enabled: false, revision: 0, reason: 'disabled' } };
      const bridge = { async invoke(request) {
        window.dailyRequests.push(request);
        if (request.action === 'update') {
          const { kind, enabled } = request.payload;
          data[kind] = { enabled, revision: data[kind].revision + 1, reason: enabled ? 'running' : 'disabled' };
          if (data.takeover.state === 'pending') data.takeover = { state: 'ready', decision: 'fresh-start', revision: 1 };
        }
        return { ok: true, contextId: 'one', data: structuredClone(data) };
      } };
      const license = { getProfile: async () => ({ state: 'authorized', streamer: { accountName: 'one', songPageUrl: 'https://one.test' } }) };
      const { initDanmakuDailyBots } = await import('/js/admin/danmaku-daily-bots.js');
      initDanmakuDailyBots({ bridge, license });
    }, { html: readAdminHtml(), takeover });
    await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
    assert.equal(await page.locator('#dailyBotTakeover').count(), 0);
    assert.doesNotMatch(await page.locator('#otherDanmakuFeature').textContent(), /处理旧数据|读取旧数据|旧累计|从零开始/);
    assert.equal(await page.locator('#danmakuFortuneToggle').isDisabled(), false);
    await page.locator('#danmakuCheckinToggle').click();
    await page.waitForFunction(() => document.getElementById('danmakuCheckinToggle').checked);
    assert.equal(await page.locator('#danmakuFortuneToggle').isChecked(), false);
    const requests = await page.evaluate(() => window.dailyRequests);
    assert.deepEqual(requests.map((item) => item.action), ['open', 'update']);
    assert.deepEqual(requests[1].payload, { kind: 'checkin', enabled: true, expectedRevision: 0 });
    assert.equal(await page.locator('#dailyBotStatus').textContent(), '开启后在云端运行，关闭客户端也不影响。');
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    assert.match(await page.locator('#dailyBotcheckinStatus').textContent(), /状态未知.*最后确认/);
    assert.equal(await page.locator('#danmakuCheckinToggle').isDisabled(), true);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
  });
}
