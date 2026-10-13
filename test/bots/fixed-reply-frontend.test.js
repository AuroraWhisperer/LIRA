'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const fixture = createUiFixture();

async function editorFixture(t) {
  const page = await fixture(t, 'fixed-replies');
  await page.evaluate(async (html) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const panel = parsed.querySelector('.danmaku-fixed-reply-section');
    document.body.append(panel);
    window.writes = [];
    window.queryWrites = [];
    window.queryState = { ok: true, status: 'confirmed', values: { giftAutoThanksEnabled: true, giftStatsQueryEnabled: false } };
    const giftListeners = new Set();
    window.changeGiftState = (state) => giftListeners.forEach((listener) => listener(state));
    window.remote = {
      ok: true, customExactReplyEnabled: false, customExactReplies: [{ trigger: '歌单', reply: '发送 点歌 歌名' }],
      scheduledDanmakuEnabled: false,
      scheduledDanmaku: { mode: 'fixed', intervalSeconds: 300, minSeconds: 300, maxSeconds: 600, selection: 'sequential', messages: [] },
    };
    const bridge = {
      getState: async () => ({ state: 'authorized', streamer: { accountName: 'one' } }),
      onStateChanged(fn) { window.changeAccount = fn; return () => {}; },
      getFixedReplySettings: async () => structuredClone(window.remote),
      getGiftInteractionState: async () => structuredClone(window.queryState),
      onGiftInteractionStateChanged(fn) { giftListeners.add(fn); return () => giftListeners.delete(fn); },
      async setGiftInteraction(key, enabled) {
        window.queryWrites.push({ key, enabled });
        window.queryState.values[key] = enabled;
        window.changeGiftState(structuredClone(window.queryState));
        return structuredClone(window.queryState);
      },
      async updateFixedReplySettings(patch) {
        window.writes.push(structuredClone(patch));
        if (window.holdSave) await new Promise((resolve) => { window.finishSave = resolve; });
        if (window.failSave) return { ok: false, error: 'INVALID_FIXED_REPLY_SETTINGS' };
        Object.assign(window.remote, structuredClone(patch));
        return structuredClone(window.remote);
      },
    };
    window.queryBridge = bridge;
    const { initDanmakuCloudReplies } = await import('/js/admin/danmaku-cloud-replies.js');
    const { initFixedReplyEditor } = await import('/js/admin/danmaku-fixed-replies.js');
    const { initDanmakuQueryReplies } = await import('/js/admin/danmaku-query-replies.js');
    const { initGiftInteractionControls } = await import('/js/admin/gifts/interaction-controls.js');
    window.fixed = initDanmakuCloudReplies({ bridge });
    initDanmakuQueryReplies();
    initGiftInteractionControls({ bridge, surface: 'danmaku', notify: () => {} });
    initFixedReplyEditor();
  }, readAdminFragmentHtml('pages/admin/toolbox/danmaku.html'));
  await page.waitForFunction(() => !document.getElementById('danmakuExactReplyToggle').disabled);
  return page;
}

test('query replies have a separate entry after the existing eight and exact editor saves only full-match rules', async (t) => {
  const page = await editorFixture(t);
  assert.deepEqual(await page.locator('[data-fixed-item]').evaluateAll((items) => items.map((item) => item.dataset.fixedItem)),
    ['checkin', 'fortune', 'welcome', 'random', 'exact', 'diy', 'pk', 'scheduled', 'query']);
  await page.getByRole('button', { name: '编辑完整匹配回复', exact: true }).click();
  assert.equal(await page.locator('#danmakuFixedEditorTitle').innerText(), '完整匹配回复');
  const builtIn = page.locator('#danmakuExactReplyList .danmaku-custom-reply-row').first();
  assert.equal(await builtIn.locator('input').first().inputValue(), '菜单');
  assert.equal(await builtIn.locator('input').nth(1).inputValue(), '签到、抽签、礼物特效、礼物查询、盲盒查询');
  assert.equal(await builtIn.locator('input[readonly]').count(), 2);
  assert.equal(await builtIn.locator('button').count(), 0);
  assert.equal(await page.locator('#danmakuExactReplyCount').innerText(), '1 条');
  await page.locator('#danmakuExactKeywordInput').fill('月卡');
  await page.locator('#danmakuExactReplyInput').fill('上舰解锁点歌月卡');
  await page.locator('#danmakuExactReplyAddBtn').click();
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  await page.locator('#danmakuExactReplySaveBtn').click();
  await page.locator('#danmakuExactReplyStatus').filter({ hasText: '已保存 2 条' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.writes[0]), { customExactReplies: [
    { trigger: '歌单', reply: '发送 点歌 歌名' }, { trigger: '月卡', reply: '上舰解锁点歌月卡' },
  ] });
  await page.locator('#danmakuExactReplyToggle').check();
  await page.waitForFunction(() => window.remote.customExactReplyEnabled);
  assert.deepEqual(await page.evaluate(() => window.writes[1]), { customExactReplyEnabled: true });
  assert.equal(await page.locator('#danmakuPkReportRefreshBtn').count(), 0);
  await page.getByRole('button', { name: '编辑关键词回复', exact: true }).click();
  assert.equal(await page.locator('#danmakuFixedEditorTitle').innerText(), '关键词回复');
});

