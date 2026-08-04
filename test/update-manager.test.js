'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

test('logs successful updater state boundaries without progress noise', () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const modulePath = require.resolve('../src/electron/update-manager');
  const logs = [];
  const updater = new EventEmitter();

  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') {
        return { app: { getVersion: () => '3.0.4', isPackaged: true } };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[modulePath];
    const updateManager = require(modulePath);
    updateManager.configureAutoUpdater({
      updater,
      onStateChange() {},
      writeLog: (scope, value) => logs.push({ scope, value })
    });

    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '3.1.0' });
    updater.emit('download-progress', { percent: 50, transferred: 5, total: 10 });
    updater.emit('update-downloaded', { version: '3.1.0' });

    assert.deepEqual(logs, [
      { scope: 'update', value: { event: 'checking' } },
      { scope: 'update', value: { event: 'available', version: '3.1.0' } },
      { scope: 'update', value: { event: 'downloaded', version: '3.1.0' } }
    ]);
  } finally {
    delete require.cache[modulePath];
    Module._load = originalLoad;
  }
});
