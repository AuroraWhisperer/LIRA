'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDesktopUpdateController } = require('../../src/electron/desktop-update-controller');

function createWindow() {
  const sent = [];
  return {
    sent,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    webContents: { send: (channel, payload) => sent.push(payload === undefined ? [channel] : [channel, payload]) },
  };
}

function createController(options = {}) {
  let publish;
  const controller = createDesktopUpdateController({
    getMainWindow: () => null,
    ...options,
    updateManager: {
      configureAutoUpdater({ onStateChange }) { publish = onStateChange; },
      ...options.updateManager,
    },
  });
  controller.configureAutoUpdater();
  return { controller, publish: value => publish(value) };
}

test('update installation drains resource checking first without stopping scans for download or invalid install', async () => {
  const drain = Promise.withResolvers();
  const calls = [];
  const { controller, publish } = createController({
    beforeInstall: () => {
      calls.push('stop');
      return drain.promise;
    },
    updateManager: { installUpdate: () => calls.push('install'), downloadUpdate: () => calls.push('download') },
  });
  await controller.installUpdate();
  controller.downloadUpdate();
  assert.deepEqual(calls, ['install', 'download']);
  publish({ canInstall: true });
  const pending = controller.installUpdate();
  assert.deepEqual(calls, ['install', 'download', 'stop']);
  drain.resolve();
  await pending;
  assert.deepEqual(calls, ['install', 'download', 'stop', 'install']);
});

test('automatic updates are enabled only by the exact stored setting and never by a failing runtime', () => {
  for (const [name, getAutoUpdateSetting, expected] of [
    ['enabled', () => 'true', true],
    ['disabled', () => 'false', false],
    ['no runtime yet', () => null, false],
    [
      'setting read throws',
      () => { throw new Error('database closed'); },
      false,
    ],
  ]) {
    const controller = createDesktopUpdateController({ getAutoUpdateSetting });
    assert.equal(controller.readAutoUpdateSetting(), expected, name);
  }
});

test('update state reaches only a live window without forcing navigation', () => {
  let mainWindow = null;
  const { controller, publish } = createController({ getMainWindow: () => mainWindow });

  controller.sendUpdateState();
  mainWindow = createWindow();
  mainWindow.destroyed = true;
  controller.sendUpdateState();
  assert.deepEqual(mainWindow.sent, []);

  mainWindow = createWindow();
  const pages = () => mainWindow.sent.filter(([channel]) => channel === 'desktop:show-update-page').length;
  const states = () => mainWindow.sent.filter(([channel]) => channel === 'desktop:update-state').length;
  for (const status of ['available', 'available', 'downloaded', 'error']) {
    publish({ status });
    assert.equal(pages(), 0, status);
  }
  assert.equal(states(), 4, 'every state is delivered even without a transition');
  assert.deepEqual(mainWindow.sent.at(-1), ['desktop:update-state', { status: 'error' }]);
});

test('update errors are logged and disable download and install with the running version', () => {
  const logs = [];
  const error = new Error('signature mismatch');
  const mainWindow = createWindow();
  const { controller, publish } = createController({
    app: { getVersion: () => '9.9.9' },
    getMainWindow: () => mainWindow,
    writeLog: (...args) => logs.push(args),
    updateManager: {
      friendlyUpdateError: () => ({ status: 'error', message: 'friendly message' }),
    },
  });
  publish({ status: 'downloaded', canDownload: true, canInstall: true, progress: { percent: 100 }, extra: 'kept' });
  mainWindow.sent.length = 0;

  controller.setUpdateError(error);

  assert.deepEqual(logs, [['update-error', error]]);
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().canDownload, false);
  assert.equal(controller.getState().canInstall, false);
  assert.equal(controller.getState().version, '9.9.9');
  assert.deepEqual(mainWindow.sent, [['desktop:update-state', controller.getState()]]);
});

test('disposing the update owner cancels its delayed startup check', () => {
  const pending = new Map();
  let checks = 0;
  const { controller } = createController({
    app: { isPackaged: true },
    getAutoUpdateSetting: () => 'true',
    updateManager: { checkForUpdates: async () => { checks++; } },
    timers: {
      setTimeout(callback) { pending.set(callback, callback); return callback; },
      clearTimeout(handle) { pending.delete(handle); },
    },
  });
  controller.scheduleStartupCheck();
  controller.scheduleStartupCheck();
  assert.equal(pending.size, 1);
  controller.dispose();
  controller.scheduleStartupCheck();
  for (const callback of pending.values()) callback();
  assert.equal(checks, 0);
});
