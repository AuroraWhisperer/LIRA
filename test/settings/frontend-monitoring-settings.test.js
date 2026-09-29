'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('monitoring switches save one field, prevent overlapping clicks and restore failed changes', async () => {
  const elements = new Map();
  const requests = [];
  const settings = { danmakuMonitoringEnabled: 'true', giftMonitoringEnabled: 'true' };
  let pending;
  const { createSettingsForm } = await loadModuleExports(path.resolve('public/js/admin/settings-form.js'));
  const documentRef = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        checked: true, disabled: false, listeners: {},
        addEventListener(type, listener) {
          assert.equal(this.listeners[type], undefined);
          this.listeners[type] = listener;
        },
      });
      return elements.get(id);
    },
  };
  const form = createSettingsForm({
    documentRef, value: () => '', toast() {},
    api: async (_url, values) => {
      requests.push({ ...values });
      await pending.promise;
      Object.assign(settings, values);
    },
    getState: () => ({ getAppState: () => ({ settings }), reloadState: async () => {} }),
    initLicenseAccountDevice: async () => {}, blindboxSettings: { init() {} },
  });
  await form.init();
  for (const key of Object.keys(settings)) {
    const toggle = elements.get(key);
    pending = Promise.withResolvers();
    toggle.checked = false;
    const saving = toggle.listeners.change({ target: toggle });
    assert.equal(toggle.disabled, true);
    assert.deepEqual(requests.at(-1), { [key]: 'false' });
    pending.resolve();
    await saving;
    assert.equal(toggle.disabled, false);
    assert.equal(settings[key], 'false');
    pending = Promise.withResolvers();
    toggle.checked = true;
    const failed = toggle.listeners.change({ target: toggle });
    pending.reject(new Error('offline'));
    await failed;
    assert.equal(toggle.checked, false);
    assert.equal(toggle.disabled, false);
  }
  assert.equal(requests.length, 4);
});
