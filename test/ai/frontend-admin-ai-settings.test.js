'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiStateStore } = require('../../src/storage/ai-state-store');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { createAiSettingsFixture, flushAiTasks, aiResponse } = require('../helpers/ai-settings-fixture');

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

test('AI initial load preserves edits and blocks saving before configuration arrives', async () => {
  const f = await createAiSettingsFixture({
    deferInitialConfig: true,
    config: { functionCallingEnabled: true, weatherEnabled: true, placesEnabled: true },
  });
  const edits = {
    xiaomiAiDeepSeekUrl: 'https://api.deepseek.com/responses',
    xiaomiAiDeepSeekKey: 'deepseek-secret',
    xiaomiAiQWeatherHost: 'nn7mdbwku9.re.qweatherapi.com',
    xiaomiAiQWeatherKey: 'qweather-secret',
    xiaomiAiAmapHost: 'https://restapi.amap.com',
    xiaomiAiAmapKey: 'amap-secret',
  };
  for (const [id, value] of Object.entries(edits)) f.input(id, value);
  f.fire('xiaomiAiForm', 'submit', { preventDefault() {} });
  await flushAiTasks();
  assert.equal(f.saves().length, 0);

  f.resolveInitialConfig();
  await flushAiTasks();
  for (const [id, value] of Object.entries(edits)) assert.equal(f.elements.get(id).value, value);

  f.fire('xiaomiAiForm', 'submit', { preventDefault() {} });
  await flushAiTasks();
  assert.equal(f.saves().length, 1);
  const saved = f.saves()[0];
  assert.deepEqual(
    [saved.deepseekResponsesUrl, saved.deepseekApiKey, saved.qweatherApiHost, saved.qweatherApiKey, saved.amapApiHost, saved.amapApiKey],
    Object.values(edits),
  );
  for (const [id, value] of Object.entries(edits)) assert.equal(f.elements.get(id).value, id.endsWith('Key') ? '' : value);
});

test('conversation idle minutes preserve an existing 61s setting and autosave edits', async () => {
  const f = await createAiSettingsFixture({ config: { contextTtlSeconds: 61 } });
  f.input('xiaomiAiTrigger', '小猫');
  await f.advance(700);
  assert.equal(f.saves().at(-1).contextTtlSeconds, 61);
  f.input('xiaomiAiContextMinutes', '15');
  await f.advance(700);
  assert.equal(f.saves().at(-1).contextTtlSeconds, 900);
});

for (const [key, id] of [['enabled', 'xiaomiAiEnabled'], ['autoReplyEnabled', 'xiaomiAiAutoReplyEnabled']]) {
  test(`${key} off saves independently of invalid form drafts`, async () => {
    const f = await createAiSettingsFixture({ config: { [key]: true } });
    f.elements.get('xiaomiAiForm').checkValidity = () => false;
    f.input('xiaomiAiModel', 'unfinished draft');
    const input = f.elements.get(id);
    assert.equal(input.checked, true);
    input.checked = false;
    f.fire(id, 'change');
    f.fire('xiaomiAiForm', 'change', { target: input });
    await flushAiTasks();
    assert.deepEqual(f.saves(), [{ [key]: false }]);
    assert.equal(f.elements.get('xiaomiAiModel').value, 'unfinished draft');
  });

  test(`${key} off then on preserves both saves while older form saves cannot restore the switch`, async () => {
    const formSave = Promise.withResolvers();
    const offSave = Promise.withResolvers();
    const f = await createAiSettingsFixture({ config: { [key]: true }, request: (_url, options) => {
      if (options.method !== 'PUT') return;
      const value = JSON.parse(options.body);
      if (value[key] === false) return offSave.promise;
      if (value.model) return formSave.promise;
    } });
    f.input('xiaomiAiModel', 'new-model');
    await f.advance(700);
    f.elements.get(id).checked = false;
    f.fire(id, 'change');
    f.elements.get(id).checked = true;
    f.fire(id, 'change');
    await flushAiTasks();
    assert.equal(f.saves().length, 2);
    assert.equal(Object.hasOwn(f.saves()[0], key), false);
    assert.deepEqual(f.saves()[1], { [key]: false });
    offSave.resolve(aiResponse({ ...f.publicConfig, [key]: false }));
    await flushAiTasks();
    assert.deepEqual(f.saves()[2], { [key]: true });
    formSave.resolve(aiResponse(f.publicConfig));
    await flushAiTasks();
    assert.equal(f.elements.get(id).checked, true);
  });
}

