'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const fixture = createUiFixture();

async function editorFixture(t, category = 'replies', library = false) {
  const page = await fixture(t, 'fixed-replies');
  await page.evaluate(async ({ html, library }) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const panel = parsed.getElementById('otherDanmakuFeature');
    panel.hidden = false;
    document.body.append(panel);
    window.writes = [];
    window.queryWrites = [];
    const { DEFAULT_GIFT_THANKS_TEMPLATES, createGiftThanksReplies } = await import('/js/shared/gift-thanks-templates.js');
    window.queryState = { ok: true, status: 'confirmed', templates: { ...DEFAULT_GIFT_THANKS_TEMPLATES },
      values: { giftAutoThanksEnabled: true, giftStatsQueryEnabled: false } };
    if (library) window.queryState.replies = createGiftThanksReplies();
    window.templateWrites = [];
    const giftListeners = new Set();
    const accountListeners = new Set();
    window.changeAccount = state => accountListeners.forEach(listener => listener(state));
    window.changeGiftState = (state) => giftListeners.forEach((listener) => listener(state));
    window.remote = {
      ok: true, customExactReplyEnabled: false, customExactReplies: [{ trigger: '歌单', reply: '发送 点歌 歌名' }],
      scheduledDanmakuEnabled: false,
      scheduledDanmaku: { mode: 'fixed', intervalSeconds: 300, minSeconds: 300, maxSeconds: 600, selection: 'sequential', messages: [] },
    };
    const bridge = {
      getState: async () => ({ state: 'authorized', streamer: { accountName: 'one' } }),
      onStateChanged(fn) { accountListeners.add(fn); return () => accountListeners.delete(fn); },
      getFixedReplySettings: async () => structuredClone(window.remote),
      getGiftInteractionState: async () => structuredClone(window.queryState),
      onGiftInteractionStateChanged(fn) { giftListeners.add(fn); return () => giftListeners.delete(fn); },
      async setGiftInteraction(key, enabled) {
        window.queryWrites.push({ key, enabled });
        window.queryState.values[key] = enabled;
        window.changeGiftState(structuredClone(window.queryState));
        return structuredClone(window.queryState);
      },
      async setGiftThanksTemplates(templates) {
        window.templateWrites.push(structuredClone(templates));
        if (window.holdThanksSave) await new Promise(resolve => { window.finishThanksSave = resolve; });
        if (window.failThanksSave) return { ...structuredClone(window.queryState), ok: false };
        window.queryState.templates = structuredClone(templates);
        window.changeGiftState(structuredClone(window.queryState));
        return structuredClone(window.queryState);
      },
      async setGiftThanksReplies(replies) {
        window.templateWrites.push(structuredClone(replies));
        if (window.holdThanksSave) await new Promise(resolve => { window.finishThanksSave = resolve; });
        if (window.failThanksSave) return { ...structuredClone(window.queryState), ok: false };
        window.queryState.replies = structuredClone(replies);
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
    const { initDanmakuTabs } = await import('/js/admin/danmaku-tabs.js');
    const { initDanmakuQueryReplies } = await import('/js/admin/danmaku-query-replies.js');
    const { initGiftInteractionControls } = await import('/js/admin/gifts/interaction-controls.js');
    const { initDanmakuGiftThanks } = await import('/js/admin/danmaku-gift-thanks.js');
    window.fixed = initDanmakuCloudReplies({ bridge });
    initDanmakuQueryReplies();
    const thanks = initDanmakuGiftThanks({ bridge });
    initGiftInteractionControls({ bridge, surface: 'danmaku', notify: () => {}, onState: thanks.updateState });
    initDanmakuTabs();
    initFixedReplyEditor();
  }, { html: readAdminFragmentHtml('pages/admin/toolbox/danmaku.html'), library });
  await page.waitForFunction(() => !document.getElementById('danmakuExactReplyToggle').disabled);
  await page.locator(`[data-danmaku-tab="${category}"]`).click();
  return page;
}

test('the shared editor saves only full-match rules and keeps built-in commands read-only', async (t) => {
  const page = await editorFixture(t);
  await page.getByRole('button', { name: '编辑完整匹配回复', exact: true }).click();
  const builtIn = page.locator('#danmakuExactReplyList .danmaku-custom-reply-row').first();
  assert.equal(await builtIn.locator('input').first().inputValue(), '菜单');
  assert.equal(await builtIn.locator('input[readonly]').count(), 2);
  assert.equal(await builtIn.locator('button').count(), 0);
  await page.locator('#danmakuExactKeywordInput').fill('月卡');
  await page.locator('#danmakuExactReplyInput').fill('上舰解锁点歌月卡');
  await page.locator('#danmakuExactReplyAddBtn').click();
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  await page.locator('#danmakuExactReplySaveBtn').click();
  await page.locator('#danmakuExactReplyStatus').filter({ hasText: '已保存 2 条' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.writes[0]), { customExactReplies: [
    { trigger: '歌单', reply: '发送 点歌 歌名' }, { trigger: '月卡', reply: '上舰解锁点歌月卡' },
  ] });
  await page.keyboard.press('Escape');
  await page.locator('#danmakuExactReplyToggle').check();
  await page.waitForFunction(() => window.remote.customExactReplyEnabled);
  assert.deepEqual(await page.evaluate(() => window.writes[1]), { customExactReplyEnabled: true });
});

test('query and thanks switches stay in sync with the shared gift-interaction setting', async (t) => {
  const page = await editorFixture(t);
  await page.evaluate(async (html) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.append(parsed.getElementById('giftInteractionControls'));
    const { initGiftInteractionControls } = await import('/js/admin/gifts/interaction-controls.js');
    initGiftInteractionControls({ bridge: window.queryBridge, notify: () => {} });
  }, readAdminFragmentHtml('pages/admin/gifts/page.html'));
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
  assert.equal(await page.locator('#danmakuGiftThanksToggle').isChecked(), true);
  await page.locator('[data-danmaku-tab="welcome"]').click();
  await page.locator('#danmakuGiftThanksToggle').uncheck();
  await page.waitForFunction(() => !window.queryState.values.giftAutoThanksEnabled);
  assert.equal(await page.locator('#danmakuQueryToggle').isChecked(), false);
  await page.locator('#danmakuGiftThanksToggle').check();
  await page.waitForFunction(() => window.queryState.values.giftAutoThanksEnabled);
  assert.deepEqual((await page.evaluate(() => window.queryWrites)).slice(2), [
    { key: 'giftAutoThanksEnabled', enabled: false }, { key: 'giftAutoThanksEnabled', enabled: true },
  ]);
});