test('query library uses month placeholders and year syntax, filters locally and uses the existing gift-query switch', async (t) => {
  const page = await editorFixture(t);
  await page.evaluate(async (html) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.append(parsed.getElementById('giftInteractionControls'));
    const { initGiftInteractionControls } = await import('/js/admin/gifts/interaction-controls.js');
    initGiftInteractionControls({ bridge: window.queryBridge, notify: () => {} });
  }, readAdminFragmentHtml('pages/admin/gifts/page.html'));
  await page.getByRole('button', { name: '查看查询回复指令清单' }).click();
  const list = page.locator('#danmakuQueryReplyList');
  const triggers = await list.locator('input').evaluateAll((inputs) => inputs.filter((_input, index) => index % 2 === 0).map((input) => input.value));
  for (const period of ['今天', '昨天', '本周', '本月', '上月', '今年', '去年', '累计',
    'x月', '2026年', '2026年x月']) {
    for (const object of ['礼物', '盲盒']) assert.ok(triggers.includes(`${period}${object}`));
  }
  assert.equal(triggers.length, 23);
  assert.equal(triggers.some((trigger) => /\d月/.test(trigger)), false);
  assert.equal(await list.locator('input:not([readonly])').count(), 0);
  assert.equal(await page.locator('#danmakuQueryRepliesPanel button.primary').count(), 0);
  await page.getByLabel('查找指令').fill('本月盲盒');
  assert.equal(await list.locator('.danmaku-query-reply-row:visible').count(), 1);
  assert.equal(await list.locator('.danmaku-query-reply-row:visible input').first().inputValue(), '本月盲盒');
  for (const [alias, trigger] of [
    ['今日礼物', '今天礼物'], ['昨日盲盒', '昨天盲盒'], ['这周礼物', '本周礼物'],
    ['这个月盲盒', '本月盲盒'], ['上个月礼物', '上月礼物'], ['历史礼物', '累计礼物'],
    ['全部盲盒', '累计盲盒'], ['x月礼物', 'x月礼物'], ['2026年x月盲盒', '2026年x月盲盒'],
  ]) {
    await page.getByLabel('查找指令').fill(alias);
    assert.ok((await list.locator('.danmaku-query-reply-row:visible input').evaluateAll(
      (inputs) => inputs.map((input) => input.value),
    )).includes(trigger), `${alias} should find ${trigger}`);
  }
  await page.getByLabel('查找指令').fill('2026年');
  assert.equal(await list.locator('.danmaku-query-reply-row:visible').count(), 4);
  await page.getByLabel('查找指令').fill('两位月份');
  assert.equal(await list.locator('.danmaku-query-reply-row:visible').count(), 4);
  await page.getByLabel('查找指令').fill('不存在的词条');
  assert.equal(await page.locator('#danmakuQuerySearchEmpty').isVisible(), true);
  await page.getByLabel('查找指令').fill('');
  await page.locator('#danmakuQueryRepliesPanel').getByRole('button', { name: '下一页' }).click();
  assert.equal(await list.locator('.danmaku-query-reply-row:visible').count(), 6);
  await page.locator('#danmakuQueryToggle').check();
  await page.waitForFunction(() => window.queryState.values.giftStatsQueryEnabled);
  assert.deepEqual(await page.evaluate(() => window.queryWrites), [{ key: 'giftStatsQueryEnabled', enabled: true }]);
  assert.equal(await page.locator('#giftStatsQueryEnabled').isChecked(), true);
  assert.equal(await page.evaluate(() => window.queryState.values.giftAutoThanksEnabled), true);
  assert.deepEqual(await page.evaluate(() => window.writes), []);
  await page.locator('#giftStatsQueryEnabled').uncheck();
  await page.waitForFunction(() => !document.getElementById('danmakuQueryToggle').checked);
  assert.deepEqual(await page.evaluate(() => window.queryWrites), [
    { key: 'giftStatsQueryEnabled', enabled: true }, { key: 'giftStatsQueryEnabled', enabled: false },
  ]);
  assert.equal(await page.locator('#danmakuQueryToggle').isChecked(), false);
  assert.equal(await page.locator('#giftAutoThanksEnabled').isChecked(), true);
});

