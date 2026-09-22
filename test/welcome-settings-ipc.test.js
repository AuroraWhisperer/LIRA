const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');
const { createLicenseOperations } = require('../src/electron/license/license-operations');
const { createHarness } = require('./helpers/license-manager-harness');

test('welcome requests use fixed authenticated endpoints and the license manager', async () => {
  const calls = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    isProduction: true,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  await client.getWelcomeSettings('synthetic');
  await client.updateWelcomeSettings({ enabled: true }, 'synthetic');
  assert.deepEqual(
    calls.map(({ init }) => init.method),
    ['GET', 'PUT'],
  );
  for (const { url, init } of calls) {
    assert.equal(url, 'https://api.example.test/api/device/welcome-settings');
    assert.equal(init.headers.Authorization, 'Bearer synthetic');
  }
  assert.deepEqual(JSON.parse(calls[1].init.body), { enabled: true });
  const { manager, remote } = createHarness({ identity: { deviceId: 'd', streamerId: 1, publicKeyPem: 'public' } });
  const settings = { enabled: false, messages: ['欢迎 {username}'] };
  remote.getWelcomeSettings = async () => ({ ...settings, accessToken: 'private' });
  remote.updateWelcomeSettings = async (patch) => ({ ...settings, ...patch });
  try {
    await manager.bootstrap();
    assert.deepEqual(await manager.getWelcomeSettings(), settings);
    assert.deepEqual(await manager.updateWelcomeSettings({ enabled: true }), { ...settings, enabled: true });
  } finally {
    manager.dispose();
  }
});

test('welcome IPC requires the main window and validates patches before any write', async () => {
  const handlers = new Map(),
    writes = [],
    webContents = {};
  const event = { sender: webContents, senderFrame: { url: 'http://127.0.0.1:3000/admin' } };
  const reply = { enabled: true, messages: ['欢迎 {username}'], cookie: 'private', streamerId: 2 };
  registerLicenseIpc({
    ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    licenseManager: {
      getState: () => 'authorized',
      onStateChanged: () => () => {},
      getWelcomeSettings: async () => reply,
      updateWelcomeSettings: async (patch) => {
        writes.push(patch);
        return reply;
      },
    },
    getMainWindow: () => ({ webContents }),
    getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
    hasExactOrigin: (url, origin) => new URL(url).origin === origin,
  });
  const read = handlers.get('license:get-welcome-settings'),
    write = handlers.get('license:update-welcome-settings');
  assert.equal((await read({ ...event, sender: {} })).error, 'IPC_SOURCE_INVALID');
  assert.equal(
    (await write({ ...event, senderFrame: { url: 'https://other.example' } }, { enabled: true })).error,
    'IPC_SOURCE_INVALID',
  );
  for (const patch of [
    null,
    {},
    [],
    { enabled: 'true' },
    { enabled: true, streamerId: 2 },
    { messages: [] },
    { messages: Array(31).fill('Hi') },
    { messages: ['x'.repeat(81)] },
    { messages: ['x\ny'] },
  ]) {
    assert.match((await write(event, patch)).error, /^INVALID_WELCOME_/);
  }
  assert.equal(writes.length, 0);
  const expected = { ok: true, enabled: true, messages: ['欢迎 {username}'] };
  assert.deepEqual(await read(event), expected);
  assert.deepEqual(await write(event, { enabled: true }), expected);
  await write(event, { messages: [' 新词 {username} '] });
  assert.deepEqual(writes, [{ enabled: true }, { messages: ['新词 {username}'] }]);
});

test('welcome writes reject old-account responses and retries after account changes', async () => {
  let owner = 'one',
    resolve,
    retry;
  const calls = [];
  const operations = createLicenseOperations({
    remote: {
      updateWelcomeSettings: (patch, token) => {
        calls.push(token);
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
    getOverlayOwner: () => owner,
    isDisposed: () => false,
    withAuthorizedToken: (operation) => {
      retry = operation;
      return operation('one-token');
    },
  });
  const pending = operations.updateWelcomeSettings({ enabled: true });
  owner = 'two';
  resolve({ enabled: true, messages: ['Hi'] });
  await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
  await assert.rejects(retry('two-token'), { code: 'LICENSE_NOT_AUTHORIZED' });
  assert.deepEqual(calls, ['one-token']);
});
