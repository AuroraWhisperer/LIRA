'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiStateStore } = require('../../src/storage/ai-state-store');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { createAiSettingsFixture, flushAiTasks, aiResponse } = require('../helpers/ai-settings-fixture');
const { createTestService, waitUntil } = require('../helpers/ai-assistant-service-fixture');
const { normalizeAiConfig, isAiReady } = require('../../src/ai/config');

test('opening just the AI tab starts account polling and leaving it stops polling', async () => {
  const f = await createAiSettingsFixture({ aiTabHidden: true,
    config: { modelProvider: 'openai', modelAuthMode: 'subscription' } });
  const reads = () => f.calls.filter(call => call.url === '/api/ai/chatgpt/status').length;
  await f.advance(3000);
  assert.equal(reads(), 0);
  await f.setVisibility({ aiTabHidden: false });
  for (let i = 0; i < 3; i++) await f.advance(3000);
  assert.equal(reads(), 4);
  await f.setVisibility({ aiTabHidden: true });
  await f.advance(3000);
  assert.equal(reads(), 4);
});

test('the open subscription model picker survives same-account refresh and closes on account change', async () => {
  const status = { available: true, ready: true, activeId: 'first' };
  const f = await createAiSettingsFixture({ config: { modelProvider: 'openai', modelAuthMode: 'subscription' },
    request: url => url === '/api/ai/status' ? aiResponse({ chatgpt: { ...status } })
      : url === '/api/ai/chatgpt/status' ? aiResponse({ ...status }) : undefined });
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  const menu = f.elements.get('xiaomiAiModelMenu');
  assert.equal(menu.children.length, 2);
  await f.advance(3000);
  assert.equal(menu.children.length, 2);
  assert.equal(menu.popoverOpen, true);
  status.activeId = 'second';
  await f.advance(3000);
  assert.equal(menu.children.length, 0);
  assert.equal(menu.popoverOpen, false);
});

for (const source of ['account poll', 'settings refresh', 'settings refresh failure']) {
  test(`a late ${source} cannot replace a selected subscription account or clear its new model list`, async () => {
    const first = { available: true, ready: true, activeId: 'first',
      profiles: ['first', 'second'].map(id => ({ id, label: id, loggedIn: true })) };
    const second = { ...first, activeId: 'second' };
    const pending = Promise.withResolvers();
    const fullRefresh = source !== 'account poll';
    let hold = false;
    const f = await createAiSettingsFixture({ config: { modelProvider: 'openai', modelAuthMode: 'subscription' },
      request(url) {
        if (url === '/api/ai/status') return hold && fullRefresh ? pending.promise : aiResponse({ chatgpt: first });
        if (url === '/api/ai/chatgpt/status') return pending.promise;
        if (url === '/api/ai/chatgpt/select') return aiResponse(second);
        if (url === '/api/ai/models') return aiResponse({ models: ['second-model'] });
      } });
    hold = true;
    f.publicConfig.userCooldownSeconds = 13;
    const read = fullRefresh ? f.api.refresh() : f.advance(3000);
    const profiles = f.elements.get('xiaomiAiChatGptProfiles');
    profiles.value = second.activeId;
    f.fire(profiles.id, 'change', { target: profiles });
    await flushAiTasks();
    await f.fire('xiaomiAiFetchModelsBtn', 'click');
    const saveNotice = f.elements.get('xiaomiAiSaveState').textContent;
    if (source === 'settings refresh failure') pending.reject(new Error('Previous account read failed'));
    else pending.resolve(aiResponse(fullRefresh ? { chatgpt: first } : first));
    await read;
    await flushAiTasks();
    assert.equal(profiles.value, second.activeId);
    const menu = f.elements.get('xiaomiAiModelMenu');
    assert.equal(menu.popoverOpen, true);
    assert.deepEqual(menu.children.map(item => item.textContent), ['second-model']);
    assert.equal(f.elements.get('xiaomiAiSaveState').textContent, saveNotice);
    if (source === 'settings refresh') assert.equal(f.elements.get('xiaomiAiUserCooldown').value, '13');
  });
}

for (const [order, activeId] of [['full first', 'B'], ['poll first', 'B'], ['poll first', 'A']]) {
  test(`a later account poll wins over a full refresh (${order}, account ${activeId})`, async () => {
    const initial = { available: true, ready: true, activeId: 'A', pending: false,
      profiles: ['A', 'B'].map(id => ({ id, label: id, loggedIn: true })) };
    const fullStatus = Promise.withResolvers();
    const pollStatus = Promise.withResolvers();
    let holdFull = false;
    const f = await createAiSettingsFixture({ config: { modelProvider: 'openai', modelAuthMode: 'subscription' },
      request(url) {
        if (url === '/api/ai/status') return holdFull ? fullStatus.promise : aiResponse({ chatgpt: initial });
        if (url === '/api/ai/chatgpt/status') return pollStatus.promise;
      } });
    await f.fire('xiaomiAiFetchModelsBtn', 'click');
    holdFull = true;
    f.publicConfig.userCooldownSeconds = 13;
    const full = f.api.refresh();
    await f.advance(3000);
    assert.equal(f.calls.filter(call => call.url === '/api/ai/chatgpt/status').length, 1);
    const completePoll = () => pollStatus.resolve(aiResponse({ ...initial, activeId, pending: activeId === 'A' }));
    if (order === 'poll first') { completePoll(); await flushAiTasks(); }
    fullStatus.resolve(aiResponse({ chatgpt: initial }));
    await full;
    if (order === 'full first') { completePoll(); await flushAiTasks(); }
    assert.equal(f.elements.get('xiaomiAiChatGptProfiles').value, activeId);
    assert.equal(f.elements.get('xiaomiAiChatGptCancel').hidden, activeId !== 'A');
    assert.equal(f.elements.get('xiaomiAiModelMenu').popoverOpen, activeId === 'A');
    assert.equal(f.elements.get('xiaomiAiUserCooldown').value, '13');
  });
}

