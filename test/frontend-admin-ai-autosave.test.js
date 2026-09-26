'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../src/storage/schema');
const { createAiConfigStore } = require('../src/ai/config-store');
const { createAiSettingsFixture, flushAiTasks, aiResponse } = require('./helpers/ai-settings-fixture');

test('AI initial load preserves edits and blocks saving before configuration arrives', async () => {
  const f = await createAiSettingsFixture({ deferInitialConfig: true });
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
  assert.equal(f.elements.get('xiaomiAiSaveState').textContent, '配置尚未加载，暂时无法保存；请等待或刷新页面重试。');
  assert.equal(f.saves().length, 0);

  f.resolveInitialConfig();
  await flushAiTasks();
  for (const [id, value] of Object.entries(edits)) assert.equal(f.elements.get(id).value, value);
  assert.equal(f.elements.get('xiaomiAiSystemPrompt').value, f.publicConfig.systemPrompt);
  assert.equal(f.elements.get('xiaomiAiModelApiProtocol').value, 'responses');
  assert.equal(f.elements.get('xiaomiAiModelProvider').value, 'custom');
  assert.equal(f.elements.get('xiaomiAiReasoningEffort').value, 'high');

  f.fire('xiaomiAiForm', 'submit', { preventDefault() {} });
  await flushAiTasks();
  assert.equal(f.saves().length, 1);
  assert.deepEqual(f.saves()[0], {
    enabled: false,
    trigger: '小米',
    modelProvider: 'custom',
    modelApiProtocol: 'responses',
    deepseekResponsesUrl: edits.xiaomiAiDeepSeekUrl,
    deepseekApiKey: 'deepseek-secret',
    model: 'deepseek-v4-flash',
    webSearchEnabled: true,
    reasoningEnabled: false,
    reasoningEffort: 'high',
    qweatherApiHost: edits.xiaomiAiQWeatherHost,
    qweatherApiKey: 'qweather-secret',
    amapApiHost: edits.xiaomiAiAmapHost,
    amapApiKey: 'amap-secret',
    replyMaxChars: 50,
    generationConcurrency: 3,
    userCooldownSeconds: 0,
    roomLimitPerMinute: 20,
    systemPrompt: f.publicConfig.systemPrompt,
  });
  for (const [id, value] of Object.entries(edits)) assert.equal(f.elements.get(id).value, value);
});

test('AI enabled toggle saves immediately', async () => {
  const f = await createAiSettingsFixture();
  f.elements.get('xiaomiAiEnabled').checked = true;
  f.fire('xiaomiAiEnabled', 'change');
  await flushAiTasks();
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].enabled, true);
});

test('AI refresh updates untouched fields and preserves the current draft', async () => {
  const f = await createAiSettingsFixture();
  f.input('xiaomiAiTrigger', '正在编辑的关键词');
  f.publicConfig.trigger = '服务端关键词';
  f.publicConfig.model = 'updated-model';
  await f.api.refresh();
  assert.equal(f.elements.get('xiaomiAiTrigger').value, '正在编辑的关键词');
  assert.equal(f.elements.get('xiaomiAiModel').value, 'updated-model');
  assert.equal(f.elements.get('xiaomiAiModelState').textContent, 'updated-model');
  assert.equal(f.saves().length, 0);
});

test('AI configuration without a model displays an unconfigured state', async () => {
  const { elements } = await createAiSettingsFixture({ config: { model: '' } });
  assert.equal(elements.get('xiaomiAiModel').value, '');
  assert.equal(elements.get('xiaomiAiModelState').textContent, '未配置');
});

test('AI text edits restart the 700 ms debounce and save only the latest value', async () => {
  const f = await createAiSettingsFixture();
  f.input('xiaomiAiModel', 'first-model');
  await f.advance(699);
  assert.equal(f.saves().length, 0);
  f.input('xiaomiAiModel', 'new-model');
  await f.advance(1);
  assert.equal(f.saves().length, 0);
  await f.advance(698);
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
  assert.equal(f.elements.get('xiaomiAiSaveState').textContent, '已保存，后续新弹幕立即生效。');
});

