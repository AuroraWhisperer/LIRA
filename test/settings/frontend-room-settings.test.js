'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('room drafts survive unrelated snapshots and saves until the submitted edit succeeds', async () => {
  const elements = new Map();
  const requests = [];
  let pending;
  const documentRef = {
    activeElement: null,
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        id, value: '', dataset: {}, listeners: {}, validity: { valid: true },
        closest: () => null,
        setAttribute() {},
        addEventListener(type, listener) { this.listeners[type] = listener; },
      });
      return elements.get(id);
    },
  };
  const [{ createSettingsForm }, { fillSettings }] = await Promise.all([
    'settings-form.js', 'state-renderer.js',
  ].map(file => loadModuleExports(path.resolve('public/js/admin', file), {
    document: documentRef, window: {},
  })));
  const form = createSettingsForm({
    documentRef,
    value: id => documentRef.getElementById(id).value,
    api: (_url, values) => { requests.push(values); return pending.promise; },
    toast() {},
    getState: () => ({ reloadState: async () => {} }),
    initLicenseAccountDevice: async () => {},
    blindboxSettings: { init() {} },
  });
  await form.init();
  fillSettings({ roomId: '111111', giftMonitoringEnabled: 'true' });
  const room = elements.get('roomId');
  const edit = value => {
    documentRef.activeElement = room;
    room.value = value;
    room.listeners.input?.({ target: room });
    documentRef.activeElement = null;
  };
  const submit = () => elements.get('settingsForm').listeners.submit({ preventDefault() {} });

  edit('222222');
  fillSettings({ roomId: '111111', giftMonitoringEnabled: 'false' });
  assert.equal(room.value, '222222', 'an unrelated snapshot must retain the blurred room draft');

  pending = Promise.withResolvers();
  const saving = submit();
  assert.equal(requests.at(-1).roomId, '222222');
  edit('333333');
  pending.resolve({ data: { settings: { roomId: '222222' } } });
  await saving;
  fillSettings({ roomId: '222222' });
  assert.equal(room.value, '333333', 'an earlier save cannot release the newer draft');

  pending = Promise.withResolvers();
  const failed = submit();
  pending.reject(new Error('save failed'));
  await assert.rejects(failed, /save failed/);
  fillSettings({ roomId: '222222' });
  assert.equal(room.value, '333333', 'a failed save must retain the draft');

  pending = Promise.withResolvers();
  const retrying = submit();
  pending.resolve({ data: { settings: { roomId: '333333' } } });
  await retrying;
  fillSettings({ roomId: '444444' });
  assert.equal(room.value, '444444', 'a successful matching save restores snapshot hydration');
});