test('selecting the whale persona saves its identity without overwriting the custom prompt', async () => {
  const f = await createAiSettingsFixture({ config: { modelProvider: 'deepseek' } });
  const select = f.elements.get('xiaomiAiPersona');
  assert.ok(select.children.some((option) => option.value === 'whale'));
  select.value = 'whale';
  f.fire('xiaomiAiPersonaManage', 'click');
  f.fire('xiaomiAiForm', 'change', { target: select });
  await flushAiTasks();
  assert.equal(f.saves()[0].personaId, 'whale');
  assert.equal(f.saves()[0].systemPrompt, undefined);
});

test('changing platform restores the whale selection without deleting its edits or saved roles', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SONG_SCHEMA);
  const store = createAiConfigStore(createAiStateStore(db), { isAvailable: () => true });
  const prompt = '你是安静陪聊的鲸鱼娘，认真听观众说话，用简洁自然的语气回应。';
  store.updateConfig({ modelProvider: 'deepseek', personaId: 'whale' });
  store.updatePersona({ id: 'whale', description: '安静陪聊', prompt });
  const saved = store.createPersona({ name: '我的人格', prompt });
  store.updateConfig({ personaId: 'whale' });
  const f = await createAiSettingsFixture({
    config: store.getPublicConfig(),
    request: (url, options) => url === '/api/ai/config' && options.method === 'PUT'
      ? aiResponse(store.updateConfig(JSON.parse(options.body))) : undefined,
  });
  const provider = f.elements.get('xiaomiAiModelProvider');
  const select = f.elements.get('xiaomiAiPersona');
  provider.value = 'openai';
  f.fire(provider.id, 'change');
  assert.equal(select.value, 'general');
  assert.equal(select.children.some((option) => option.value === 'whale'), false);
  f.fire('xiaomiAiForm', 'change', { target: provider });
  await flushAiTasks();
  assert.equal(f.saves().length, 1);
  assert.equal(store.getConfig().personaId, 'general');
  assert.equal(store.getConfig().builtinPersonaOverrides[0].prompt, prompt);
  assert.ok(select.children.some((option) => option.value === saved.personaId));

  select.value = saved.personaId;
  f.fire('xiaomiAiForm', 'change', { target: select });
  await flushAiTasks();
  provider.value = 'deepseek';
  f.fire(provider.id, 'change');
  f.fire('xiaomiAiForm', 'change', { target: provider });
  await flushAiTasks();
  assert.equal(select.value, 'whale');
  assert.ok(select.children.some((option) => option.value === 'whale'));
  f.fire('xiaomiAiPersonaManage', 'click');
  assert.equal(f.elements.get('xiaomiAiPersonaPrompt').value, prompt);

  provider.value = 'openai';
  f.fire(provider.id, 'change');
  f.fire('xiaomiAiForm', 'change', { target: provider });
  await flushAiTasks();
  assert.equal(select.value, saved.personaId);
});

test('the whale persona and saved key survive Doubao and a fresh settings load', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SONG_SCHEMA);
  const codec = { isAvailable: () => true, encrypt: value => `encrypted:${value}`, decrypt: value => value.slice(10) };
  let store = createAiConfigStore(createAiStateStore(db), codec);
  store.updateConfig({ modelProvider: 'deepseek', personaId: 'whale', deepseekApiKey: 'sk-synthetic-test-key' });
  const openSettings = () => createAiSettingsFixture({
    config: store.getPublicConfig(),
    request: (url, options) => url === '/api/ai/config' && options.method === 'PUT'
      ? aiResponse(store.updateConfig(JSON.parse(options.body))) : undefined,
  });
  let f = await openSettings();
  const switchProvider = async (value) => {
    const provider = f.elements.get('xiaomiAiModelProvider');
    provider.value = value;
    f.fire(provider.id, 'change');
    f.fire('xiaomiAiForm', 'change', { target: provider });
    await flushAiTasks();
  };
  await switchProvider('doubao');
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'general');
  store = createAiConfigStore(createAiStateStore(db), codec);
  f = await openSettings();
  await switchProvider('deepseek');
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'whale');
  assert.equal(f.elements.get('xiaomiAiDeepSeekKey').value, '');
  assert.equal(f.saves()[0].deepseekApiKey, undefined);
  assert.equal(store.getConfig().deepseekApiKey, 'sk-synthetic-test-key');
});

