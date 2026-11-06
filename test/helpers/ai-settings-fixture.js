'use strict';

const path = require('node:path');
const { readAdminFragmentHtml } = require('./admin-html');
const { loadModuleExports } = require('./frontend-modules');
const { BUILT_IN_PERSONAS } = require('../../src/ai/personas');

const flushAiTasks = () => new Promise((resolve) => setImmediate(resolve));
const aiResponse = (data) => ({
  ok: true,
  json: async () => ({ ok: true, data }),
});

async function createAiSettingsFixture({ config = {}, deferInitialConfig = false, request, confirm = async () => true, visible = true } = {}) {
  const publicConfig = {
    enabled: false,
    trigger: '小米',
    deepseekResponsesUrl: 'https://api.example.com/responses',
    modelProvider: 'custom',
    modelApiProtocol: 'responses',
    model: 'deepseek-v4-flash',
    webSearchEnabled: true,
    functionCallingEnabled: false,
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
    contextTtlSeconds: 600,
    systemPrompt: '这是一个长度足够的测试人格预设。',
    personaId: 'custom',
    hasCustomPersona: true,
    personas: BUILT_IN_PERSONAS.map((persona) => ({ ...persona, builtin: true })),
    weatherEnabled: false,
    placesEnabled: false,
    routesEnabled: false,
    hasDeepSeekApiKey: true,
    hasQWeatherApiKey: false,
    hasAmapApiKey: false,
    ...config,
  };
  const elements = new Map();
  const downloads = [];
  function createElement(tagName, id = '') {
    return {
      id,
      tagName,
      value: '',
      placeholder: '',
      type: 'text',
      checked: false,
      hidden: false,
      textContent: '',
      className: '',
      disabled: false,
      focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; },
      click() {
        if (tagName === 'a') downloads.push({ href: this.href, name: this.download });
      },
      append() {},
      remove() {},
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
        return selector.includes(`input[type="${this.type}"]`) || (tagName === 'select' && selector.includes('select'));
      },
      parentElement: {
        after(node) {
          elements.set(node.id, node);
        },
      },
    };
  }
  const html = readAdminFragmentHtml('pages/admin/toolbox/danmaku-ai.html');
  for (const [tag, tagName, id] of html.matchAll(/<(\w+)\b[^>]*\bid="(xiaomiAi[^"]+)"[^>]*>/g)) {
    const element = createElement(tagName, id);
    element.type = tag.match(/\btype="([^"]+)"/)?.[1] || 'text';
    element.value = tag.match(/\bvalue="([^"]*)"/)?.[1] || '';
    element.placeholder = tag.match(/\bplaceholder="([^"]*)"/)?.[1] || '';
    element.checked = /\bchecked\b/.test(tag);
    element.hidden = /\bhidden\b/.test(tag);
    elements.set(id, element);
  }
  const calls = [];
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  let resolveInitialConfig;
  const initialConfig = new Promise((resolve) => {
    resolveInitialConfig = resolve;
  });
  if (!deferInitialConfig) resolveInitialConfig(aiResponse(publicConfig));
  const windowEvents = new Map();
  const documentEvents = new Map();
  const observers = new Set();
  const visibility = { pageActive: true, panelHidden: !visible, documentHidden: false };
  const page = { classList: { contains: (name) => name === 'active' && visibility.pageActive } };
  const panel = { get hidden() { return visibility.panelHidden; } };
  elements.set('otherAssistantPage', page);
  elements.set('otherDanmakuFeature', panel);
  elements.get('xiaomiAiForm').closest = (selector) => selector === '[hidden]' && panel.hidden ? panel : null;
  const window = {
    addEventListener: (type, handler) => windowEvents.set(type, handler),
  };
  const documentRef = {
    hidden: false, getElementById: (id) => elements.get(id), createElement, body: createElement('body'),
    addEventListener: (type, handler) => documentEvents.set(type, handler),
    removeEventListener: (type, handler) => {
      if (documentEvents.get(type) === handler) documentEvents.delete(type);
    },
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = new Map(); observers.add(this); }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { observers.delete(this); }
  }
  const { aiAssistantSettings: api } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/ai-assistant-settings.js'),
    {
      window,
      Blob,
      URL,
      document: documentRef,
      MutationObserver,
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
        return aiResponse(url === '/api/ai/status' ? { queued: 0 } : publicConfig);
      },
      setTimeout(handler, delay) {
        timers.set(++timerId, { handler, at: clock + delay });
        return timerId;
      },
      clearTimeout: (id) => timers.delete(id),
      setInterval(handler, delay) {
        timers.set(++timerId, { handler, at: clock + delay, interval: delay });
        return timerId;
      },
      clearInterval: (id) => timers.delete(id),
    },
  );
  api.init({ notify: () => {}, confirm });
  await flushAiTasks();

  return {
    elements,
    calls,
    timers,
    publicConfig,
    downloads,
    api,
    async setVisibility(changes) {
      const mutations = [];
      if (changes.pageActive !== undefined && changes.pageActive !== visibility.pageActive)
        mutations.push({ target: page, attributeName: 'class' });
      if (changes.panelHidden !== undefined && changes.panelHidden !== visibility.panelHidden)
        mutations.push({ target: panel, attributeName: 'hidden' });
      const documentChanged = changes.documentHidden !== undefined && changes.documentHidden !== visibility.documentHidden;
      Object.assign(visibility, changes);
      documentRef.hidden = visibility.documentHidden;
      for (const observer of observers) {
        if (mutations.some(({ target, attributeName }) => observer.targets.get(target)?.attributeFilter.includes(attributeName))) {
          queueMicrotask(() => { if (observers.has(observer)) observer.callback(mutations); });
        }
      }
      if (documentChanged) documentEvents.get('visibilitychange')?.();
      await flushAiTasks();
    },
    pagehide() { windowEvents.get('pagehide')?.(); },
    resolveInitialConfig: () => resolveInitialConfig(aiResponse(publicConfig)),
    saves: () =>
      calls
        .filter(({ url, options }) => url === '/api/ai/config' && options.method === 'PUT')
        .map(({ options }) => JSON.parse(options.body)),
    fire(id, type, event = {}) {
      return elements.get(id).listeners[type](event);
    },
    input(id, value) {
      const target = elements.get(id);
      target.value = value;
      target.listeners.input?.({ target });
      if (!['xiaomiAiPersonaName', 'xiaomiAiPersonaDescription', 'xiaomiAiPersonaPrompt'].includes(id)) {
        elements.get('xiaomiAiForm').listeners.input({ target });
      }
    },
    async advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > clock || !timers.has(id)) continue;
        if (timer.interval) timer.at = clock + timer.interval;
        else timers.delete(id);
        timer.handler();
      }
      await flushAiTasks();
    },
  };
}

module.exports = { createAiSettingsFixture, flushAiTasks, aiResponse };
