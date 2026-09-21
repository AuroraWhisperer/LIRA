'use strict';

const path = require('node:path');
const { readAdminHtml } = require('./admin-html');
const { loadModuleExports } = require('./frontend-modules');

const flushAiTasks = () => new Promise((resolve) => setImmediate(resolve));
const aiResponse = (data) => ({
  ok: true,
  json: async () => ({ ok: true, data }),
});

async function createAiSettingsFixture({
  config = {},
  deferInitialConfig = false,
  request,
} = {}) {
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
    userCooldownSeconds: 0,
    roomLimitPerMinute: 20,
    systemPrompt: '这是一个长度足够的测试人格预设。',
    hasDeepSeekApiKey: true,
    hasQWeatherApiKey: false,
    hasAmapApiKey: false,
    ...config,
  };
  const elements = new Map();
  function createElement(tagName, id = '') {
    return {
      id,
      tagName,
      value: '',
      type: 'text',
      checked: false,
      hidden: false,
      textContent: '',
      className: '',
      disabled: false,
      attributes: {},
      listeners: {},
      children: [],
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
      replaceChildren(...children) {
        this.children = children;
      },
      checkValidity: () => true,
      reportValidity: () => true,
      matches(selector) {
        return (
          selector.includes(`input[type="${this.type}"]`) ||
          (tagName === 'select' && selector.includes('select'))
        );
      },
      parentElement: {
        after(node) {
          elements.set(node.id, node);
        },
      },
    };
  }
  for (const [tag, tagName, id] of readAdminHtml().matchAll(
    /<(\w+)\b[^>]*\bid="(xiaomiAi[^"]+)"[^>]*>/g,
  )) {
    const element = createElement(tagName, id);
    element.type = tag.match(/\btype="([^"]+)"/)?.[1] || 'text';
    element.value = tag.match(/\bvalue="([^"]*)"/)?.[1] || '';
    element.checked = /\bchecked\b/.test(tag);
    element.hidden = /\bhidden\b/.test(tag);
    elements.set(id, element);
  }
  const calls = [];
  const toasts = [];
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  let resolveInitialConfig;
  const initialConfig = new Promise((resolve) => {
    resolveInitialConfig = resolve;
  });
  if (!deferInitialConfig) resolveInitialConfig(aiResponse(publicConfig));
  const window = {};
  const { aiAssistantSettings: api } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/ai-assistant-settings.js'),
    {
      window,
      document: { getElementById: (id) => elements.get(id), createElement },
      fetch: async (url, options = {}) => {
        calls.push({ url, options });
        const override = request?.(url, options);
        if (override !== undefined) return override;
        if (url === '/api/ai/config' && !options.method) return initialConfig;
        if (url === '/api/ai/models')
          return aiResponse({
            models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
          });
        if (url === '/api/ai/test/deepseek')
          return aiResponse({
            provider: 'deepseek',
            model: 'deepseek-chat',
            reply: '你好！有什么可以帮你？',
            endpointAdapted: true,
          });
        return aiResponse(
          url === '/api/ai/status' ? { queued: 0 } : publicConfig,
        );
      },
      setTimeout(handler, delay) {
        timers.set(++timerId, { handler, at: clock + delay });
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  api.init({ notify: (value) => toasts.push(value) });
  await flushAiTasks();

  return {
    elements,
    calls,
    toasts,
    publicConfig,
    api,
    resolveInitialConfig: () => resolveInitialConfig(aiResponse(publicConfig)),
    saves: () =>
      calls
        .filter(
          ({ url, options }) =>
            url === '/api/ai/config' && options.method === 'PUT',
        )
        .map(({ options }) => JSON.parse(options.body)),
    fire(id, type, event = {}) {
      return elements.get(id).listeners[type](event);
    },
    input(id, value) {
      const target = elements.get(id);
      target.value = value;
      elements.get('xiaomiAiForm').listeners.input({ target });
    },
    async advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > clock || !timers.delete(id)) continue;
        timer.handler();
      }
      await flushAiTasks();
    },
  };
}

module.exports = { createAiSettingsFixture, flushAiTasks, aiResponse };
