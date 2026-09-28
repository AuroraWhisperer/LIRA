'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createDesktopUpdateController } = require('../../src/electron/desktop-update-controller');

test('preload exposes argument-free calls and removable state subscriptions only', () => {
  const bridges = {};
  const invoked = [];
  const listeners = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8'), {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (name, bridge) => {
          bridges[name] = bridge;
        },
      },
      ipcRenderer: {
        invoke: (...args) => invoked.push(args),
        on: (name, fn) => listeners.set(name, fn),
        removeListener: (name, fn) => {
          assert.equal(listeners.get(name), fn);
          listeners.delete(name);
        },
      },
    }),
  });
  const bridge = bridges.songAssistantDesktop;
  bridge.checkResourceIntegrity('ignored');
  bridge.getResourceIntegrityState('ignored');
  assert.deepEqual(invoked, [['desktop:check-resource-integrity'], ['desktop:get-resource-integrity-state']]);
  let received;
  const dispose = bridge.onResourceIntegrityState((state) => {
    received = state;
  });
  listeners.get('desktop:resource-integrity-state')({ privileged: true }, { revision: 1 });
  assert.deepEqual(received, { revision: 1 });
  dispose();
  assert.equal(listeners.size, 0);
});

test('update installation drains resource checking first without stopping scans for download or invalid install', async () => {
  const drain = Promise.withResolvers();
  const calls = [];
  const updateRuntime = { value: { canInstall: false } };
  const controller = createDesktopUpdateController({
    updateRuntime,
    beforeInstall: () => {
      calls.push('stop');
      return drain.promise;
    },
    updateManager: { installUpdate: () => calls.push('install'), downloadUpdate: () => calls.push('download') },
  });
  await controller.installUpdate();
  controller.downloadUpdate();
  assert.deepEqual(calls, ['install', 'download']);
  updateRuntime.value.canInstall = true;
  const pending = controller.installUpdate();
  assert.deepEqual(calls, ['install', 'download', 'stop']);
  drain.resolve();
  await pending;
  assert.deepEqual(calls, ['install', 'download', 'stop', 'install']);
});