test('switching back during a pending provider save preserves the remembered persona', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SONG_SCHEMA);
  const store = createAiConfigStore(createAiStateStore(db), { isAvailable: () => true });
  store.updateConfig({ modelProvider: 'deepseek', personaId: 'cat' });
  let completeFirstSave;
  let saveCount = 0;
  const f = await createAiSettingsFixture({
    config: store.getPublicConfig(),
    request: (url, options) => {
      if (url !== '/api/ai/config' || options.method !== 'PUT') return undefined;
      const result = aiResponse(store.updateConfig(JSON.parse(options.body)));
      return ++saveCount === 1 ? new Promise(resolve => { completeFirstSave = () => resolve(result); }) : result;
    },
  });
  t.after(() => completeFirstSave?.());
  const provider = f.elements.get('xiaomiAiModelProvider');
  for (const value of ['doubao', 'deepseek']) {
    provider.value = value;
    f.fire(provider.id, 'change');
    f.fire('xiaomiAiForm', 'change', { target: provider });
  }
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'cat');
  await f.api.refresh();
  completeFirstSave();
  await flushAiTasks();
  assert.deepEqual(f.saves().map(saved => [saved.modelProvider, saved.personaId]), [['doubao', 'general'], ['deepseek', 'cat']]);
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'cat');
  assert.equal(store.getConfig().personaId, 'cat');
});

test('opening an unmatched saved cat persona retains its selection', async () => {
  const f = await createAiSettingsFixture({ config: { modelProvider: 'openai', personaId: 'cat' } });
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'cat');
  assert.equal(f.saves().length, 0);
});

test('create persona choice opens a draft and cancel leaves the saved selection untouched', async () => {
  const f = await createAiSettingsFixture({ config: { personaId: 'general', hasCustomPersona: false } });
  f.input('xiaomiAiPersona', '__new__');
  f.fire('xiaomiAiForm', 'change', { target: f.elements.get('xiaomiAiPersona') });
  assert.equal(f.elements.get('xiaomiAiPersonaDialog').open, true);
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'general');
  f.fire('xiaomiAiPersonaCancel', 'click');
  await f.advance(700);
  assert.equal(f.saves().length, 0);
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'general');
});

test('cancelling a destructive persona action keeps saved and edited content', async () => {
  const confirmations = [];
  const f = await createAiSettingsFixture({
    config: { personaId: 'cat' },
    confirm: async (options) => { confirmations.push(options); return false; },
  });
  f.fire('xiaomiAiPersonaManage', 'click');
  const draft = '这是一段尚未保存且需要保留的角色指南。';
  f.input('xiaomiAiPersonaPrompt', draft);
  f.fire('xiaomiAiPersonaReset', 'click');
  await flushAiTasks();
  assert.equal(confirmations.length, 1);
  assert.equal(f.calls.some(({ url }) => url === '/api/ai/personas/update'), false);
  assert.equal(f.elements.get('xiaomiAiPersonaPrompt').value, draft);
  f.fire('xiaomiAiPersonaCancel', 'click');
  assert.equal(confirmations.length, 1, 'explicit Cancel does not open another confirmation');
});

