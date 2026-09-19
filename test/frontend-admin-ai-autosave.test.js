'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');

test('AI assistant autosaves toggles immediately and text after a debounce', async () => {
  const source = readJsModuleBundle(
    'public',
    'js',
    'admin',
    'ai-assistant-settings.js',
  );
  const listeners = new Map();
  const fetchCalls = [];
  const timers = [];
  const values = {
    xiaomiAiEnabled: false,
    xiaomiAiTrigger: '小米',
    xiaomiAiDeepSeekUrl: '',
    xiaomiAiModelProvider: 'auto',
    xiaomiAiModelApiProtocol: 'auto',
    xiaomiAiModel: 'deepseek-v4-flash',
    xiaomiAiWebSearch: true,
    xiaomiAiReasoning: false,
    xiaomiAiReasoningEffort: 'auto',
    xiaomiAiQWeatherHost: '',
    xiaomiAiAmapHost: '',
    xiaomiAiReplyMaxChars: '50',
    xiaomiAiConcurrency: '3',
    xiaomiAiUserCooldown: '0',
    xiaomiAiRoomLimit: '20',
    xiaomiAiSystemPrompt: '',
    xiaomiAiDeepSeekKey: '',
    xiaomiAiQWeatherKey: '',
    xiaomiAiAmapKey: '',
  };
  const elements = new Map(
    Object.entries(values).map(([id, value]) => [
      id,
      {
        id,
        value: typeof value === 'boolean' ? '' : value,
        checked: value === true,
        textContent: '',
        className: '',
        disabled: false,
        attributes: {},
        setAttribute(name, attributeValue) {
          this.attributes[name] = attributeValue;
        },
        addEventListener(type, handler) {
          listeners.set(`${id}:${type}`, handler);
        },
      },
    ]),
  );
  for (const id of [
    'xiaomiAiSaveState',
    'xiaomiAiTestBtn',
    'xiaomiAiQWeatherTestBtn',
    'xiaomiAiAmapTestBtn',
    'xiaomiAiFetchModelsBtn',
    'xiaomiAiDeepSeekKeyHint',
    'xiaomiAiQWeatherKeyHint',
    'xiaomiAiAmapKeyHint',
    'xiaomiAiConfigState',
    'xiaomiAiModelState',
    'xiaomiAiQueueState',
    'xiaomiAiModelFetchState',
    'xiaomiAiProtocolCapability',
    'xiaomiAiWebSearchCapability',
    'xiaomiAiReasoningCapability',
    'xiaomiAiWebSearchLabel',
    'xiaomiAiWebSearchHelp',
    'xiaomiAiReasoningLabel',
    'xiaomiAiReasoningHelp',
    'xiaomiAiProviderBadge',
    'xiaomiAiProviderNote',
    'xiaomiAiEndpointHelp',
  ]) {
    if (!elements.has(id))
      elements.set(id, {
        id,
        value: '',
        checked: false,
        textContent: '',
        className: '',
        disabled: false,
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        addEventListener(type, handler) {
          listeners.set(`${id}:${type}`, handler);
        },
      });
  }
  for (const id of ['xiaomiAiTestBtn', 'xiaomiAiQWeatherTestBtn', 'xiaomiAiAmapTestBtn']) {
    elements.get(id).parentElement = { after(node) { elements.set(node.id, node); } };
  }
  elements.set('xiaomiAiModelMenu', {
    hidden: true,
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
  });
  for (const id of [
    'xiaomiAiReasoningControl',
    'xiaomiAiReasoningEffortControl',
    'xiaomiAiProviderManagedReasoning',
  ]) {
    elements.set(id, {
      id,
      value: '',
      checked: false,
      textContent: '',
      className: '',
      disabled: false,
      hidden: true,
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener(type, handler) {
        listeners.set(`${id}:${type}`, handler);
      },
    });
  }
  elements.set('xiaomiAiProtocolControl', {
    id: 'xiaomiAiProtocolControl',
    hidden: false,
    textContent: '',
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      listeners.set(`xiaomiAiProtocolControl:${type}`, handler);
    },
  });
  const form = {
    checkValidity: () => true,
    reportValidity: () => true,
    addEventListener(type, handler) {
      listeners.set(`form:${type}`, handler);
    },
  };
  elements.set('xiaomiAiForm', form);

  const publicConfig = {
    enabled: false,
    trigger: '小米',
    deepseekResponsesUrl: 'https://api.example.com/responses',
    modelProvider: 'custom',
    modelApiProtocol: 'responses',
    model: 'deepseek-v4-flash',
    webSearchEnabled: true,
    reasoningEnabled: false,
    reasoningEffort: 'high',
    modelEndpoint: {
      protocol: 'responses',
      provider: 'custom',
      webSearchMode: 'hosted',
      reasoningMode: 'effort',
    },
    qweatherApiHost: '',
    amapApiHost: '',
    replyMaxChars: 50,
    generationConcurrency: 3,
    sendIntervalMs: 3000,
    userCooldownSeconds: 0,
    roomLimitPerMinute: 20,
    systemPrompt: '这是一个长度足够的测试人格预设。',
    hasDeepSeekApiKey: true,
    hasQWeatherApiKey: false,
    hasAmapApiKey: false,
  };
  let resolveInitialConfig;
  const initialConfigResponse = new Promise((resolve) => {
    resolveInitialConfig = resolve;
  });
  const sandbox = {
    console,
    document: {
      getElementById: (id) => elements.get(id),
      createElement: (tagName) => ({
        tagName,
        value: '',
        textContent: '',
        className: '',
        attributes: {},
        listeners: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        addEventListener(type, handler) {
          this.listeners[type] = handler;
        },
      }),
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === '/api/ai/config' && !options.method)
        return initialConfigResponse;
      if (url === '/api/ai/models') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: { models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
          }),
        };
      }
      if (url === '/api/ai/test/deepseek') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              provider: 'deepseek',
              model: 'deepseek-chat',
              reply: '你好！有什么可以帮你？',
              endpointAdapted: true,
            },
          }),
        };
      }
      const data = url === '/api/ai/status' ? { queued: 0 } : publicConfig;
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
    setTimeout: (handler) => {
      timers.push(handler);
      return timers.length;
    },
    clearTimeout() {},
    window: {
      AdminApp: {
        utils: {
          showStackedToast(options) {
            fetchCalls.push({ toast: options });
          },
        },
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.aiAssistantSettings.init();

  elements.get('xiaomiAiDeepSeekUrl').value =
    'https://api.deepseek.com/responses';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiDeepSeekUrl', matches: () => false },
  });
  elements.get('xiaomiAiDeepSeekKey').value = 'deepseek-secret';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiDeepSeekKey', matches: () => false },
  });
  elements.get('xiaomiAiQWeatherHost').value = 'nn7mdbwku9.re.qweatherapi.com';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiQWeatherHost', matches: () => false },
  });
  elements.get('xiaomiAiQWeatherKey').value = 'qweather-secret';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiQWeatherKey', matches: () => false },
  });
  elements.get('xiaomiAiAmapHost').value = 'https://restapi.amap.com';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiAmapHost', matches: () => false },
  });
  elements.get('xiaomiAiAmapKey').value = 'amap-secret';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiAmapKey', matches: () => false },
  });
  listeners.get('form:submit')({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    elements.get('xiaomiAiSaveState').textContent,
    '配置尚未加载，暂时无法保存；请等待或刷新页面重试。',
  );
  assert.equal(
    fetchCalls.filter((call) => call.options.method === 'PUT').length,
    0,
  );

  resolveInitialConfig({
    ok: true,
    json: async () => ({ ok: true, data: publicConfig }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    elements.get('xiaomiAiDeepSeekUrl').value,
    'https://api.deepseek.com/responses',
  );
  assert.equal(
    elements.get('xiaomiAiSystemPrompt').value,
    publicConfig.systemPrompt,
  );
  assert.equal(elements.get('xiaomiAiModelApiProtocol').value, 'responses');
  assert.equal(elements.get('xiaomiAiModelProvider').value, 'custom');
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').disabled, false);
  assert.equal(elements.get('xiaomiAiProtocolControl').hidden, false);
  assert.equal(elements.get('xiaomiAiReasoningEffort').value, 'high');
  assert.equal(
    elements.get('xiaomiAiProtocolCapability').textContent,
    'Responses API',
  );
  assert.equal(
    elements.get('xiaomiAiWebSearchCapability').textContent,
    'AI 平台搜索',
  );
  assert.equal(
    elements.get('xiaomiAiReasoningCapability').textContent,
    '可设置强度',
  );
  assert.equal(elements.get('xiaomiAiReasoningControl').hidden, false);
  assert.equal(elements.get('xiaomiAiReasoningEffortControl').hidden, false);
  assert.equal(elements.get('xiaomiAiProviderManagedReasoning').hidden, true);
  assert.equal(elements.get('xiaomiAiReasoningEffort').disabled, true);

  publicConfig.modelEndpoint = {
    protocol: 'chat_completions',
    provider: 'deepseek',
    webSearchMode: 'local_function',
    reasoningMode: 'deepseek_effort',
  };
  publicConfig.modelProvider = 'deepseek';
  publicConfig.deepseekResponsesUrl = 'https://api.deepseek.com';
  publicConfig.modelApiProtocol = 'chat_completions';
  await sandbox.window.AdminApp.aiAssistantSettings.refresh();
  assert.equal(
    elements.get('xiaomiAiProtocolCapability').textContent,
    'Chat Completions',
  );
  assert.equal(
    elements.get('xiaomiAiWebSearchCapability').textContent,
    'LIRA 搜索',
  );
  assert.equal(
    elements.get('xiaomiAiReasoningCapability').textContent,
    'DeepSeek 强度',
  );
  assert.equal(elements.get('xiaomiAiReasoningControl').hidden, false);
  assert.equal(elements.get('xiaomiAiReasoningEffortControl').hidden, false);
  assert.equal(
    elements.get('xiaomiAiReasoningLabel').textContent,
    'DeepSeek 思考',
  );
  assert.equal(
    elements.get('xiaomiAiProviderBadge').textContent,
    'DeepSeek 官方',
  );
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').disabled, true);
  assert.equal(elements.get('xiaomiAiProtocolControl').hidden, true);

  publicConfig.modelEndpoint = {
    protocol: 'chat_completions',
    provider: 'anthropic',
    webSearchMode: 'local_function',
    reasoningMode: 'provider_managed',
  };
  publicConfig.modelProvider = 'anthropic';
  publicConfig.deepseekResponsesUrl = 'https://api.anthropic.com/v1';
  await sandbox.window.AdminApp.aiAssistantSettings.refresh();
  assert.equal(
    elements.get('xiaomiAiReasoningCapability').textContent,
    '由平台决定',
  );
  assert.equal(elements.get('xiaomiAiReasoningControl').hidden, true);
  assert.equal(elements.get('xiaomiAiProviderManagedReasoning').hidden, false);

  publicConfig.modelEndpoint = {
    protocol: 'responses',
    provider: 'custom',
    webSearchMode: 'hosted',
    reasoningMode: 'effort',
  };
  publicConfig.modelProvider = 'custom';
  publicConfig.deepseekResponsesUrl = 'https://api.example.com/responses';
  publicConfig.modelApiProtocol = 'responses';
  await sandbox.window.AdminApp.aiAssistantSettings.refresh();
  elements.get('xiaomiAiDeepSeekUrl').value =
    'https://api.deepseek.com/responses';

  listeners.get('form:submit')({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  let saves = fetchCalls.filter(
    (call) => call.url === '/api/ai/config' && call.options.method === 'PUT',
  );
  assert.equal(saves.length, 1);
  const firstSavedConfig = JSON.parse(saves[0].options.body);
  assert.equal(firstSavedConfig.enabled, false);
  assert.equal(firstSavedConfig.modelProvider, 'custom');
  assert.equal(firstSavedConfig.modelApiProtocol, 'responses');
  assert.equal(firstSavedConfig.reasoningEffort, 'high');
  assert.equal(
    firstSavedConfig.deepseekResponsesUrl,
    'https://api.deepseek.com/responses',
  );
  assert.equal(firstSavedConfig.deepseekApiKey, 'deepseek-secret');
  assert.equal(
    firstSavedConfig.qweatherApiHost,
    'nn7mdbwku9.re.qweatherapi.com',
  );
  assert.equal(firstSavedConfig.qweatherApiKey, 'qweather-secret');
  assert.equal(firstSavedConfig.amapApiHost, 'https://restapi.amap.com');
  assert.equal(firstSavedConfig.amapApiKey, 'amap-secret');
  assert.equal(firstSavedConfig.systemPrompt, publicConfig.systemPrompt);
  assert.equal(elements.get('xiaomiAiDeepSeekKey').value, 'deepseek-secret');
  assert.equal(elements.get('xiaomiAiQWeatherKey').value, 'qweather-secret');
  assert.equal(elements.get('xiaomiAiAmapKey').value, 'amap-secret');

  elements.get('xiaomiAiEnabled').checked = true;
  listeners.get('xiaomiAiEnabled:change')();
  await new Promise((resolve) => setImmediate(resolve));
  saves = fetchCalls.filter(
    (call) => call.url === '/api/ai/config' && call.options.method === 'PUT',
  );
  assert.equal(saves.length, 2);
  assert.equal(JSON.parse(saves[1].options.body).enabled, true);

  listeners.get('xiaomiAiFetchModelsBtn:click')();
  await new Promise((resolve) => setImmediate(resolve));
  const modelRequest = fetchCalls.find((call) => call.url === '/api/ai/models');
  assert.equal(JSON.parse(modelRequest.options.body).apiKey, 'deepseek-secret');
  assert.equal(
    JSON.parse(modelRequest.options.body).apiUrl,
    'https://api.deepseek.com/responses',
  );
  assert.equal(JSON.parse(modelRequest.options.body).modelProvider, 'custom');
  assert.equal(
    JSON.parse(modelRequest.options.body).modelApiProtocol,
    'responses',
  );
  assert.equal(elements.get('xiaomiAiModelMenu').hidden, false);
  assert.deepEqual(
    elements
      .get('xiaomiAiModelMenu')
      .children.map((option) => option.textContent),
    ['deepseek-v4-flash', 'deepseek-v4-pro'],
  );
  assert.equal(
    elements.get('xiaomiAiModelFetchState').textContent,
    '已获取 2 个可用模型；可选择或直接输入。',
  );

  elements.get('xiaomiAiModelMenu').children[1].listeners.click();
  assert.equal(elements.get('xiaomiAiModel').value, 'deepseek-v4-pro');
  assert.equal(elements.get('xiaomiAiModelMenu').hidden, true);
  listeners.get('xiaomiAiFetchModelsBtn:click')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('xiaomiAiModelMenu').hidden, false);
  assert.deepEqual(
    elements
      .get('xiaomiAiModelMenu')
      .children.map((option) => option.textContent),
    ['deepseek-v4-flash', 'deepseek-v4-pro'],
  );
  elements.get('xiaomiAiModelMenu').children[1].listeners.click();
  timers.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  saves = fetchCalls.filter(
    (call) => call.url === '/api/ai/config' && call.options.method === 'PUT',
  );
  assert.equal(saves.length, 3);
  assert.equal(JSON.parse(saves[2].options.body).model, 'deepseek-v4-pro');

  elements.get('xiaomiAiModel').value = 'new-model';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiModel', matches: () => false },
  });
  assert.equal(
    fetchCalls.filter((call) => call.options.method === 'PUT').length,
    3,
  );
  timers.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  saves = fetchCalls.filter(
    (call) => call.url === '/api/ai/config' && call.options.method === 'PUT',
  );
  assert.equal(saves.length, 4);
  assert.equal(JSON.parse(saves[3].options.body).model, 'new-model');

  elements.get('xiaomiAiDeepSeekUrl').value = 'https://api.deepseek.com';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiDeepSeekUrl', matches: () => false },
  });
  listeners.get('xiaomiAiTestBtn:click')();
  await new Promise((resolve) => setImmediate(resolve));
  const callsAfterDeepSeekTest = fetchCalls.filter((call) => call.url);
  const deepSeekSaveIndex = callsAfterDeepSeekTest.findIndex(
    (call) =>
      call.url === '/api/ai/config' &&
      call.options.method === 'PUT' &&
      JSON.parse(call.options.body).deepseekResponsesUrl ===
        'https://api.deepseek.com',
  );
  const deepSeekTestIndex = callsAfterDeepSeekTest.findIndex(
    (call) => call.url === '/api/ai/test/deepseek',
  );
  assert.ok(deepSeekSaveIndex >= 0 && deepSeekTestIndex > deepSeekSaveIndex);
  assert.equal(
    elements.get('xiaomiAiDeepSeekUrl').value,
    'https://api.deepseek.com',
  );
  assert.equal(
    elements.get('aiTestDetail-deepseek').textContent,
    '模型服务 连接正常。模型 deepseek-chat 回复：你好！有什么可以帮你？',
  );

  elements.get('xiaomiAiQWeatherHost').value = 'new-weather.test';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiQWeatherHost', matches: () => false },
  });
  listeners.get('xiaomiAiQWeatherTestBtn:click')();
  await new Promise((resolve) => setImmediate(resolve));
  const callsAfterWeatherTest = fetchCalls.filter((call) => call.url);
  const weatherSaveIndex = callsAfterWeatherTest.findIndex(
    (call) =>
      call.url === '/api/ai/config' &&
      call.options.method === 'PUT' &&
      JSON.parse(call.options.body).qweatherApiHost === 'new-weather.test',
  );
  const weatherTestIndex = callsAfterWeatherTest.findIndex(
    (call) => call.url === '/api/ai/test/qweather',
  );
  assert.ok(weatherSaveIndex >= 0 && weatherTestIndex > weatherSaveIndex);
  assert.match(
    fetchCalls.find((call) => call.toast)?.toast.className,
    /xiaomi-ai-test-toast-good/,
  );

  publicConfig.modelProvider = 'openai';
  publicConfig.deepseekResponsesUrl = 'https://api.openai.com/v1';
  publicConfig.modelApiProtocol = 'responses';
  publicConfig.modelEndpoint = {
    protocol: 'responses',
    provider: 'openai',
    webSearchMode: 'hosted',
    reasoningMode: 'effort',
  };
  await sandbox.window.AdminApp.aiAssistantSettings.refresh();
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').disabled, true);

  elements.get('xiaomiAiModelProvider').value = 'custom';
  listeners.get('xiaomiAiModelProvider:change')();
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').disabled, true);
  assert.equal(elements.get('xiaomiAiProtocolControl').hidden, false);
  publicConfig.modelProvider = 'custom';
  publicConfig.deepseekResponsesUrl = 'https://saved-custom.example/v1';
  publicConfig.modelApiProtocol = 'chat_completions';
  publicConfig.modelEndpoint = {
    protocol: 'chat_completions',
    provider: 'custom',
    webSearchMode: 'local_function',
    reasoningMode: 'provider_managed',
  };
  listeners.get('form:change')({
    target: {
      id: 'xiaomiAiModelProvider',
      matches: (selector) => selector.includes('select'),
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  saves = fetchCalls.filter(
    (call) => call.url === '/api/ai/config' && call.options.method === 'PUT',
  );
  const providerSwitchConfig = JSON.parse(saves.at(-1).options.body);
  assert.equal(providerSwitchConfig.modelProvider, 'custom');
  assert.equal(providerSwitchConfig.deepseekResponsesUrl, undefined);
  assert.equal(providerSwitchConfig.modelApiProtocol, undefined);
  assert.equal(
    elements.get('xiaomiAiDeepSeekUrl').value,
    'https://saved-custom.example/v1',
  );
  assert.equal(
    elements.get('xiaomiAiModelApiProtocol').value,
    'chat_completions',
  );
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').disabled, false);

  elements.get('xiaomiAiDeepSeekUrl').value = '';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiDeepSeekUrl', matches: () => false },
  });
  timers.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  saves = fetchCalls.filter(
    (call) => call.url === '/api/ai/config' && call.options.method === 'PUT',
  );
  assert.equal(JSON.parse(saves.at(-1).options.body).deepseekResponsesUrl, '');
});