test('timer interval and selection modes save together; invalid ranges and failures retain the draft', async (t) => {
  const page = await editorFixture(t);
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  await page.locator('#danmakuScheduledMode').selectOption('random');
  assert.equal(await page.locator('#danmakuScheduledFixedField').isVisible(), false);
  await page.locator('#danmakuScheduledMin').fill('70');
  await page.locator('#danmakuScheduledMax').fill('60');
  await page.locator('#danmakuScheduledLibraryAdd').click();
  await page.getByLabel('定时弹幕第 1 条', { exact: true }).fill('上舰解锁点歌月卡');
  await page.locator('#danmakuScheduledLibraryAdd').click();
  await page.getByLabel('定时弹幕第 2 条', { exact: true }).fill('欢迎发送菜单查看互动');
  await page.locator('#danmakuScheduledSave').click();
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  await page.locator('#danmakuScheduledMax').fill('90');
  await page.locator('#danmakuScheduledSelection').selectOption('random');
  await page.evaluate(() => { window.failSave = true; });
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '草稿已保留' }).waitFor();
  await page.evaluate(() => window.fixed.refresh());
  assert.equal(await page.locator('#danmakuScheduledMin').inputValue(), '70');
  assert.deepEqual(await page.locator('#danmakuScheduledLibraryList input').evaluateAll(
    (inputs) => inputs.map((input) => input.value),
  ), ['上舰解锁点歌月卡', '欢迎发送菜单查看互动']);
  await page.evaluate(() => { window.failSave = false; });
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '已保存到云端' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.remote.scheduledDanmaku), {
    mode: 'random', intervalSeconds: 300, minSeconds: 70, maxSeconds: 90, selection: 'random',
    messages: ['上舰解锁点歌月卡', '欢迎发送菜单查看互动'],
  });
  assert.equal(await page.locator('#danmakuScheduledToggle').isChecked(), false);
});

test('scheduled library edits all fifteen entries across search and pages without auto-saving', async (t) => {
  const page = await editorFixture(t);
  const original = Array.from({ length: 15 }, (_, index) => `文案 ${index + 1}`);
  await page.evaluate(async (messages) => {
    window.remote.scheduledDanmaku.messages = messages;
    await window.fixed.refresh();
  }, original);
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  const list = page.locator('#danmakuScheduledLibraryList');
  assert.equal(await list.locator('.danmaku-blessing-row').count(), 6);
  assert.equal(await page.locator('#danmakuScheduledLibraryCount').innerText(), '15 条');
  await page.locator('#danmakuScheduledLibrarySearch').fill('文案 15');
  assert.equal(await list.locator('input').count(), 1);
  assert.equal(await page.locator('#danmakuScheduledSave').isDisabled(), true);
  await page.getByLabel('定时弹幕第 15 条', { exact: true }).fill('末条已编辑');
  await page.locator('#danmakuScheduledLibrarySearch').fill('');
  await page.locator('#danmakuScheduledLibraryNext').click();
  await page.getByLabel('定时弹幕第 7 条', { exact: true }).fill('第二页已编辑');
  await page.getByRole('button', { name: '删除第 8 条定时弹幕', exact: true }).click();
  await page.locator('#danmakuScheduledLibraryAdd').click();
  await page.getByLabel('定时弹幕第 15 条', { exact: true }).fill('新增文案');
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '已保存到云端' }).waitFor();
  const expected = [...original];
  expected[6] = '第二页已编辑';
  expected[14] = '末条已编辑';
  expected.splice(7, 1);
  expected.push('新增文案');
  assert.deepEqual(await page.evaluate(() => window.writes[0].scheduledDanmaku.messages), expected);
  assert.equal(await page.locator('#danmakuScheduledToggle').isChecked(), false);
});

