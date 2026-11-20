'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiStateStore } = require('../../src/storage/ai-state-store');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { createAiSettingsFixture, flushAiTasks, aiResponse } = require('../helpers/ai-settings-fixture');

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
