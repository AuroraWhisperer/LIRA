'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiStateStore } = require('../../src/storage/ai-state-store');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { buildTools } = require('../../src/ai/prompt');
const { createAiSettingsFixture, flushAiTasks, aiResponse } = require('../helpers/ai-settings-fixture');

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

test('retry reloads failed initial status and saves the preserved draft exactly once', async () => {
  const retryStatus = Promise.withResolvers();
  let reads = 0;
  const f = await createAiSettingsFixture({ request(url) {
    if (url === '/api/ai/status') {
      if (++reads === 1) throw new Error('status offline');
      return retryStatus.promise;
    }
  } });
  assert.equal(f.elements.get('xiaomiAiModelProvider').disabled, true);
  f.input('xiaomiAiTrigger', '新名字');
  for (let i = 0; i < 2; i++) f.fire('xiaomiAiForm', 'submit', { preventDefault() {} });
  assert.equal(reads, 2);
  assert.equal(f.saves().length, 0);
  retryStatus.resolve(aiResponse({ queued: 0 }));
  await flushAiTasks();
  await f.advance(700);
  assert.equal(f.elements.get('xiaomiAiModelProvider').disabled, false);
  assert.deepEqual(f.saves().map(save => save.trigger), ['新名字']);
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

test('automatic reply probability loads the saved value and persists edits independently of the switch', async () => {
  const f = await createAiSettingsFixture({ config: { autoReplyEnabled: false, autoReplyProbabilityPercent: 45 } });
  assert.equal(f.elements.get('xiaomiAiAutoReplyProbability').value, '45');
  f.input('xiaomiAiAutoReplyProbability', '30');
  await f.advance(700);
  assert.equal(f.saves().at(-1).autoReplyProbabilityPercent, 30);
  assert.equal(f.publicConfig.autoReplyEnabled, false);
});

test('a failed reply switch keeps its retry visible across a successful configuration autosave', async () => {
  const stored = { enabled: true };
  let rejectSwitch = true;
  const f = await createAiSettingsFixture({ config: stored, request: (url, options) => {
    if (url !== '/api/ai/config' || options.method !== 'PUT') return;
    const patch = JSON.parse(options.body);
    if (patch.enabled === false && rejectSwitch) throw new Error('开关写入失败');
    Object.assign(stored, patch);
    return aiResponse({ ...f.publicConfig, ...stored });
  } });
  const toggle = f.elements.get('xiaomiAiEnabled');
  const retry = f.elements.get('xiaomiAiSaveBtn');
  toggle.checked = false;
  f.fire(toggle.id, 'change');
  await flushAiTasks();
  assert.equal(retry.hidden, false);
  f.input('xiaomiAiTrigger', 'Demo');
  await f.advance(700);
  assert.equal(stored.trigger, 'Demo');
  assert.equal(stored.enabled, true);
  assert.equal(retry.hidden, false);
  assert.match(f.elements.get('xiaomiAiSaveState').textContent, /开关写入失败/);
  rejectSwitch = false;
  f.fire('xiaomiAiForm', 'submit', { preventDefault() {} });
  await flushAiTasks();
  assert.equal(stored.enabled, false);
  assert.equal(retry.hidden, true);
});

test('automatic mention preference loads the saved opt-in and saves turning it off', async () => {
  const f = await createAiSettingsFixture({ config: { autoReplyMentionEnabled: true } });
  const input = f.elements.get('xiaomiAiAutoReplyMentionEnabled');
  assert.equal(input.checked, true);
  input.checked = false;
  f.fire('xiaomiAiForm', 'change', { target: input });
  await flushAiTasks();
  assert.equal(f.saves().at(-1).autoReplyMentionEnabled, false);
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

test('turning off a query can save even when its hidden provider address draft is invalid', async () => {
  const f = await createAiSettingsFixture({ config: { functionCallingEnabled: true, placesEnabled: true, webSearchEnabled: false } });
  const host = f.elements.get('xiaomiAiAmapHost');
  f.elements.get('xiaomiAiForm').checkValidity = () => host.disabled || host.value !== 'invalid-url';
  f.input(host.id, 'invalid-url');
  await f.advance(700);
  assert.equal(f.saves().length, 0);
  const toggle = f.elements.get('xiaomiAiPlacesEnabled');
  toggle.checked = false;
  f.fire('xiaomiAiForm', 'change', { target: toggle });
  await flushAiTasks();
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].placesEnabled, false);
  assert.equal(f.saves()[0].amapApiHost, undefined);
  assert.equal(host.value, 'invalid-url');
});

test('individual search and query switches save usable tools without a master switch', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(SONG_SCHEMA);
  const codec = { isAvailable: () => true, encrypt: value => `encrypted:${value}`, decrypt: value => value.slice(10) };
  const store = createAiConfigStore(createAiStateStore(db), codec);
  store.updateConfig({ modelProvider: 'deepseek', qweatherApiHost: 'https://weather.test', qweatherApiKey: 'test-weather-key' });
  const openSettings = () => createAiSettingsFixture({
    config: store.getPublicConfig(),
    request: (url, options) => url === '/api/ai/config' && options.method === 'PUT'
      ? aiResponse(store.updateConfig(JSON.parse(options.body))) : undefined,
  });
  let f = await openSettings();
  const toggle = async (id, checked) => {
    const input = f.elements.get(id);
    input.checked = checked;
    f.fire('xiaomiAiForm', 'change', { target: input });
    await flushAiTasks();
  };
  await toggle('xiaomiAiWebSearch', true);
  assert.ok(buildTools(store.getConfig()).some(tool => tool.type === 'web_search'));
  await toggle('xiaomiAiWebSearch', false);
  await toggle('xiaomiAiWeatherEnabled', true);
  assert.ok(buildTools(store.getConfig()).some(tool => tool.name === 'get_weather'));
  await toggle('xiaomiAiWeatherEnabled', false);
  assert.equal(buildTools(store.getConfig()).length, 0);
  f = await openSettings();
  assert.equal(f.elements.get('xiaomiAiWeatherEnabled').checked, false);
  assert.equal(store.getConfig().qweatherApiKey, 'test-weather-key');
});

for (const [webSearchMode, searchEnabled] of [['hosted', true], ['local_function', false]]) {
  test(`disabled legacy queries stay off when settings save with ${webSearchMode} search`, async () => {
    const f = await createAiSettingsFixture({ config: {
      functionCallingEnabled: false, weatherEnabled: true, placesEnabled: true, routesEnabled: true,
      modelEndpoint: { webSearchMode },
    } });
    f.input('xiaomiAiTrigger', '助手');
    await f.advance(700);
    const saved = f.saves()[0];
    for (const key of ['weatherEnabled', 'placesEnabled', 'routesEnabled']) assert.equal(saved[key], false, key);
    assert.equal(saved.webSearchEnabled, searchEnabled);
  });
}

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