test('deleting a persona keeps the confirmed target while a settings save is pending', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  const store = createAiConfigStore(createAiStateStore(db), { isAvailable: () => true });
  for (const id of ['alpha', 'beta']) store.importPersona({
    format: 'lira-ai-persona', version: 1, id, name: id,
    prompt: '这是一段长度足够的合成角色指南，用于测试预设删除时的目标归属。',
  });
  store.updateConfig({ personaId: 'alpha' });
  const pending = Promise.withResolvers();
  let saved;
  const confirmations = [];
  const f = await createAiSettingsFixture({
    config: store.getPublicConfig(),
    confirm: async options => { confirmations.push(options); return true; },
    request: (url, options) => {
      if (url === '/api/ai/config' && options.method === 'PUT') {
        saved = aiResponse(store.updateConfig(JSON.parse(options.body)));
        return pending.promise;
      }
      if (url === '/api/ai/personas/delete') return aiResponse(store.deletePersona(JSON.parse(options.body).id));
    },
  });
  f.input('xiaomiAiTrigger', '等待保存');
  await f.advance(700);
  f.fire('xiaomiAiPersonaManage', 'click');
  f.fire('xiaomiAiPersonaDelete', 'click');
  await flushAiTasks();
  const select = f.elements.get('xiaomiAiPersona');
  select.value = 'beta';
  f.fire('xiaomiAiForm', 'change', { target: select });
  f.fire('xiaomiAiPersonaManage', 'click');
  pending.resolve(saved);
  await flushAiTasks();
  await flushAiTasks();
  assert.match(confirmations[0].title, /alpha/);
  const deleted = f.calls.filter(call => call.url === '/api/ai/personas/delete');
  assert.deepEqual(deleted.map(call => JSON.parse(call.options.body).id), ['alpha']);
  assert.equal(store.getConfig().personaPacks.some(pack => pack.id === 'beta'), true);
});

test('editing a role remains a draft until saved and cancel does not change the selection', async () => {
  const f = await createAiSettingsFixture({ config: { personaId: 'cat' } });
  const text = '你是一个温柔的直播间助手，用自然的语言回答问题，不要添加猫咪口头禅。';
  f.fire('xiaomiAiPersonaManage', 'click');
  f.input('xiaomiAiPersonaPrompt', text);
  await f.advance(700);
  assert.equal(f.saves().length, 0);
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'cat');
  f.fire('xiaomiAiPersonaCancel', 'click');
  f.fire('xiaomiAiPersonaManage', 'click');
  assert.notEqual(f.elements.get('xiaomiAiPersonaPrompt').value, text);
});

test('saved legacy custom role remains selectable after choosing a built-in', async () => {
  const f = await createAiSettingsFixture({ config: { personaId: 'cat', hasCustomPersona: true } });
  assert.equal(f.elements.get('xiaomiAiPersona').children.some((option) => option.value === 'custom'), true);
  f.elements.get('xiaomiAiPersona').value = 'custom';
  f.fire('xiaomiAiPersonaManage', 'click');
  assert.equal(f.elements.get('xiaomiAiPersonaPrompt').value, f.publicConfig.systemPrompt);
  assert.equal(f.elements.get('xiaomiAiPersonaDelete').disabled, true);
});

test('turning off tools can save even when a hidden provider address draft is invalid', async () => {
  const f = await createAiSettingsFixture({ config: { functionCallingEnabled: true, placesEnabled: true } });
  const host = f.elements.get('xiaomiAiAmapHost');
  f.elements.get('xiaomiAiForm').checkValidity = () => host.disabled || host.value !== 'invalid-url';
  f.input(host.id, 'invalid-url');
  await f.advance(700);
  assert.equal(f.saves().length, 0);
  const toggle = f.elements.get('xiaomiAiFunctionCalling');
  toggle.checked = false;
  f.fire('xiaomiAiForm', 'change', { target: toggle });
  await flushAiTasks();
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].functionCallingEnabled, false);
  assert.equal(f.saves()[0].amapApiHost, undefined);
  assert.equal(host.value, 'invalid-url');
});

test('invalid persona file leaves current role untouched', async () => {
  const f = await createAiSettingsFixture({ config: { personaId: 'cat' } });
  f.elements.get('xiaomiAiPersonaFile').files = [{ size: 5, text: async () => '{bad}' }];
  await f.fire('xiaomiAiPersonaFile', 'change');
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'cat');
  assert.equal(f.calls.some(({ url }) => url.includes('/personas/import')), false);
});