test('a late account selection acknowledgement cannot undo a later selection', async () => {
  const first = Promise.withResolvers();
  const status = activeId => ({ available: true, ready: true, activeId,
    profiles: ['A', 'B', 'C'].map(id => ({ id, label: id, loggedIn: true })) });
  const f = await createAiSettingsFixture({ config: { modelProvider: 'openai', modelAuthMode: 'subscription' },
    request(url, options) {
      if (url === '/api/ai/status') return aiResponse({ chatgpt: status('A') });
      if (url === '/api/ai/chatgpt/select') return JSON.parse(options.body).profileId === 'B' ? first.promise : aiResponse(status('C'));
    } });
  const profiles = f.elements.get('xiaomiAiChatGptProfiles');
  for (const id of ['B', 'C']) {
    profiles.value = id;
    f.fire(profiles.id, 'change', { target: profiles });
    await flushAiTasks();
  }
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  first.resolve(aiResponse(status('B')));
  await flushAiTasks();
  assert.equal(profiles.value, 'C');
  assert.equal(f.elements.get('xiaomiAiModelMenu').popoverOpen, true);
});

test('a failed later poll still allows a full refresh to supply the account status', async () => {
  const full = Promise.withResolvers();
  const status = { available: true, ready: true, activeId: 'A' };
  let hold = false;
  const f = await createAiSettingsFixture({ config: { modelProvider: 'openai', modelAuthMode: 'subscription' },
    request(url) {
      if (url === '/api/ai/status') return hold ? full.promise : aiResponse({ chatgpt: status });
      if (url === '/api/ai/chatgpt/status') throw new Error('synthetic poll failure');
    } });
  hold = true;
  const read = f.api.refresh();
  await f.advance(3000);
  full.resolve(aiResponse({ chatgpt: { ...status, pending: true } }));
  await read;
  assert.equal(f.elements.get('xiaomiAiChatGptCancel').hidden, false);
});

test('saving cooldown with DeepSeek thinking off preserves the saved auto effort', async () => {
  const f = await createAiSettingsFixture({ config: {
    modelProvider: 'deepseek', reasoningEnabled: false, reasoningEffort: 'auto',
    modelEndpoint: { reasoningMode: 'deepseek_effort', reasoningEfforts: ['high', 'max'], defaultReasoningEffort: 'high' },
  } });
  assert.equal(f.elements.get('xiaomiAiReasoningEffort').disabled, true);
  assert.equal(f.elements.get('xiaomiAiReasoningEffort').value, 'high');
  f.input('xiaomiAiUserCooldown', '13');
  await f.advance(700);
  assert.equal(f.saves()[0].userCooldownSeconds, 13);
  assert.equal(f.saves()[0].reasoningEffort, undefined);
});

test('a queued effort edit survives turning thinking off before the save starts', async () => {
  const first = Promise.withResolvers();
  let writes = 0;
  const f = await createAiSettingsFixture({ config: {
    modelProvider: 'deepseek', reasoningEnabled: true, reasoningEffort: 'high',
    modelEndpoint: { reasoningMode: 'deepseek_effort', reasoningEfforts: ['high', 'max'], defaultReasoningEffort: 'high' },
  }, request(url, options) {
    if (url === '/api/ai/config' && options.method === 'PUT') {
      const apply = () => aiResponse(Object.assign(f.publicConfig, JSON.parse(options.body)));
      return ++writes === 1 ? first.promise.then(apply) : apply();
    }
  } });
  f.input('xiaomiAiUserCooldown', '13');
  await f.advance(700);
  const effort = f.elements.get('xiaomiAiReasoningEffort');
  effort.value = 'max';
  f.fire('xiaomiAiForm', 'change', { target: effort });
  const toggle = f.elements.get('xiaomiAiReasoning');
  toggle.checked = false;
  f.fire('xiaomiAiForm', 'change', { target: toggle });
  assert.equal(writes, 1);
  first.resolve();
  await flushAiTasks();
  assert.equal(writes, 2);
  await f.api.refresh();
  assert.equal(toggle.checked, false);
  assert.equal(effort.disabled, true);
  assert.equal(effort.value, 'max');
});

