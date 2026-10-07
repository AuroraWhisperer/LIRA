'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const entry = (name) => path.join(__dirname, '../../public/js/admin', name);
const plain = (value) => JSON.parse(JSON.stringify(value));

async function fixture() {
  const requests = [];
  const sync = await loadModuleExports(entry('component-settings-sync.js'));
  let socket;
  const window = { dispatchEvent(event) {
    if (event.type === 'app:settings-state') sync.receiveComponentSettings(event.detail);
  } };
  const adapter = await loadModuleExports(entry('component-settings-save.js'), {
    window,
    location: { protocol: 'http:', host: 'localhost' },
    document: { getElementById: () => ({ hidden: false }) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    WebSocket: class {
      constructor() { socket = this; this.listeners = new Map(); }
      addEventListener(type, listener) { this.listeners.set(type, listener); }
    },
    fetch(url, options) {
      const request = Promise.withResolvers();
      requests.push({ url, options, ...request });
      return request.promise;
    },
  });
  const { createComponentConfigController } = await loadModuleExports(entry('component-config-controller.js'));
  const controller = createComponentConfigController({
    initial: { fontSize: 24, color: '#ffffff' },
    persist: (_draft, changed) => adapter.saveComponentSettings(changed),
    confirm: adapter.confirmComponentSettings,
  });
  sync.registerComponentSettings('example', controller, (settings) => settings, (config) => config);
  window.AdminApp.state.connectSocket();
  const receive = (settings) => socket.listeners.get('message')({
    data: JSON.stringify({ type: 'snapshot', state: { settings } }),
  });
  const respond = (index, settings) => {
    const payload = { ok: true, data: { settings } };
    requests[index].resolve({ ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload });
  };
  return { controller, requests, receive, respond };
}

test('component settings confirmation uses the state owner and preserves a newer WS update during the read', async () => {
  const f = await fixture();
  f.controller.edit({ fontSize: 28 });
  const saving = f.controller.save();
  f.receive({ fontSize: 28, color: '#ffffff' });
  f.receive({ fontSize: 32, color: '#ff0000' });
  f.respond(0, { fontSize: 28, color: '#ffffff' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.requests.map(({ url }) => url), ['/api/settings', '/api/state']);
  f.controller.edit({ fontSize: 36 });
  f.receive({ fontSize: 40, color: '#00ff00' });
  f.respond(1, { fontSize: 32, color: '#ff0000' });
  assert.equal(await saving, false);
  assert.deepEqual(plain(f.controller.getState().saved), { fontSize: 40, color: '#00ff00' });
  assert.deepEqual(plain(f.controller.getState().draft), { fontSize: 36, color: '#00ff00' });
  assert.equal(f.requests.length, 2);
});

test('save feedback shows the concrete confirmation error instead of claiming drafts were retained', async () => {
  const { saveComponentWithFeedback } = await loadModuleExports(entry('component-save-feedback.js'));
  const messages = [];
  let saved = false;
  await saveComponentWithFeedback({
    getState: () => ({ loaded: true, dirty: !saved, generation: 0,
      error: saved ? '保存期间配置已在其他入口更新，请确认当前配置。' : '' }),
    save: async () => { saved = true; return false; },
  }, '时钟', (message, options) => messages.push({ message, options }));
  assert.equal(messages[0].message, '保存期间配置已在其他入口更新，请确认当前配置。');
  assert.equal(messages[0].options.type, 'error');
});