test('thanks edits keep parameters atomic, support native undo and paste untrusted HTML as text', async (t) => {
  const page = await editorFixture(t, 'welcome');
  await page.getByRole('button', { name: '编辑礼物答谢文案' }).click();
  const editor = page.getByRole('textbox', { name: '礼物答谢', exact: true });
  assert.equal(await editor.locator('[contenteditable="false"]').count(), 3);
  await editor.evaluate(node => {
    const range = document.createRange();
    range.selectNodeContents(node.firstChild);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    node.focus();
  });
  await page.keyboard.insertText('谢谢');
  await editor.locator('[data-thanks-token="{称呼}"]').click();
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#danmakuGiftThanksSave').isDisabled(), true);
  await page.getByRole('group', { name: '插入礼物答谢参数', exact: true }).getByRole('button', { name: '观众称呼', exact: true }).click();
  assert.equal(await editor.locator('[data-thanks-token="{称呼}"]').count(), 1);
  await editor.press('Control+z');
  assert.equal(await editor.locator('[data-thanks-token="{称呼}"]').count(), 0);
  await editor.press('Control+Shift+z');
  assert.equal(await editor.locator('[data-thanks-token="{称呼}"]').count(), 1);
  const tokenLabel = await editor.locator('[data-thanks-token="{称呼}"]').textContent();
  await page.keyboard.insertText('呀');
  assert.equal(await editor.locator('[data-thanks-token="{称呼}"]').textContent(), tokenLabel);
  await editor.press('Control+z');
  await page.getByRole('button', { name: '保存答谢文案', exact: true }).click();
  await page.locator('#danmakuGiftThanksSaveState').filter({ hasText: '文案已保存到云端' }).waitFor();
  assert.equal((await page.evaluate(() => window.templateWrites[0])).gift, '谢谢{称呼}投喂{礼物}；{金额}');
  assert.equal(await page.evaluate(() => window.queryState.values.giftAutoThanksEnabled), true);
  assert.deepEqual(await page.evaluate(() => window.queryWrites), []);
  await editor.evaluate(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', '<img src=x>感谢{称呼}投喂{礼物}；{金额}');
    clipboard.setData('text/html', '<img src=x onerror="throw new Error(\'unsafe\')">');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  assert.equal(await editor.locator('img').count(), 0);
  assert.equal(await editor.locator('[data-thanks-token]').count(), 3);
  assert.match(await editor.textContent(), /^<img src=x>/);
  await page.getByRole('button', { name: '恢复默认文案' }).click();
  assert.equal(await page.evaluate(() => window.templateWrites.length), 1);
  assert.equal(await page.locator('#danmakuGiftThanksSave').isDisabled(), false);
  await editor.fill('长'.repeat(70) + '{称呼}{礼物}{金额}');
  assert.equal(await page.locator('#danmakuGiftThanksSave').isDisabled(), true);
});

test('thanks drafts survive a failed save and account changes discard the prior account draft', async (t) => {
  const page = await editorFixture(t, 'welcome');
  await page.getByRole('button', { name: '编辑礼物答谢文案' }).click();
  const editor = page.getByRole('textbox', { name: '礼物答谢', exact: true });
  await editor.fill('谢谢{称呼}支持{礼物}；{金额}');
  await page.evaluate(() => { window.failThanksSave = true; });
  await page.getByRole('button', { name: '保存答谢文案', exact: true }).click();
  await page.locator('#danmakuGiftThanksSaveState').filter({ hasText: '草稿已保留' }).waitFor();
  assert.equal(await editor.textContent(), '谢谢{称呼}支持{礼物}；{金额}');
  await page.evaluate(() => { window.failThanksSave = false; window.holdThanksSave = true; });
  await page.getByRole('button', { name: '保存答谢文案', exact: true }).click();
  await page.waitForFunction(() => typeof window.finishThanksSave === 'function');
  await page.evaluate(() => { window.changeAccount({ state: 'unauthorized' }); window.finishThanksSave(); });
  assert.doesNotMatch(await editor.textContent(), /谢谢|支持/);
  assert.equal(await editor.getAttribute('contenteditable'), 'false');
});

test('gift and three guard libraries keep independent modes and drafts through scene switches and failed saves', async (t) => {
  const page = await editorFixture(t, 'welcome', true);
  await page.getByRole('button', { name: '编辑礼物答谢文案', exact: true }).click();
  const panel = page.locator('#danmakuGiftThanksLibrary');
  await panel.getByRole('textbox', { name: '礼物答谢第 1 条', exact: true }).fill('谢谢{称呼}的支持！');
  await panel.getByRole('button', { name: '添加文案', exact: true }).click();
  assert.equal(await page.locator('#danmakuGiftThanksSave').isDisabled(), true);
  await panel.getByRole('textbox', { name: '礼物答谢第 2 条', exact: true }).fill('谢谢你送的{礼物}！');
  await panel.getByLabel('礼物答谢发送方式', { exact: true }).selectOption('mention');
  for (const preview of await panel.locator('output').allTextContents()) assert.match(preview, /^@小明的B站昵称 /);
  await panel.getByLabel('礼物答谢发送方式', { exact: true }).selectOption('plain');
  assert.match(await panel.locator('output').nth(0).textContent(), /小明的支持/);
  for (const preview of await panel.locator('output').allTextContents()) assert.doesNotMatch(preview, /^@/);
  for (const [kind, label] of [['captain', '舰长'], ['admiral', '提督'], ['governor', '总督']]) {
    await panel.locator('[data-thanks-scene]').selectOption(kind);
    await panel.getByRole('textbox', { name: `${label}答谢第 1 条`, exact: true }).fill(`谢谢你成为${label}！`);
    await panel.getByLabel(`${label}答谢发送方式`, { exact: true }).selectOption(kind === 'admiral' ? 'plain' : 'mention');
  }
  await panel.locator('[data-thanks-enabled]').uncheck();
  await page.evaluate(() => { window.failThanksSave = true; });
  await page.locator('#danmakuGiftThanksSave').click();
  await page.locator('#danmakuGiftThanksSaveState').filter({ hasText: '草稿已保留' }).waitFor();
  await panel.locator('[data-thanks-scene]').selectOption('gift');
  assert.equal(await panel.getByLabel('礼物答谢发送方式', { exact: true }).inputValue(), 'plain');
  assert.equal(await panel.getByRole('textbox', { name: '礼物答谢第 2 条', exact: true }).textContent(), '谢谢你送的礼物和数量！');
  await page.evaluate(() => { window.failThanksSave = false; });
  await page.locator('#danmakuGiftThanksSave').click();
  await page.locator('#danmakuGiftThanksSaveState').filter({ hasText: '文案已保存到云端' }).waitFor();
  const saved = await page.evaluate(() => window.queryState.replies);
  assert.deepEqual(saved.gift.messages, [{ text: '谢谢{称呼}的支持！' }, { text: '谢谢你送的{礼物}！' }]);
  assert.equal(saved.gift.mode, 'plain');
  assert.equal(saved.governor.enabled, false);
  assert.equal(saved.captain.mode, 'mention');
  assert.equal(saved.admiral.mode, 'plain');
  assert.equal(saved.admiral.messages[0].text, '谢谢你成为提督！');
  await panel.getByRole('button', { name: '删除礼物答谢第 2 条' }).click();
  assert.equal(await panel.getByRole('textbox').count(), 1);
  await page.evaluate(() => window.changeAccount({ state: 'unauthorized' }));
  assert.equal(await panel.isVisible(), false);
  assert.doesNotMatch(await panel.textContent(), /谢谢.*的支持/);
  assert.equal(await page.locator('#danmakuGiftThanksSave').isDisabled(), true);
});

test('timer interval and selection modes save together; invalid ranges and failures retain the draft', async (t) => {
  const page = await editorFixture(t, 'send');
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  await page.locator('#danmakuScheduledMode').selectOption('random');
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

test('scheduled library edits across search and pages up to capacity without auto-saving', async (t) => {
  const page = await editorFixture(t, 'send');
  const original = Array.from({ length: 299 }, (_, index) => `文案 ${index + 1}`);
  await page.evaluate(async (messages) => {
    window.remote.scheduledDanmaku.messages = messages;
    await window.fixed.refresh();
  }, original);
  await page.getByRole('button', { name: '设置定时随机弹幕' }).click();
  const list = page.locator('#danmakuScheduledLibraryList');
  await page.locator('#danmakuScheduledLibrarySearch').fill('文案 299');
  assert.equal(await list.locator('input').count(), 1);
  assert.equal(await page.locator('#danmakuScheduledSave').isDisabled(), true);
  await page.getByLabel('定时弹幕第 299 条', { exact: true }).fill('末条已编辑');
  await page.locator('#danmakuScheduledLibrarySearch').fill('');
  await page.locator('#danmakuScheduledLibraryNext').click();
  await page.getByLabel('定时弹幕第 7 条', { exact: true }).fill('第二页已编辑');
  await page.getByRole('button', { name: '删除第 8 条定时弹幕', exact: true }).click();
  await page.locator('#danmakuScheduledLibraryAdd').click();
  await page.getByLabel('定时弹幕第 299 条', { exact: true }).fill('新增文案');
  await page.locator('#danmakuScheduledLibraryAdd').click();
  await page.getByLabel('定时弹幕第 300 条', { exact: true }).fill('最后一个空位');
  assert.equal(await page.locator('#danmakuScheduledLibraryAdd').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  await page.locator('#danmakuScheduledSave').click();
  await page.locator('#danmakuScheduledSaveState').filter({ hasText: '已保存到云端' }).waitFor();
  const expected = [...original];
  expected[6] = '第二页已编辑';
  expected[298] = '末条已编辑';
  expected.splice(7, 1);
  expected.push('新增文案');
  expected.push('最后一个空位');
  assert.deepEqual(await page.evaluate(() => window.writes[0].scheduledDanmaku.messages), expected);
  assert.equal(await page.locator('#danmakuScheduledToggle').isChecked(), false);
});

test('scheduled library validates off-page drafts and clears them when the account changes during save', async (t) => {
  const page = await editorFixture(t, 'send');
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
  assert.equal(await page.locator('#danmakuExactReplyToggle').isChecked(), false);
});

test('switching timer modes preserves saved values for inactive interval fields', async (t) => {
  const page = await editorFixture(t, 'send');
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