test('saving only cooldown while thinking is on preserves auto and delivers the in-flight reply', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  const store = createAiConfigStore(createAiStateStore(db), { isAvailable: () => true, encrypt: s => s, decrypt: s => s });
  store.updateConfig({ enabled: true, trigger: '小米', modelProvider: 'deepseek', model: 'deepseek-flash',
    deepseekApiKey: 'fixture-key', reasoningEnabled: true, reasoningEffort: 'auto' });
  const generation = Promise.withResolvers();
  const sent = [];
  let signal;
  const service = createTestService({ store, modelClient: { async createResponse(request) {
    if (request.purpose === 'generation') { signal = request.signal; await generation.promise; }
    return { text: request.purpose === 'generation' ? '正常回答' : '{"allowed":true}', functionCalls: [], usage: {} };
  } }, sendReply: async reply => sent.push(reply.message) });
  t.after(async () => { generation.resolve(); await service.shutdown(); db.close(); });
  const f = await createAiSettingsFixture({ config: store.getPublicConfig(), request(url, options) {
    if (url === '/api/ai/config' && options.method === 'PUT') return aiResponse(service.updateConfig(JSON.parse(options.body)));
  } });
  service.handleDanmaku({ uid: 'one', userName: '观众', message: '小米 你好' });
  await waitUntil(() => signal);
  assert.equal(f.elements.get('xiaomiAiReasoningEffort').value, 'high');
  f.input('xiaomiAiUserCooldown', '13');
  await f.advance(700);
  assert.equal(store.getConfig().userCooldownSeconds, 13);
  assert.equal(store.getConfig().reasoningEffort, 'auto');
  assert.equal(signal.aborted, false);
  generation.resolve();
  await waitUntil(() => sent.length === 1);
});

test('saving an official model alias immediately displays the accepted ID and effort controls', async () => {
  const config = { modelProvider: 'deepseek', model: 'deepseek-flash', reasoningEnabled: true,
    modelEndpoint: { reasoningMode: 'deepseek_effort', reasoningEfforts: ['high', 'max'], defaultReasoningEffort: 'high' } };
  const f = await createAiSettingsFixture({ config, request: (url, options) => {
    if (url === '/api/ai/config' && options.method === 'PUT') {
      const model = normalizeAiConfig({ modelProvider: 'deepseek', model: JSON.parse(options.body).model }).model;
      return aiResponse({ ...f.publicConfig, model });
    }
  } });
  f.input('xiaomiAiModel', 'ds-v4-flash');
  await f.advance(700);
  assert.equal(f.elements.get('xiaomiAiModel').value, 'deepseek-flash');
  assert.equal(f.elements.get('xiaomiAiReasoningEffortControl').hidden, false);
});

test('an API profile with a saved key needs a model ID to show ready', async () => {
  for (const model of ['', 'demo']) {
    const f = await createAiSettingsFixture({ config: { enabled: true, model } });
    const ready = isAiReady({ ...f.publicConfig, deepseekApiKey: 'test' });
    assert.equal(f.elements.get('xiaomiAiConfigState').textContent, ready ? '可运行' : '等待配置');
  }
});

test('subscription keeps API secrets separate and uses account status, model lookup and login actions', async () => {
  const status = { available: true, pending: false, ready: true, loggedIn: true, activeId: 'account-1', profiles: [{ id: 'account-1', label: '测试账号 · 1', loggedIn: true }] };
  const f = await createAiSettingsFixture({ config: { modelProvider: 'openai', modelAuthMode: 'subscription' }, request: (url) => {
    if (url === '/api/ai/status') return aiResponse({ queued: 0, chatgpt: status });
    if (url.startsWith('/api/ai/chatgpt/')) return aiResponse({ ...status, pending: url.endsWith('/login') });
  } });
  f.elements.get('xiaomiAiDeepSeekKey').value = 'private-api-draft';
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  const lookup = JSON.parse(f.calls.find(call => call.url === '/api/ai/models').options.body);
  assert.equal(lookup.modelAuthMode, 'subscription');
  assert.equal(lookup.apiKey, '');
  f.input('xiaomiAiTrigger', '助手');
  await f.advance(700);
  assert.equal(f.saves()[0].deepseekApiKey, undefined);
  assert.equal(f.elements.get('xiaomiAiDeepSeekKey').value, 'private-api-draft');
  await f.fire('xiaomiAiChatGptLogin', 'click');
  f.elements.get('xiaomiAiForm').checkValidity = () => false;
  await f.fire('xiaomiAiChatGptCancel', 'click');
  assert.ok(f.calls.some(call => call.url === '/api/ai/chatgpt/cancel'));
});

test('Doubao omits API inputs from saves and preserves their drafts', async () => {
  const status = { available: true, loggedIn: true, needsVerification: true, encryptionAvailable: true };
  const f = await createAiSettingsFixture({ config: { modelProvider: 'doubao' },
    request: url => url === '/api/ai/status' ? aiResponse({ queued: 0, doubao: status }) : undefined });
  f.elements.get('xiaomiAiDeepSeekKey').value = 'unsaved-api-key';
  f.input('xiaomiAiTrigger', '豆豆');
  await f.advance(700);
  assert.equal(f.saves()[0].deepseekApiKey, undefined);
  assert.equal(f.saves()[0].deepseekResponsesUrl, undefined);
  assert.equal(f.saves()[0].model, undefined);
  assert.equal(f.elements.get('xiaomiAiDeepSeekKey').value, 'unsaved-api-key');
});

