'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const fixture = createUiFixture();

async function libraryFixture(t) {
  const page = await fixture(t, 'daily-libraries');
  await page.evaluate(async (html) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const panel = parsed.getElementById('otherDanmakuFeature');
    panel.hidden = false;
    document.body.append(panel);
    window.libraryRequests = [];
    window.libraryVersion = 'a'.repeat(64);
    window.remoteLibraries = {
      checkin: Array.from({ length: 8 }, (_, index) => `第${index + 1}条祝福。`),
      fortune: [{ level: '上签', name: '顺遂', text: '今日有花开', advice: '宜从容' }],
    };
    window.saveFailure = '';
    const license = {
      getState: async () => ({ state: 'authorized', streamer: { accountName: 'one' } }),
      onStateChanged(fn) { window.libraryAccount = fn; return () => {}; },
    };
    const bridge = { async invoke(request) {
      window.libraryRequests.push(structuredClone(request));
      if (request.action === 'open') return { ok: true, contextId: 'one', data: {
        checkin: { enabled: false, revision: 0, reason: 'disabled' },
        fortune: { enabled: false, revision: 0, reason: 'disabled' },
        takeover: { state: 'pending' },
      } };
      const { kind, library } = request.payload;
      if (window.holdSave && request.action === 'library-save') await new Promise(resolve => { window.finishLibrarySave = resolve; });
      if (window.holdRead && request.action === 'library-read') await new Promise(resolve => { window.finishLibraryRead = resolve; });
      if (request.action === 'library-save') {
        if (window.saveFailure) return { ok: false, error: window.saveFailure };
        window.remoteLibraries[kind] = structuredClone(library);
        window.libraryVersion = 'b'.repeat(64);
      }
      return { ok: true, contextId: 'one', library: {
        kind, version: window.libraryVersion, library: structuredClone(window.remoteLibraries[kind]),
      } };
    } };
    const { initDanmakuDailyBots } = await import('/js/admin/danmaku-daily-bots.js');
    const { initFixedReplyEditor } = await import('/js/admin/danmaku-fixed-replies.js');
    initDanmakuDailyBots({ bridge, license });
    initFixedReplyEditor();
  }, readAdminFragmentHtml('pages/admin/toolbox/danmaku.html'));
  await page.waitForFunction(() => !document.querySelector('[data-fixed-open="checkin"]').disabled);
  return page;
}

test('daily libraries reuse the fixed editor and keep edits, search and paging local', async (t) => {
  const page = await libraryFixture(t);
  assert.deepEqual(await page.evaluate(() => window.libraryRequests.map(x => x.action)), ['open']);
  await page.getByRole('button', { name: '编辑签到词库', exact: true }).click();
  await page.locator('#dailyLibraryCount').filter({ hasText: '8 条' }).waitFor();
  assert.equal(await page.locator('#danmakuFixedEditorTitle').textContent(), '签到祝福词库');
  assert.equal(await page.locator('#danmakuDailyLibraryPanel').getByText('回复预览', { exact: true }).count(), 0);
  await page.getByRole('textbox', { name: '第 1 条祝福语', exact: true }).fill('修改后的祝福。');
  await page.locator('#dailyLibraryNext').click();
  await page.getByRole('textbox', { name: '第 7 条祝福语', exact: true }).fill('第七条修改。');
  await page.locator('#dailyLibrarySearch').fill('修改');
  assert.equal(await page.locator('#dailyLibraryList input').count(), 2);
  assert.equal(await page.locator('#dailyLibraryPagination').isVisible(), false);
  assert.equal(await page.evaluate(() => window.libraryRequests.length), 2);
  await page.locator('#danmakuFixedEditorClose').click();
  await page.getByRole('button', { name: '编辑签到词库', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '第 1 条祝福语', exact: true }).inputValue(), '修改后的祝福。');
  await page.locator('#dailyLibrarySave').click();
  await page.locator('#dailyLibraryStatus').filter({ hasText: '词库已保存到云端' }).waitFor();
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), false);
  assert.equal((await page.evaluate(() => window.libraryRequests.at(-1))).action, 'library-save');
  assert.deepEqual(await page.evaluate(() => [window.remoteLibraries.checkin[0], window.remoteLibraries.checkin[6]]), ['修改后的祝福。', '第七条修改。']);
  await page.getByRole('button', { name: '编辑抽签词库', exact: true }).click();
  await page.getByRole('textbox', { name: '第 1 条签文', exact: true }).fill('春风又至');
  await page.locator('#dailyLibraryAdd').click();
  await page.getByRole('textbox', { name: '第 2 条签级', exact: true }).fill('中签');
  await page.getByRole('button', { name: '删除第 2 条', exact: true }).click();
  await page.locator('#dailyLibrarySave').click();
  await page.locator('#dailyLibraryStatus').filter({ hasText: '词库已保存到云端' }).waitFor();
  assert.equal(await page.evaluate(() => window.libraryRequests.filter(x => x.action === 'library-save').length), 2);
  assert.equal(await page.evaluate(() => window.remoteLibraries.fortune[0].text), '春风又至');
});

