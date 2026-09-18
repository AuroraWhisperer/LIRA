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

test('takeover requires explicit confirmations, allows one-time correction and cancellation, and keeps switches off', async (t) => {
  const page = await fixture(t, 'daily-bots');
  await page.evaluate(async (html) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const panel = parsed.getElementById('otherDanmakuFeature'); panel.hidden = false; document.body.append(panel);
    window.dailyRequests = []; let attempts = 0;
    const data = { executionOwner: 'server', observedAt: '2026-09-18T01:00:00.000Z',
      takeover: { state: 'pending', revision: 0 },
      checkin: { enabled: false, revision: 0, reason: 'pending' }, fortune: { enabled: false, revision: 0, reason: 'pending' } };
    const summary = { count: 1, minDays: 128, maxDays: 128, lastDate: '2026-09-18', customLibraries: true, sourceLabel: 'synthetic source' };
    const bridge = { async invoke(request) {
      window.dailyRequests.push(request);
      const base = { ok: true, contextId: 'one', accountName: '合成测试账号' };
      if (request.action === 'summary') return { ...base, summary };
      if (request.action === 'prepare') return { ...base, draftId: 'synthetic-draft', summary,
        cutoffAt: data.observedAt, blessings: ['旧祝福'], fortunes: [{ level: '吉', name: '晨光', text: '顺心', advice: '前行' }] };
      if (request.action === 'apply' && attempts++ === 0) {
        data.takeover = { state: 'importing', revision: 1, importId: 'synthetic-draft' };
        return { ...base, data: structuredClone(data), preflight: { valid: false, issues: [{ field: 'checkin', index: 0, reason: 'reply-too-long' }] } };
      }
      if (request.action === 'cancel') data.takeover = { state: 'pending', revision: 2 };
      if (request.action === 'apply') data.takeover = { state: 'ready', revision: 3, decision: 'imported' };
      return { ...base, data: structuredClone(data), imported: request.action === 'apply' };
    } };
    const license = { getProfile: async () => ({ state: 'authorized', streamer: { accountName: 'one', songPageUrl: 'https://one.test' } }) };
    const { initDanmakuDailyBots } = await import('/js/admin/danmaku-daily-bots.js');
    initDanmakuDailyBots({ bridge, license });
  }, readAdminHtml());
  await page.waitForFunction(() => !document.getElementById('dailyBotInspect').disabled);
  assert.equal(await page.locator('#danmakuCheckinToggle').isDisabled(), true);
  assert.equal(await page.locator('#dailyBotPrepare').isDisabled(), true);
  await page.locator('#dailyBotInspect').click();
  assert.match(await page.locator('#dailyBotLegacySummary').textContent(), /128.*天/);
  await page.locator('#dailyBotStopped').check();
  assert.equal(await page.locator('#dailyBotPrepare').isDisabled(), true);
  await page.locator('#dailyBotTakeover summary').click();
  await page.locator('#dailyBotOwnership').check();
  await page.locator('#dailyBotPrepare').click();
  await page.locator('#dailyBotBlessingChoice').selectOption('corrected');
  await page.locator('#dailyBotFortuneChoice').selectOption('corrected');
  assert.equal(await page.locator('#dailyBotApply').isDisabled(), true);
  await page.locator('#dailyBotBlessingCorrection').fill('新的祝福');
  await page.locator('[data-field="text"]').fill('修正签文');
  await page.locator('#dailyBotPrepare').click();
  const prepared = await page.evaluate(() => window.dailyRequests.filter((item) => item.action === 'prepare').at(-1));
  assert.deepEqual(prepared.payload.blessings, ['新的祝福']);
  assert.equal(prepared.payload.fortunes[0].text, '修正签文');
  await page.locator('#dailyBotApply').click();
  assert.match(await page.locator('#dailyBotImportFeedback').textContent(), /回复过长.*先取消暂存/);
  await page.locator('#dailyBotCancel').click();
  assert.match(await page.locator('#dailyBotImportFeedback').textContent(), /暂存已取消/);
  await page.locator('#dailyBotBlessingChoice').selectOption('builtin');
  await page.locator('#dailyBotFortuneChoice').selectOption('builtin');
  await page.locator('#dailyBotPrepare').click();
  await page.locator('#dailyBotApply').click();
  assert.equal(await page.locator('#dailyBotTakeover').isHidden(), true);
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), false);
  assert.equal(await page.locator('#danmakuFortuneToggle').isChecked(), false);
  assert.match(await page.locator('#dailyBotStatus').textContent(), /当天签文可能.*手动开启/);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  assert.match(await page.locator('#dailyBotcheckinStatus').textContent(), /状态未知.*最后确认/);
  assert.equal(await page.locator('#danmakuCheckinToggle').isDisabled(), true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
});