test('Doubao login and logout use existing authenticated API without sending credentials', async () => {
  const f = await createAiSettingsFixture({ config: { modelProvider: 'doubao' }, request: url =>
    url.startsWith('/api/ai/doubao/') ? aiResponse({ available: true, loggedIn: !url.endsWith('/logout'), needsVerification: false, encryptionAvailable: true }) : undefined });
  await f.fire('xiaomiAiDoubaoLogin', 'click');
  await f.fire('xiaomiAiDoubaoLogout', 'click');
  const writes = f.calls.filter(call => call.url.startsWith('/api/ai/doubao/') && call.options.method === 'POST');
  assert.deepEqual(writes.map(call => call.url), ['/api/ai/doubao/login', '/api/ai/doubao/logout']);
  assert.ok(writes.every(call => call.options.body === undefined));
});

test('account status polling follows panel, main page and document visibility and stops on pagehide', async () => {
  const status = { available: true, pending: true, profiles: [] };
  const f = await createAiSettingsFixture({ visible: false,
    config: { modelProvider: 'openai', modelAuthMode: 'subscription' },
    request: (url) => url.endsWith('/status') ? aiResponse({ ...status, chatgpt: status }) : undefined,
  });
  const statusReads = () => f.calls.filter(({ url }) => /\/api\/ai\/(chatgpt|doubao)\/status$/.test(url)).length;
  await f.advance(3000);
  assert.equal(statusReads(), 0, 'initially hidden settings do not poll');
  await f.setVisibility({ panelHidden: false });
  assert.equal(statusReads(), 1, 'opening the panel immediately checks pending authorization');
  await f.advance(3000);
  assert.equal(statusReads(), 2);
  await f.setVisibility({ pageActive: false });
  await f.advance(3000);
  assert.equal(statusReads(), 2, 'another main page suspends account polling');
  await f.setVisibility({ pageActive: true });
  assert.equal(statusReads(), 3);
  await f.setVisibility({ documentHidden: true });
  await f.advance(3000);
  assert.equal(statusReads(), 3, 'a hidden window suspends account polling');
  await f.setVisibility({ documentHidden: false });
  assert.equal(statusReads(), 4);

  const provider = f.elements.get('xiaomiAiModelProvider');
  provider.value = 'doubao';
  f.fire(provider.id, 'change');
  f.publicConfig.modelProvider = 'doubao';
  await flushAiTasks();
  assert.equal(statusReads(), 5, 'changing the selected provider still reads its account');
  await f.setVisibility({ panelHidden: true });
  await f.advance(3000);
  assert.equal(statusReads(), 5, 'a hidden panel also suspends Doubao reads');
  const shown = f.setVisibility({ panelHidden: false });
  await Promise.all([shown, f.api.refresh()]);
  assert.equal(statusReads(), 5, 'navigation already reads account status in the full refresh');
  await f.advance(3000);
  assert.equal(statusReads(), 6);
  f.pagehide();
  await f.setVisibility({ panelHidden: true, documentHidden: true });
  await f.setVisibility({ panelHidden: false, documentHidden: false });
  await f.advance(3000);
  assert.equal(statusReads(), 6, 'late visibility notifications cannot restart a closed page');
  assert.equal(f.timers.size, 0);
});

test('an account read spanning hide and restore remains single flight and cannot restart a closed page', async () => {
  const pending = Promise.withResolvers();
  const f = await createAiSettingsFixture({ config: { modelProvider: 'doubao' }, request: (url) =>
    url === '/api/ai/doubao/status' ? pending.promise : undefined });
  const statusReads = () => f.calls.filter(({ url }) => url === '/api/ai/doubao/status').length;
  await f.advance(3000);
  await f.setVisibility({ documentHidden: true });
  await f.setVisibility({ documentHidden: false });
  await f.advance(3000);
  assert.equal(statusReads(), 1, 'restoring a pending read must not start a second request');
  await f.setVisibility({ documentHidden: true });
  f.pagehide();
  pending.resolve(aiResponse({ available: true, loggedIn: true, encryptionAvailable: true }));
  await flushAiTasks();
  await f.setVisibility({ documentHidden: false });
  await f.advance(3000);
  assert.equal(statusReads(), 1);
  assert.equal(f.timers.size, 0);
});