test('saving a named role waits for pending settings without overwriting the editor draft and exports role data', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  const store = createAiConfigStore(createAiStateStore(db), { isAvailable: () => true });
  let finishSave;
  const f = await createAiSettingsFixture({
    config: store.getPublicConfig(),
    request: (url, options) => {
      if (url === '/api/ai/config' && options.method === 'PUT') {
        const saved = store.updateConfig(JSON.parse(options.body));
        return new Promise((resolve) => { finishSave = () => resolve(aiResponse(saved)); });
      }
      if (url === '/api/ai/personas/create') return aiResponse(store.createPersona(JSON.parse(options.body)));
      if (url === '/api/ai/personas/export') return aiResponse(store.exportPersona());
      return undefined;
    },
  });
  const prompt = '你是友善的直播间朋友，认真、简洁地回答问题，不使用固定的口头禅。';
  f.input('xiaomiAiTrigger', '小米');
  f.fire('xiaomiAiPersonaManage', 'click');
  f.fire('xiaomiAiPersonaNew', 'click');
  f.input('xiaomiAiPersonaPrompt', prompt);
  f.input('xiaomiAiPersonaName', '安静的朋友');
  f.input('xiaomiAiPersonaDescription', '温柔陪聊');
  f.fire('xiaomiAiPersonaEditor', 'submit', { preventDefault() {} });
  await flushAiTasks();
  assert.equal(f.saves().length, 1);
  assert.equal(f.calls.some(({ url }) => url === '/api/ai/personas/create'), false);
  finishSave();
  await flushAiTasks();
  assert.equal(store.exportPersona().name, '安静的朋友');
  assert.equal(store.exportPersona().prompt, prompt);
  assert.equal(f.elements.get('xiaomiAiPersona').value, store.getConfig().personaId);
  assert.equal(f.elements.get('xiaomiAiPersonaName').value, '安静的朋友');
  assert.equal(store.exportPersona().description, '温柔陪聊');
  assert.equal(f.calls.filter(({ url }) => url === '/api/ai/personas/create').length, 1);
  f.fire('xiaomiAiPersonaExport', 'click');
  await flushAiTasks();
  assert.equal(f.downloads.length, 1);
  const exported = await (await fetch(f.downloads[0].href)).json();
  assert.deepEqual(exported, store.exportPersona());
});

test('role operations wait for initial config and recover after server rejection', async () => {
  const f = await createAiSettingsFixture({
    deferInitialConfig: true,
    request: (url) => url === '/api/ai/personas/create'
      ? { ok: false, status: 400, json: async () => ({ ok: false, error: '角色包名称不能为空。' }) }
      : undefined,
  });
  f.fire('xiaomiAiPersonaEditor', 'submit', { preventDefault() {} });
  await flushAiTasks();
  assert.equal(f.calls.some(({ url }) => url === '/api/ai/personas/create'), false);
  f.resolveInitialConfig();
  await flushAiTasks();
  assert.equal(f.elements.get('xiaomiAiPersonaDialog').inert, false);
  assert.equal(f.elements.get('xiaomiAiPersona').value, 'custom');
  f.fire('xiaomiAiPersonaEditor', 'submit', { preventDefault() {} });
  await flushAiTasks();
  assert.equal(f.calls.filter(({ url }) => url === '/api/ai/personas/create').length, 2);
});

test('AI refresh updates untouched fields and preserves the current draft', async () => {
  const f = await createAiSettingsFixture();
  f.input('xiaomiAiTrigger', '正在编辑的关键词');
  f.publicConfig.trigger = '服务端关键词';
  f.publicConfig.model = 'updated-model';
  await f.api.refresh();
  assert.equal(f.elements.get('xiaomiAiTrigger').value, '正在编辑的关键词');
  assert.equal(f.elements.get('xiaomiAiModel').value, 'updated-model');
  assert.equal(f.saves().length, 0);
});

