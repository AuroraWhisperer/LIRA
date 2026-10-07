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

test('automatic updates are enabled only by the exact stored setting and never by a failing runtime', () => {
  for (const [name, getRuntime, expected] of [
    ['enabled', () => ({ getSetting: (key) => (key === 'enableAutoUpdate' ? 'true' : 'false') }), true],
    ['disabled', () => ({ getSetting: () => 'false' }), false],
    ['boolean true is not the stored string', () => ({ getSetting: () => true }), false],
    ['no runtime yet', () => null, false],
    ['runtime without settings', () => ({}), false],
    [
      'runtime lookup throws',
      () => {
        throw new Error('runtime closed');
      },
      false,
    ],
    [
      'setting read throws',
      () => ({
        getSetting() {
          throw new Error('database closed');
        },
      }),
      false,
    ],
  ]) {
    const controller = createDesktopUpdateController({ updateRuntime: { value: {} }, getRuntime });
    assert.equal(controller.readAutoUpdateSetting(), expected, name);
  }
});

test('update state reaches only a live window and opens the update page once per available transition', () => {
  const updateRuntime = { value: { status: 'idle' }, lastStatus: undefined };
  let mainWindow = null;
  const controller = createDesktopUpdateController({ updateRuntime, getMainWindow: () => mainWindow });

  controller.sendUpdateState();
  mainWindow = createWindow();
  mainWindow.destroyed = true;
  controller.sendUpdateState();
  assert.deepEqual(mainWindow.sent, []);
  assert.equal(updateRuntime.lastStatus, undefined, 'a missing window must not consume the transition');

  mainWindow = createWindow();
  const pages = () => mainWindow.sent.filter(([channel]) => channel === 'desktop:show-update-page').length;
  const states = () => mainWindow.sent.filter(([channel]) => channel === 'desktop:update-state').length;
  for (const [status, expectedPages] of [
    ['available', 1],
    ['available', 1],
    ['downloading', 1],
    ['downloaded', 2],
    ['downloaded', 2],
    ['error', 2],
  ]) {
    updateRuntime.value = { status };
    controller.sendUpdateState();
    assert.equal(pages(), expectedPages, status);
  }
  assert.equal(states(), 6, 'every state is delivered even without a transition');
  assert.deepEqual(mainWindow.sent.at(-1), ['desktop:update-state', { status: 'error' }]);
});

test('update errors are logged and disable download and install with the running version', () => {
  const logs = [];
  const error = new Error('signature mismatch');
  const mainWindow = createWindow();
  const updateRuntime = { value: { status: 'downloaded', canDownload: true, canInstall: true, extra: 'kept' } };
  const controller = createDesktopUpdateController({
    app: { getVersion: () => '9.9.9' },
    updateRuntime,
    getMainWindow: () => mainWindow,
    writeLog: (...args) => logs.push(args),
    updateManager: {
      friendlyUpdateError: (value) => {
        assert.equal(value, error);
        return { status: 'error', message: 'friendly message' };
      },
    },
  });

  controller.setUpdateError(error);

  assert.deepEqual(logs, [['update-error', error]]);
  assert.deepEqual(updateRuntime.value, {
    status: 'error',
    message: 'friendly message',
    canDownload: false,
    canInstall: false,
    extra: 'kept',
    version: '9.9.9',
  });
  assert.deepEqual(mainWindow.sent, [['desktop:update-state', updateRuntime.value]]);
});