test('official reasoning levels select the official default and save the actual selected level', async () => {
  const f = await createAiSettingsFixture({ config: {
    modelProvider: 'deepseek', model: 'deepseek-flash', reasoningEnabled: true, reasoningEffort: 'auto',
    modelEndpoint: { reasoningMode: 'deepseek_effort', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' },
  } });
  const input = f.elements.get('xiaomiAiReasoningEffort');
  assert.deepEqual(input.children.map(option => option.value), ['low', 'high', 'max']);
  assert.equal(input.value, 'high');
  f.input('xiaomiAiTrigger', '助手');
  await f.advance(700);
  assert.equal(f.saves().at(-1).reasoningEffort, undefined, 'displaying the default does not edit the preference');
  input.value = 'low';
  f.fire('xiaomiAiForm', 'change', { target: input });
  await flushAiTasks();
  assert.equal(f.saves().at(-1).reasoningEffort, 'low');
});

test('always-thinking custom models expose the effective tier and save a newly selected tier as enabled', async () => {
  const f = await createAiSettingsFixture({ config: {
    model: 'gpt-6.1-sol', reasoningEnabled: false, reasoningEffort: 'high',
    modelEndpoint: { protocol: 'chat_completions', provider: 'custom', reasoningMode: 'effort',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'medium',
      reasoningState: { mode: 'enabled', effort: 'low', canDisable: false } },
  } });
  const toggle = f.elements.get('xiaomiAiReasoning');
  const effort = f.elements.get('xiaomiAiReasoningEffort');
  assert.equal(toggle.checked, true);
  assert.equal(toggle.disabled, true);
  assert.equal(effort.disabled, false);
  assert.equal(effort.value, 'low');
  assert.match(f.elements.get('xiaomiAiProviderManagedReasoning').textContent, /low/);
  effort.value = 'max';
  f.fire('xiaomiAiForm', 'change', { target: effort });
  await flushAiTasks();
  assert.equal(f.saves().at(-1).reasoningEnabled, true);
  assert.equal(f.saves().at(-1).reasoningEffort, 'max');
});

test('custom models supporting none expose an off switch and enable a non-none tier when switched on', async () => {
  const f = await createAiSettingsFixture({ config: {
    model: 'gpt-6-sol', reasoningEnabled: false, reasoningEffort: 'none',
    modelEndpoint: { protocol: 'chat_completions', provider: 'custom', reasoningMode: 'effort',
      reasoningEfforts: ['none', 'low', 'medium', 'high'], defaultReasoningEffort: 'none',
      reasoningState: { mode: 'disabled', effort: 'none', canDisable: true } },
  } });
  const toggle = f.elements.get('xiaomiAiReasoning');
  const effort = f.elements.get('xiaomiAiReasoningEffort');
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.checked, false);
  assert.equal(effort.disabled, true);
  toggle.checked = true;
  f.fire('xiaomiAiForm', 'change', { target: toggle });
  await flushAiTasks();
  assert.equal(f.saves().at(-1).reasoningEnabled, true);
  assert.equal(f.saves().at(-1).reasoningEffort, 'low');
});

test('refreshing the catalog updates the saved off mode when the relay adds none support', async () => {
  const f = await createAiSettingsFixture({ config: {
    model: 'gpt-6.1-sol', reasoningEnabled: false, reasoningEffort: 'high',
    modelEndpoint: { protocol: 'chat_completions', provider: 'custom', reasoningMode: 'effort',
      reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high',
      reasoningState: { mode: 'enabled', effort: 'low', canDisable: false } },
  }, request: url => {
    if (url !== '/api/ai/models') return;
    f.publicConfig.modelEndpoint = { ...f.publicConfig.modelEndpoint,
      reasoningEfforts: ['none', 'high'], reasoningState: { mode: 'disabled', effort: 'none', canDisable: true } };
    return aiResponse({ models: ['gpt-6.1-sol'],
      modelReasoning: { 'gpt-6.1-sol': { efforts: ['none', 'high'], defaultEffort: 'high' } } });
  } });
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  assert.equal(f.elements.get('xiaomiAiReasoning').checked, false);
  assert.equal(f.elements.get('xiaomiAiReasoning').disabled, false);
  assert.equal(f.elements.get('xiaomiAiReasoningEffort').disabled, true);
});

test('model selection uses its upstream reasoning catalog and unknown models expose no invented levels', async () => {
  let secondProfile = { efforts: ['low', 'medium'], defaultEffort: 'medium' };
  const f = await createAiSettingsFixture({ config: { reasoningEnabled: true, reasoningEffort: 'auto' },
    request: url => url === '/api/ai/models' ? aiResponse({
      models: ['first', 'second', 'unknown'],
      modelReasoning: {
        first: { efforts: ['low', 'high', 'max'], defaultEffort: 'high' },
        second: secondProfile,
      },
    }) : undefined,
  });
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  const menu = f.elements.get('xiaomiAiModelMenu');
  const input = f.elements.get('xiaomiAiReasoningEffort');
  menu.children[0].listeners.click();
  assert.equal(input.value, 'high');
  menu.children[1].listeners.click();
  assert.deepEqual(input.children.map(option => option.value), ['low', 'medium']);
  assert.equal(input.value, 'medium');
  await f.advance(700);
  secondProfile = { efforts: ['high', 'max'], defaultEffort: 'max' };
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  assert.deepEqual(input.children.map(option => option.value), ['high', 'max']);
  assert.equal(input.value, 'max');
  f.input('xiaomiAiTrigger', '助手');
  await f.advance(700);
  assert.equal(f.saves().at(-1).reasoningEffort, undefined, 'refreshing the catalog does not edit the preference');
  menu.children[2].listeners.click();
  assert.equal(f.elements.get('xiaomiAiReasoningEffortControl').hidden, true);
  assert.equal(input.children.length, 0);
});