test('AI text edits restart the 700 ms debounce and save only the latest value', async () => {
  const f = await createAiSettingsFixture();
  f.input('xiaomiAiModel', 'first-model');
  await f.advance(699);
  f.input('xiaomiAiModel', 'new-model');
  await f.advance(699);
  assert.equal(f.saves().length, 0);
  await f.advance(1);
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].model, 'new-model');
});

test('AI edits during a pending save are saved after it completes', async () => {
  let resolveSave;
  const pendingSave = new Promise((resolve) => {
    resolveSave = resolve;
  });
  let saveCount = 0;
  const f = await createAiSettingsFixture({
    request: (url, options) => (options.method === 'PUT' && ++saveCount === 1 ? pendingSave : undefined),
  });
  f.input('xiaomiAiModel', 'first-model');
  await f.advance(700);
  f.input('xiaomiAiModel', 'later-model');
  await f.advance(700);
  assert.equal(f.saves().length, 1);
  assert.equal(f.elements.get('xiaomiAiModel').value, 'later-model');
  resolveSave(aiResponse(f.publicConfig));
  await flushAiTasks();
  assert.deepEqual(
    f.saves().map((saved) => saved.model),
    ['first-model', 'later-model'],
  );
  assert.equal(f.elements.get('xiaomiAiModel').value, 'later-model');
});

test('AI refresh cannot replace edits protected by a newer pending save', async (t) => {
  const complete = [];
  const responses = [0, 1].map(() => new Promise((resolve) => complete.push(resolve)));
  let saveCount = 0;
  const f = await createAiSettingsFixture({
    request: (_url, options) => (options.method === 'PUT' ? responses[saveCount++] : undefined),
  });
  t.after(() => complete.forEach((resolve) => resolve(aiResponse(f.publicConfig))));
  f.input('xiaomiAiModel', 'first-model');
  await f.advance(700);
  f.input('xiaomiAiModel', 'newer-model');
  await f.advance(700);
  f.publicConfig.model = 'first-model';
  complete[0](aiResponse({ ...f.publicConfig }));
  await flushAiTasks();
  assert.equal(f.saves().length, 2);

  // Reopening the feature refreshes the last persisted value while save #2 is pending.
  await f.api.refresh();
  assert.equal(f.elements.get('xiaomiAiModel').value, 'newer-model');
  assert.equal(f.saves()[1].model, 'newer-model');

  f.publicConfig.model = 'newer-model';
  complete[1](aiResponse({ ...f.publicConfig }));
  await flushAiTasks();
  f.publicConfig.model = 'later-server-model';
  await f.api.refresh();
  assert.equal(f.elements.get('xiaomiAiModel').value, 'later-server-model');
});

test('AI config reads started before a completed save cannot roll back the next save', async () => {
  const pendingRead = Promise.withResolvers();
  let delayRead = false;
  const f = await createAiSettingsFixture({
    request(url, options) {
      if (url !== '/api/ai/config') return;
      if (!options.method && delayRead) return pendingRead.promise;
      if (options.method === 'PUT') {
        Object.assign(f.publicConfig, JSON.parse(options.body));
        return aiResponse({ ...f.publicConfig });
      }
    },
  });
  const oldConfig = { ...f.publicConfig };
  delayRead = true;
  const refreshing = f.api.refresh();
  f.input('xiaomiAiModel', 'saved-model');
  await f.advance(700);
  pendingRead.resolve(aiResponse(oldConfig));
  await refreshing;
  assert.equal(f.elements.get('xiaomiAiModel').value, 'saved-model');

  f.input('xiaomiAiTrigger', 'new-trigger');
  await f.advance(700);
  assert.equal(f.saves().at(-1).model, 'saved-model');
  assert.equal(f.publicConfig.model, 'saved-model');
  delayRead = false;
  f.publicConfig.model = 'updated-elsewhere';
  await f.api.refresh();
  assert.equal(f.elements.get('xiaomiAiModel').value, 'updated-elsewhere');
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
  assert.ok(menu.children[0].textContent.includes(modelNames[models[0]]));
  assert.ok(menu.children[1].textContent.includes(modelNames[models[1]]));
  menu.children[1].listeners.click();
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