test('scheduled library validates off-page drafts and clears them when the account changes during save', async (t) => {
  const page = await editorFixture(t);
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  for (let index = 1; index <= 7; index++) {
    await page.locator('#danmakuScheduledLibraryAdd').click();
    if (index !== 1) await page.getByLabel(`定时弹幕第 ${index} 条`, { exact: true }).fill(`文案 ${index}`);
  }
  await page.locator('#danmakuScheduledSave').click();
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  const first = page.getByLabel('定时弹幕第 1 条', { exact: true });
  assert.equal(await first.isVisible(), true);
  await first.fill('字'.repeat(121));
  await page.locator('#danmakuScheduledSave').click();
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  await first.fill('😀'.repeat(120));
  await page.evaluate(() => { window.holdSave = true; });
  await page.locator('#danmakuScheduledSave').click();
  await page.waitForFunction(() => typeof window.finishSave === 'function');
  await page.evaluate(() => { window.changeAccount({ state: 'unauthorized' }); window.finishSave(); });
  assert.equal(await page.locator('#danmakuScheduledLibraryList input').count(), 0);
  assert.equal(await page.locator('#danmakuScheduledLibraryCount').innerText(), '0 条');
  assert.equal(await page.locator('#danmakuScheduledLibraryAdd').isDisabled(), true);
});

test('exact rule drafts survive failed saves and are cleared when the account changes during a save', async (t) => {
  const page = await editorFixture(t);
  await page.getByRole('button', { name: '编辑完整匹配回复', exact: true }).click();
  const field = page.getByLabel('第 1 条完整匹配回复的回复内容', { exact: true });
  await field.fill('保留我的草稿');
  await page.evaluate(() => { window.failSave = true; });
  await page.locator('#danmakuExactReplySaveBtn').click();
  await page.locator('#danmakuExactReplyStatus').filter({ hasText: '保存失败' }).waitFor();
  await page.evaluate(() => window.fixed.refresh());
  assert.equal(await field.inputValue(), '保留我的草稿');
  await page.evaluate(() => { window.failSave = false; window.holdSave = true; });
  await page.locator('#danmakuExactReplySaveBtn').click();
  await page.waitForFunction(() => typeof window.finishSave === 'function');
  await page.evaluate(() => { window.changeAccount({ state: 'unauthorized' }); window.finishSave(); });
  assert.equal(await page.locator('#danmakuExactReplyList input:not([readonly])').count(), 0);
  assert.equal(await page.locator('#danmakuExactReplyList input[readonly]').count(), 2);
  assert.equal(await page.locator('#danmakuExactReplyCount').innerText(), '0 条');
  assert.equal(await page.locator('#danmakuExactReplyList .danmaku-blessing-empty').count(), 0);
  assert.equal(await page.locator('#danmakuExactKeywordInput').isDisabled(), true);
  assert.equal(await page.locator('#danmakuExactReplyToggle').isChecked(), false);
});

test('switching timer modes preserves saved values for inactive interval fields', async (t) => {
  const page = await editorFixture(t);
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  await page.locator('#danmakuScheduledInterval').fill('');
  await page.locator('#danmakuScheduledMode').selectOption('random');
  await page.locator('#danmakuScheduledMin').fill('30');
  await page.locator('#danmakuScheduledMax').fill('60');
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '已保存到云端' }).waitFor();
  assert.equal(await page.evaluate(() => window.remote.scheduledDanmaku.intervalSeconds), 300);
  await page.locator('#danmakuScheduledMin').fill('');
  await page.locator('#danmakuScheduledMax').fill('1');
  await page.locator('#danmakuScheduledMode').selectOption('fixed');
  await page.locator('#danmakuScheduledInterval').fill('120');
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '已保存到云端' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.remote.scheduledDanmaku), {
    mode: 'fixed', intervalSeconds: 120, minSeconds: 30, maxSeconds: 60, selection: 'sequential', messages: [],
  });
});