test('catalog levels without a confirmed default require a selection before saving an effort', async () => {
  const f = await createAiSettingsFixture({ config: { model: 'current', reasoningEnabled: true, reasoningEffort: 'high',
    modelEndpoint: { reasoningMode: 'effort', reasoningEfforts: ['high'], defaultReasoningEffort: 'high' } },
    request: url => url === '/api/ai/models' ? aiResponse({ models: ['current'],
      modelReasoning: { current: { efforts: ['low', 'max'] } } }) : undefined,
  });
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  const input = f.elements.get('xiaomiAiReasoningEffort');
  f.input('xiaomiAiTrigger', '助手');
  await f.advance(700);
  assert.equal(f.saves().at(-1).reasoningEffort, undefined);
  input.value = 'max';
  await f.fire('xiaomiAiForm', 'change', { target: input });
  await flushAiTasks();
  assert.equal(f.saves().at(-1).reasoningEffort, 'max');
});

test('editing credentials discards the old account reasoning capabilities before saving', async () => {
  const f = await createAiSettingsFixture({ config: { model: 'current', reasoningEnabled: true, reasoningEffort: 'auto',
    modelEndpoint: { reasoningMode: 'effort', reasoningEfforts: ['high'], defaultReasoningEffort: 'high' } },
  });
  f.input('xiaomiAiDeepSeekKey', 'new-account-key');
  await f.advance(700);
  assert.equal(f.saves().at(-1).reasoningEffort, undefined);
});

test('editing a custom endpoint drops the previous service reasoning capabilities before saving', async () => {
  const f = await createAiSettingsFixture({ config: {
    modelProvider: 'auto', model: 'deepseek-flash', reasoningEnabled: true, reasoningEffort: 'auto',
    deepseekResponsesUrl: 'https://api.deepseek.com', modelApiProtocol: 'auto',
    modelEndpoint: { reasoningMode: 'deepseek_effort', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' },
  } });
  f.input('xiaomiAiDeepSeekUrl', 'https://other.example/responses');
  assert.equal(f.elements.get('xiaomiAiReasoningEffortControl').hidden, true);
  await f.advance(700);
  assert.equal(f.saves().at(-1).reasoningEffort, undefined);
});

test('model lookup results and callbacks belong to the current provider request', async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  let requests = 0;
  const f = await createAiSettingsFixture({ request: (url) => url === '/api/ai/models'
    ? (++requests === 1 ? first.promise : second.promise) : undefined });
  const button = f.elements.get('xiaomiAiFetchModelsBtn');
  const menu = f.elements.get('xiaomiAiModelMenu');
  const oldLookup = f.fire(button.id, 'click');
  const provider = f.elements.get('xiaomiAiModelProvider');
  provider.value = 'openai';
  f.fire(provider.id, 'change');
  const newLookup = f.fire(button.id, 'click');
  first.resolve(aiResponse({ models: ['old-model'] }));
  await oldLookup;
  assert.equal(button.disabled, true, 'old finally cannot finish the new lookup');
  assert.equal(menu.children.length, 0);
  second.resolve(aiResponse({ models: ['current-model'] }));
  await newLookup;
  assert.equal(menu.children[0].textContent, 'current-model');
  const option = menu.children[0];
  option.listeners.click();
  await f.advance(700);
  assert.equal(f.saves().at(-1).model, 'current-model');
  f.input('xiaomiAiDeepSeekUrl', 'https://other.example.com/v1');
  assert.equal(menu.children.length, 0);
  assert.equal(menu.hidden, true);
  f.elements.get('xiaomiAiModel').value = 'manual-model';
  option.listeners.click();
  assert.equal(f.elements.get('xiaomiAiModel').value, 'manual-model');
});

test('a failed model lookup cannot replace the current service status', async () => {
  const lookup = Promise.withResolvers();
  const f = await createAiSettingsFixture({ request: url => url === '/api/ai/models' ? lookup.promise : undefined });
  const loading = f.fire('xiaomiAiFetchModelsBtn', 'click');
  f.input('xiaomiAiDeepSeekKey', 'new-key');
  lookup.reject(new Error('old provider failure'));
  await loading;
  assert.doesNotMatch(f.elements.get('xiaomiAiModelFetchState').textContent, /old provider/);
  assert.equal(f.elements.get('xiaomiAiFetchModelsBtn').disabled, false);
});

test('committing the same credential preserves an in-flight model lookup', async () => {
  const lookup = Promise.withResolvers();
  const f = await createAiSettingsFixture({ request: url => url === '/api/ai/models' ? lookup.promise : undefined });
  f.input('xiaomiAiDeepSeekKey', 'new-synthetic-key');
  const loading = f.fire('xiaomiAiFetchModelsBtn', 'click');
  await f.advance(700);
  assert.equal(f.elements.get('xiaomiAiDeepSeekKey').value, '', 'committed plaintext is still cleared');
  lookup.resolve(aiResponse({ models: ['first', 'second'] }));
  await loading;
  f.elements.get('xiaomiAiModelMenu').children[1].listeners.click();
  assert.equal(f.elements.get('xiaomiAiModel').value, 'second');
});