test('library failures and conflicts preserve drafts, and edits during save remain dirty', async (t) => {
  const page = await libraryFixture(t);
  await page.getByRole('button', { name: '编辑签到词库', exact: true }).click();
  const field = page.getByRole('textbox', { name: '第 1 条祝福语', exact: true });
  await field.fill('我的草稿。');
  await page.evaluate(() => { window.saveFailure = 'DAILY_BOT_UNAVAILABLE'; });
  await page.locator('#dailyLibrarySave').click();
  await page.locator('#dailyLibraryStatus').filter({ hasText: '保存尚未确认' }).waitFor();
  assert.equal(await field.inputValue(), '我的草稿。');
  await page.evaluate(() => {
    window.saveFailure = 'DAILY_BOT_LIBRARY_CONFLICT';
    window.libraryVersion = 'c'.repeat(64);
    window.remoteLibraries.checkin[0] = '另一台设备的文案。';
  });
  await page.locator('#dailyLibrarySave').click();
  await page.locator('#dailyLibraryReload').waitFor();
  assert.equal(await field.inputValue(), '我的草稿。');
  assert.equal(await page.locator('#dailyLibrarySave').isDisabled(), true);
  await page.evaluate(() => { window.holdRead = true; });
  await page.locator('#dailyLibraryReload').click();
  await page.waitForFunction(() => Boolean(window.finishLibraryRead));
  await field.fill('等待载入期间的修改。');
  await page.evaluate(() => { window.holdRead = false; window.finishLibraryRead(); });
  await page.locator('#dailyLibraryStatus').filter({ hasText: '载入期间有新的修改' }).waitFor();
  assert.equal(await field.inputValue(), '等待载入期间的修改。');
  await page.locator('#dailyLibraryReload').click();
  assert.equal(await field.inputValue(), '另一台设备的文案。');
  await page.evaluate(() => { window.saveFailure = ''; window.holdSave = true; });
  await field.fill('提交的版本。');
  await page.locator('#dailyLibrarySave').click();
  await page.waitForFunction(() => Boolean(window.finishLibrarySave));
  await field.fill('保存期间继续输入。');
  await page.evaluate(() => window.finishLibrarySave());
  await page.locator('#dailyLibraryStatus').filter({ hasText: '后续修改仍未保存' }).waitFor();
  assert.equal(await field.inputValue(), '保存期间继续输入。');
  assert.equal(await page.locator('#dailyLibrarySave').isDisabled(), false);
  await page.locator('#dailyLibrarySave').click();
  await page.evaluate(() => window.libraryAccount({ state: 'authorized', streamer: { accountName: 'two' } }));
  await page.evaluate(() => window.finishLibrarySave());
  await page.waitForFunction(() => document.getElementById('dailyLibraryCount').textContent === '尚未读取');
  assert.equal(await page.locator('#dailyLibraryList input').count(), 0);
});

test('cloud daily controls keep confirmed state, disclose failed close and ignore old account replies', async (t) => {
  const page = await fixture(t, 'daily-bots');
  await page.evaluate(async (html) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const panel = parsed.getElementById('otherDanmakuFeature');
    panel.hidden = false;
    document.body.append(panel);
    window.dailyRequests = [];
    window.dailyToasts = [];
    const account = (name) => ({
      state: 'authorized',
      streamer: { accountName: name, songPageUrl: `https://${name}.test` },
    });
    window.dailyAccount = account;
    const license = {
      getState: async () => account('one'),
      onStateChanged(fn) {
        window.dailyState = fn;
        return () => {};
      },
    };
    const bridge = { invoke: (request) => new Promise((resolve) => window.dailyRequests.push({ request, resolve })) };
    const { initDanmakuDailyBots } = await import('/js/admin/danmaku-daily-bots.js');
    initDanmakuDailyBots({
      bridge,
      license,
      toast: (message, options) => window.dailyToasts.push({ message, options }),
    });
    window.resolveDaily = (index, enabled, contextId = 'one') =>
      window.dailyRequests[index].resolve({
        ok: true,
        contextId,
        data: {
          executionOwner: 'server',
          observedAt: '2026-09-18T01:00:00.000Z',
          takeover: { state: 'ready', decision: 'no-legacy', revision: 1 },
          checkin: { enabled, revision: index + 1, reason: enabled ? 'running' : 'disabled' },
          fortune: { enabled: false, revision: 0, reason: 'disabled' },
        },
      });
  }, readAdminFragmentHtml('pages/admin/toolbox/danmaku.html'));
  await page.waitForFunction(() => window.dailyRequests.length === 1);
  await page.evaluate(() => window.resolveDaily(0, true));
  await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), true);
  assert.equal(await page.locator('#dailyBotcheckinStatus').textContent(), '');
  await page.locator('#danmakuCheckinToggle').click();
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), true);
  assert.equal(await page.locator('#danmakuCheckinToggle').isDisabled(), true);
  await page.evaluate(() => window.dailyRequests[1].resolve({ ok: false, error: 'DAILY_BOT_UNAVAILABLE' }));
  await page.waitForFunction(() => window.dailyToasts.length === 1);
  const [failure] = await page.evaluate(() => window.dailyToasts);
  assert.match(failure.message, /关闭尚未同步/);
  assert.equal(failure.options.type, 'error');
  assert.equal(await page.locator('#dailyBotcheckinStatus').textContent(), '云端状态待刷新');
  assert.equal(await page.locator('#dailyBotStatus').textContent(), '关键词回复与点歌回复需客户端在线，其余功能在云端运行。');
  await page.locator('#dailyBotRefresh').click();
  await page.evaluate(() => window.dailyState(window.dailyAccount('two')));
  await page.waitForFunction(() => window.dailyRequests.length === 4);
  await page.evaluate(() => {
    window.resolveDaily(3, false, 'two');
    window.resolveDaily(2, true);
  });
  await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
  assert.equal(await page.locator('#danmakuCheckinToggle').isChecked(), false);
  await page.locator('#dailyBotRefresh').click();
  await page.evaluate(() => window.dailyRequests[4].resolve({ ok: false, error: 'DAILY_BOT_UNSUPPORTED' }));
  await page.waitForFunction(() => document.getElementById('dailyBotStatus').textContent.includes('暂不支持云端签到和抽签'));
  assert.match(await page.locator('#dailyBotStatus').textContent(), /联系管理员/);
  assert.equal(await page.locator('#danmakuCheckinToggle').isDisabled(), true);
});