test('AI refresh cannot replace edits protected by a newer pending save', async (t) => {
  const complete = [];
  const responses = [0, 1].map(() => new Promise((resolve) => complete.push(resolve)));
  let saveCount = 0;
  const f = await createAiSettingsFixture({
    request: (_url, options) => options.method === 'PUT' ? responses[saveCount++] : undefined,
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

test('AI model listing uses draft credentials and saves a selected model after reopening the menu', async () => {
  const f = await createAiSettingsFixture();
  f.input('xiaomiAiDeepSeekKey', 'deepseek-secret');
  f.input('xiaomiAiDeepSeekUrl', 'https://api.deepseek.com/responses');
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  const modelRequest = f.calls.find((call) => call.url === '/api/ai/models');
  assert.deepEqual(JSON.parse(modelRequest.options.body), {
    apiKey: 'deepseek-secret',
    apiUrl: 'https://api.deepseek.com/responses',
    modelProvider: 'custom',
    modelApiProtocol: 'responses',
  });
  const menu = f.elements.get('xiaomiAiModelMenu');
  assert.equal(menu.hidden, false);
  assert.deepEqual(
    menu.children.map((option) => option.textContent),
    ['deepseek-v4-flash', 'deepseek-v4-pro'],
  );
  assert.equal(f.elements.get('xiaomiAiModelFetchState').textContent, '已获取 2 个可用模型；可选择或直接输入。');
  menu.children[1].listeners.click();
  assert.equal(f.elements.get('xiaomiAiModel').value, 'deepseek-v4-pro');
  assert.equal(menu.hidden, true);
  await f.fire('xiaomiAiFetchModelsBtn', 'click');
  assert.equal(menu.hidden, false);
  assert.deepEqual(
    menu.children.map((option) => option.textContent),
    ['deepseek-v4-flash', 'deepseek-v4-pro'],
  );
  menu.children[1].listeners.click();
  await f.advance(700);
  assert.equal(f.saves().length, 1);
  assert.equal(f.saves()[0].model, 'deepseek-v4-pro');
});

for (const scenario of [
  {
    provider: 'deepseek',
    field: 'xiaomiAiDeepSeekUrl',
    value: 'https://api.deepseek.com',
    key: 'deepseekResponsesUrl',
    button: 'xiaomiAiTestBtn',
    detail: '模型服务 连接正常。模型 deepseek-chat 回复：你好！有什么可以帮你？',
  },
  {
    provider: 'qweather',
    field: 'xiaomiAiQWeatherHost',
    value: 'new-weather.test',
    key: 'qweatherApiHost',
    button: 'xiaomiAiQWeatherTestBtn',
    detail: '和风天气 连接正常。地址与密钥均可用',
  },
]) {
  test(`AI ${scenario.provider} connection test waits for the current settings to save`, async () => {
    const f = await createAiSettingsFixture();
    f.input(scenario.field, scenario.value);
    f.fire(scenario.button, 'click');
    await flushAiTasks();
    const saveIndex = f.calls.findIndex((call) => call.options.method === 'PUT');
    const testIndex = f.calls.findIndex((call) => call.url === `/api/ai/test/${scenario.provider}`);
    assert.ok(saveIndex >= 0 && testIndex > saveIndex);
    assert.equal(f.saves()[0][scenario.key], scenario.value);
    assert.equal(f.elements.get(scenario.field).value, scenario.value);
    assert.equal(f.elements.get(`aiTestDetail-${scenario.provider}`).textContent, scenario.detail);
    assert.match(f.toasts[0].className, /xiaomi-ai-test-toast-good/);
  });
}

test('AI custom provider renders editable endpoint and configured capabilities', async () => {
  const { elements } = await createAiSettingsFixture();
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').disabled, false);
  assert.equal(elements.get('xiaomiAiProtocolControl').hidden, false);
  assert.equal(elements.get('xiaomiAiProtocolCapability').textContent, 'Responses API');
  assert.equal(elements.get('xiaomiAiWebSearchCapability').textContent, 'AI 平台搜索');
  assert.equal(elements.get('xiaomiAiReasoningCapability').textContent, '可设置强度');
  assert.equal(elements.get('xiaomiAiReasoningControl').hidden, false);
  assert.equal(elements.get('xiaomiAiReasoningEffortControl').hidden, false);
  assert.equal(elements.get('xiaomiAiProviderManagedReasoning').hidden, true);
  assert.equal(elements.get('xiaomiAiReasoningEffort').disabled, true);
});

test('AI DeepSeek preset locks the endpoint and shows local search and DeepSeek reasoning', async () => {
  const { elements } = await createAiSettingsFixture({
    config: {
      modelProvider: 'deepseek',
      deepseekResponsesUrl: 'https://api.deepseek.com',
      modelApiProtocol: 'chat_completions',
      modelEndpoint: {
        protocol: 'chat_completions',
        provider: 'deepseek',
        webSearchMode: 'local_function',
        reasoningMode: 'deepseek_effort',
      },
    },
  });
  assert.equal(elements.get('xiaomiAiProtocolCapability').textContent, 'Chat Completions');
  assert.equal(elements.get('xiaomiAiWebSearchCapability').textContent, 'LIRA 搜索');
  assert.equal(elements.get('xiaomiAiReasoningCapability').textContent, 'DeepSeek 强度');
  assert.equal(elements.get('xiaomiAiReasoningControl').hidden, false);
  assert.equal(elements.get('xiaomiAiReasoningEffortControl').hidden, false);
  assert.equal(elements.get('xiaomiAiReasoningLabel').textContent, 'DeepSeek 思考');
  assert.equal(elements.get('xiaomiAiProviderBadge').textContent, 'DeepSeek 官方');
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').disabled, true);
  assert.equal(elements.get('xiaomiAiProtocolControl').hidden, true);
});

test('AI platform-managed reasoning hides manual reasoning controls', async () => {
  const { elements } = await createAiSettingsFixture({
    config: {
      modelProvider: 'anthropic',
      deepseekResponsesUrl: 'https://api.anthropic.com/v1',
      modelEndpoint: {
        protocol: 'chat_completions',
        provider: 'anthropic',
        webSearchMode: 'local_function',
        reasoningMode: 'provider_managed',
      },
    },
  });
  assert.equal(elements.get('xiaomiAiReasoningCapability').textContent, '由平台决定');
  assert.equal(elements.get('xiaomiAiReasoningControl').hidden, true);
  assert.equal(elements.get('xiaomiAiProviderManagedReasoning').hidden, false);
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
  assert.equal(f.elements.get('xiaomiAiDeepSeekUrl').disabled, true);
  const provider = f.elements.get('xiaomiAiModelProvider');
  provider.value = 'custom';
  f.fire('xiaomiAiModelProvider', 'change');
  assert.equal(f.elements.get('xiaomiAiDeepSeekUrl').disabled, true);
  assert.equal(f.elements.get('xiaomiAiProtocolControl').hidden, false);
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
    const store = createAiConfigStore(db, { isAvailable: () => true });
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
    assert.equal(f.elements.get('xiaomiAiDeepSeekUrl').disabled, false);

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