test('AI model listing uses draft credentials and saves a selected model after reopening the menu', async () => {
  const models = ['deepseek-flash', 'deepseek-v4-pro'];
  const modelNames = { 'deepseek-flash': 'DeepSeek-V4.1-Flash', 'deepseek-v4-pro': 'DeepSeek-V4-Pro' };
  const f = await createAiSettingsFixture({ request: url => url === '/api/ai/models'
    ? aiResponse({ models, modelNames }) : undefined });
  f.input('xiaomiAiDeepSeekKey', 'deepseek-secret');
  f.input('xiaomiAiDeepSeekUrl', 'https://api.deepseek.com/responses');
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  const modelRequest = JSON.parse(f.calls.find((call) => call.url === '/api/ai/models').options.body);
  assert.equal(modelRequest.apiKey, 'deepseek-secret');
  assert.equal(modelRequest.apiUrl, 'https://api.deepseek.com/responses');
  const menu = f.elements.get('xiaomiAiModelMenu');
  assert.equal(menu.matches(':popover-open'), true);
  assert.equal(menu.children[0].textContent, modelNames[models[0]]);
  assert.equal(menu.children[1].textContent, modelNames[models[1]]);
  menu.children[1].listeners.click();
  assert.equal(menu.matches(':popover-open'), false);
  assert.equal(f.elements.get('xiaomiAiModel').value, 'deepseek-v4-pro');
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  menu.children[1].listeners.click();
  await f.advance(700);
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].model, 'deepseek-v4-pro');
});

test('AI connection test waits for the current settings to save', async () => {
  const f = await createAiSettingsFixture();
  f.input('xiaomiAiDeepSeekUrl', 'https://api.deepseek.com');
  f.fire('xiaomiAiTestBtn', 'click');
  await flushAiTasks();
  const saveIndex = f.calls.findIndex((call) => call.options.method === 'PUT');
  const testIndex = f.calls.findIndex((call) => call.url === '/api/ai/test/deepseek');
  assert.ok(saveIndex >= 0 && testIndex > saveIndex);
  assert.equal(f.saves()[0].deepseekResponsesUrl, 'https://api.deepseek.com');
  assert.equal(f.elements.get('xiaomiAiDeepSeekUrl').value, 'https://api.deepseek.com');
});

test('AI switching from an official provider restores the saved custom endpoint before editing', async () => {
  const f = await createAiSettingsFixture({
    config: {
      modelProvider: 'openai',
      deepseekResponsesUrl: 'https://api.openai.com/v1',
      modelEndpoint: {
        protocol: 'responses',
        provider: 'openai',
        webSearchMode: 'hosted',
        reasoningMode: 'effort',
      },
    },
  });
  const provider = f.elements.get('xiaomiAiModelProvider');
  provider.value = 'custom';
  f.fire('xiaomiAiModelProvider', 'change');
  assert.equal(f.elements.get('xiaomiAiDeepSeekUrl').disabled, true);
  Object.assign(f.publicConfig, {
    modelProvider: 'custom',
    deepseekResponsesUrl: 'https://saved-custom.example/v1',
    modelApiProtocol: 'chat_completions',
    modelEndpoint: {
      protocol: 'chat_completions',
      provider: 'custom',
      webSearchMode: 'local_function',
      reasoningMode: 'provider_managed',
    },
  });
  f.fire('xiaomiAiForm', 'change', { target: provider });
  await flushAiTasks();
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].modelProvider, 'custom');
  assert.equal(f.saves()[0].deepseekResponsesUrl, undefined);
  assert.equal(f.saves()[0].modelApiProtocol, undefined);
  assert.equal(f.elements.get('xiaomiAiDeepSeekUrl').value, 'https://saved-custom.example/v1');
  assert.equal(f.elements.get('xiaomiAiModelApiProtocol').value, 'chat_completions');
  assert.equal(f.elements.get('xiaomiAiDeepSeekUrl').disabled, false);
});

