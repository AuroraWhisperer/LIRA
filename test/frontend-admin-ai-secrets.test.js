'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');

test('AI assistant masks saved secrets and omits mask placeholders from submission', async () => {
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
    xiaomiAiEnabled: true,
    xiaomiAiTrigger: '小米',
    xiaomiAiDeepSeekUrl: 'https://api.example.com/responses',
    xiaomiAiDeepSeekKey: '',
    xiaomiAiQWeatherKey: '',
    xiaomiAiAmapKey: '',
    xiaomiAiModel: 'deepseek-v4-flash',
    xiaomiAiWebSearch: true,
    xiaomiAiReasoning: false,
    xiaomiAiQWeatherHost: '',
    xiaomiAiAmapHost: '',
    xiaomiAiReplyMaxChars: '50',
    xiaomiAiConcurrency: '3',
    xiaomiAiUserCooldown: '0',
    xiaomiAiRoomLimit: '20',
    xiaomiAiSystemPrompt: '这是一个长度足够的测试人格预设。',
  };
  const elements = new Map(
    Object.entries(values).map(([id, value]) => [
      id,
      {
        id,
        value: typeof value === 'boolean' ? '' : value,
        type: 'text',
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
  elements.set('xiaomiAiModelMenu', {
    hidden: true,
    children: [],
    replaceChildren(...children) {
      this.children = children;
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
    enabled: true,
    trigger: '小米',
    deepseekResponsesUrl: 'https://api.example.com/responses',
    model: 'deepseek-v4-flash',
    webSearchEnabled: true,
    reasoningEnabled: false,
    qweatherApiHost: '',
    amapApiHost: '',
    replyMaxChars: 50,
    generationConcurrency: 3,
    sendIntervalMs: 3000,
    userCooldownSeconds: 0,
    roomLimitPerMinute: 20,
    systemPrompt: '这是一个长度足够的测试人格预设。',
    hasDeepSeekApiKey: true,
    hasQWeatherApiKey: true,
    hasAmapApiKey: false,
  };

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
      const data = url === '/api/ai/status' ? { queued: 0 } : publicConfig;
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
    setTimeout: (handler) => {
      timers.push(handler);
      return timers.length;
    },
    clearTimeout() {},
    window: { AdminApp: { utils: { showStackedToast() {} } } },
  };
  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.aiAssistantSettings.init();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get('xiaomiAiDeepSeekKey').type, 'password');
  assert.equal(elements.get('xiaomiAiDeepSeekKey').value, '');
  assert.equal(elements.get('xiaomiAiQWeatherKey').type, 'password');
  assert.equal(elements.get('xiaomiAiQWeatherKey').value, '');
  assert.equal(elements.get('xiaomiAiAmapKey').type, 'password');
  assert.equal(elements.get('xiaomiAiAmapKey').value, '');
  assert.equal(
    elements.get('xiaomiAiDeepSeekKeyHint').textContent,
    '已加密保存；清空或输入新值以更新',
  );
  assert.equal(
    elements.get('xiaomiAiQWeatherKeyHint').textContent,
    '已加密保存；清空或输入新值以更新',
  );
  assert.equal(elements.get('xiaomiAiAmapKeyHint').textContent, '尚未保存');

  listeners.get('xiaomiAiFetchModelsBtn:click')();
  await new Promise((resolve) => setImmediate(resolve));
  const modelRequest = fetchCalls.find((call) => call.url === '/api/ai/models');
  assert.equal(JSON.parse(modelRequest.options.body).apiKey, '');

  elements.get('xiaomiAiTrigger').value = '猫猫';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiTrigger', matches: () => false },
  });
  timers.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  const saves = fetchCalls.filter(
    (call) => call.url === '/api/ai/config' && call.options.method === 'PUT',
  );
  assert.equal(saves.length, 1);
  const savedConfig = JSON.parse(saves[0].options.body);
  assert.equal(savedConfig.trigger, '猫猫');
  assert.equal(savedConfig.deepseekApiKey, undefined);
  assert.equal(savedConfig.qweatherApiKey, undefined);
  assert.equal(savedConfig.amapApiKey, undefined);

  elements.get('xiaomiAiDeepSeekKey').value = 'new-deepseek-key';
  listeners.get('form:input')({
    target: { id: 'xiaomiAiDeepSeekKey', matches: () => false },
  });
  timers.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  const savesWithNewKey = fetchCalls.filter(
    (call) => call.url === '/api/ai/config' && call.options.method === 'PUT',
  );
  assert.equal(savesWithNewKey.length, 2);
  const configWithNewKey = JSON.parse(savesWithNewKey[1].options.body);
  assert.equal(configWithNewKey.deepseekApiKey, 'new-deepseek-key');
  assert.equal(configWithNewKey.qweatherApiKey, undefined);
});