for (const [name, takeover, songPageUrl] of [
  ['new account', { state: 'pending', decision: null, revision: 0 }, ''],
  ['restored account', { state: 'ready', decision: 'imported', revision: 2 }, undefined],
]) {
  test(`daily controls enable without a song page URL or old-data UI for a ${name}`, async (t) => {
    const page = await fixture(t, 'daily-bots');
    await page.evaluate(
      async ({ html, takeover, songPageUrl }) => {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const panel = parsed.getElementById('otherDanmakuFeature');
        panel.hidden = false;
        document.body.append(panel);
        window.dailyRequests = [];
        window.dailyToasts = [];
        const data = {
          executionOwner: 'server',
          observedAt: '2026-09-18T01:00:00.000Z',
          takeover,
          checkin: { enabled: false, revision: 0, reason: 'disabled' },
          fortune: { enabled: false, revision: 0, reason: 'disabled' },
        };
        const bridge = {
          async invoke(request) {
            window.dailyRequests.push(request);
            if (request.action === 'update') {
              const { kind, enabled } = request.payload;
              data[kind] = { enabled, revision: data[kind].revision + 1, reason: enabled ? 'running' : 'disabled' };
              if (data.takeover.state === 'pending')
                data.takeover = { state: 'ready', decision: 'fresh-start', revision: 1 };
            }
            return { ok: true, contextId: 'one', data: structuredClone(data) };
          },
        };
        const license = {
          getState: async () => ({
            state: 'authorized',
            streamer: { accountName: 'one', songPageUrl },
          }),
        };
        const { initDanmakuDailyBots } = await import('/js/admin/danmaku-daily-bots.js');
        initDanmakuDailyBots({ bridge, license, toast: (message) => window.dailyToasts.push(message) });
      },
      { html: readAdminFragmentHtml('pages/admin/toolbox/danmaku.html'), takeover, songPageUrl },
    );
    assert.equal(await page.evaluate(() => window.dailyRequests.length), 1);
    await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
    assert.equal(await page.locator('#dailyBotTakeover').count(), 0);
    assert.doesNotMatch(
      await page.locator('#otherDanmakuFeature').textContent(),
      /处理旧数据|读取旧数据|旧累计|从零开始/,
    );
    assert.equal(await page.locator('#danmakuFortuneToggle').isDisabled(), false);
    await page.locator('#danmakuCheckinToggle').click();
    await page.waitForFunction(() => document.getElementById('danmakuCheckinToggle').checked);
    assert.equal(await page.locator('#danmakuFortuneToggle').isChecked(), false);
    const requests = await page.evaluate(() => window.dailyRequests);
    assert.deepEqual(
      requests.map((item) => item.action),
      ['open', 'update'],
    );
    assert.deepEqual(requests[1].payload, { kind: 'checkin', enabled: true, expectedRevision: 0 });
    assert.deepEqual(await page.evaluate(() => window.dailyToasts), ['签到机器人已开启']);
    assert.equal(await page.locator('#dailyBotcheckinStatus').textContent(), '');
    assert.equal(await page.locator('#dailyBotStatus').textContent(), '关键词回复与点歌回复需客户端在线，其余功能在云端运行。');
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    assert.equal(await page.locator('#dailyBotcheckinStatus').textContent(), '云端状态待刷新');
    assert.equal(await page.locator('#danmakuCheckinToggle').isDisabled(), true);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.getElementById('danmakuCheckinToggle').disabled);
  });
}