for (const outcome of ['successful', 'failed']) {
  test(`AI ${outcome} older save cannot overwrite a newer provider switch`, async (t) => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    db.exec(SONG_SCHEMA);
    const store = createAiConfigStore(createAiStateStore(db), { isAvailable: () => true });
    const customUrl = 'https://saved-custom.example/v1';
    store.updateConfig({
      enabled: false,
      trigger: 'test',
      model: 'test-model',
      modelProvider: 'custom',
      deepseekResponsesUrl: customUrl,
      modelApiProtocol: 'chat_completions',
    });
    const initialConfig = store.updateConfig({ modelProvider: 'openai' });
    let resolveFirst;
    let rejectFirst;
    let firstConfig;
    let saveCount = 0;
    const firstSave = new Promise((resolve, reject) => {
      resolveFirst = resolve;
      rejectFirst = reject;
    });
    const f = await createAiSettingsFixture({
      config: initialConfig,
      request: (url, options) => {
        if (url !== '/api/ai/config' || options.method !== 'PUT') return undefined;
        const config = store.updateConfig(JSON.parse(options.body));
        if (++saveCount !== 1) return aiResponse(config);
        firstConfig = config;
        return firstSave;
      },
    });

    f.input('xiaomiAiModel', 'edited-model');
    await f.advance(700);
    const provider = f.elements.get('xiaomiAiModelProvider');
    provider.value = 'custom';
    f.fire('xiaomiAiModelProvider', 'change');
    f.fire('xiaomiAiForm', 'change', { target: provider });
    if (outcome === 'successful') resolveFirst(aiResponse(firstConfig));
    else rejectFirst(new Error('Older save response failed'));
    await flushAiTasks();

    assert.equal(f.saves().length, 2);
    assert.equal(f.saves()[1].deepseekResponsesUrl, undefined);
    assert.equal(f.saves()[1].modelApiProtocol, undefined);
    assert.equal(f.elements.get('xiaomiAiDeepSeekUrl').value, customUrl);
    assert.equal(f.elements.get('xiaomiAiModelApiProtocol').value, 'chat_completions');

    f.input('xiaomiAiTrigger', 'edited');
    await f.advance(700);
    assert.equal(f.saves().length, 3);
    assert.equal(store.getPublicConfig().deepseekResponsesUrl, customUrl);
    assert.equal(store.getPublicConfig().modelApiProtocol, 'chat_completions');
    assert.equal(store.getPublicConfig().trigger, 'edited');
  });
}

test('AI custom endpoint can be cleared and saved', async () => {
  const f = await createAiSettingsFixture();
  f.input('xiaomiAiDeepSeekUrl', '');
  await f.advance(700);
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].deepseekResponsesUrl, '');
});

test('AI assistant shows saved key previews only as placeholders', async () => {
  const { elements } = await createAiSettingsFixture({
    config: { hasQWeatherApiKey: true, deepseekApiKeyPreview: 'sk-syn********', qweatherApiKeyPreview: 'qw-syn********' },
  });
  for (const provider of ['DeepSeek', 'QWeather', 'Amap']) {
    assert.equal(elements.get(`xiaomiAi${provider}Key`).type, 'password');
    assert.equal(elements.get(`xiaomiAi${provider}Key`).value, '');
  }
  assert.equal(elements.get('xiaomiAiDeepSeekKey').placeholder, 'sk-syn********');
});

for (const value of ['', '********']) {
  test(`AI assistant omits ${value ? 'legacy mask' : 'empty'} secrets from model requests and configuration saves`, async () => {
    const f = await createAiSettingsFixture({
      config: { hasQWeatherApiKey: true, deepseekApiKeyPreview: 'sk-syn********' },
    });
    for (const provider of ['DeepSeek', 'QWeather', 'Amap']) {
      f.elements.get(`xiaomiAi${provider}Key`).value = value;
    }
    await f.fire('xiaomiAiFetchModelsBtn', 'click');
    const modelRequest = f.calls.find((call) => call.url === '/api/ai/models');
    assert.equal(JSON.parse(modelRequest.options.body).apiKey, '');
    f.input('xiaomiAiTrigger', '猫猫');
    await f.advance(700);
    assert.equal(f.saves().length, 1);
    const saved = f.saves()[0];
    assert.equal(saved.trigger, '猫猫');
    assert.equal(saved.deepseekApiKey, undefined);
    assert.equal(saved.qweatherApiKey, undefined);
    assert.equal(saved.amapApiKey, undefined);
  });
}

test('AI assistant submits a newly entered key without changing other saved secrets', async () => {
  const f = await createAiSettingsFixture({
    config: { hasQWeatherApiKey: true },
  });
  f.input('xiaomiAiDeepSeekKey', 'new-deepseek-key');
  await f.advance(700);
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].deepseekApiKey, 'new-deepseek-key');
  assert.equal(f.saves()[0].qweatherApiKey, undefined);
  assert.equal(f.elements.get('xiaomiAiDeepSeekKey').value, '');
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  assert.equal(JSON.parse(f.calls.find(call => call.url === '/api/ai/models').options.body).apiKey, '');
});

test('an older save cannot clear a newer key draft', async () => {
  let completeFirstSave;
  let saveCount = 0;
  const f = await createAiSettingsFixture({
    request: (_url, options) => options.method === 'PUT' && ++saveCount === 1
      ? new Promise(resolve => { completeFirstSave = resolve; }) : undefined,
  });
  f.input('xiaomiAiDeepSeekKey', 'first-synthetic-key');
  await f.advance(700);
  f.input('xiaomiAiDeepSeekKey', 'newer-synthetic-key');
  await f.advance(700);
  await f.api.refresh();
  assert.equal(f.elements.get('xiaomiAiDeepSeekKey').value, 'newer-synthetic-key');
  completeFirstSave(aiResponse(f.publicConfig));
  await flushAiTasks();
  assert.deepEqual(f.saves().map(saved => saved.deepseekApiKey), ['first-synthetic-key', 'newer-synthetic-key']);
  assert.equal(f.elements.get('xiaomiAiDeepSeekKey').value, '');
});
