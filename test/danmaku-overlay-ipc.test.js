const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');
const { createHarness } = require('./helpers/license-manager-harness');
const { createLicenseOperations } = require('../src/electron/license/license-operations');

test('license manager exposes authenticated overlay operations without leaking bearer data', async () => {
  const { manager, remote } = createHarness({ identity: { deviceId: 'd', streamerId: 1, publicKeyPem: 'public' } });
  const calls = [];
  const settings = {
    style: 'identity',
    fullscreenDurationSeconds: 8,
    overlayUrl: 'https://test.example/overlay/syntheticKey_123',
  };
  remote.getOverlaySettings = async (token) => {
    calls.push(token);
    return { ...settings, accessToken: token };
  };
  remote.updateOverlaySettings = async (value, token) => {
    calls.push(token);
    return { ...value, overlayUrl: settings.overlayUrl, accessToken: token };
  };
  try {
    await manager.bootstrap();
    assert.deepEqual(await manager.getOverlaySettings(), settings);
    assert.deepEqual(await manager.updateOverlaySettings(settings), settings);
    assert.deepEqual(calls, ['token', 'token']);
  } finally {
    manager.dispose();
  }
});

test('overlay operations reject late responses and retry callbacks after ownership changes', async () => {
  let owner = 'one';
  let resolve, retryOperation;
  const calls = [];
  const operations = createLicenseOperations({
    remote: {
      updateOverlaySettings: (value, token) => {
        calls.push({ value, token });
        return new Promise((done) => {
          resolve = done;
        });
      },
    },
    getOverlayOwner: () => owner,
    isDisposed: () => false,
    withAuthorizedToken: (operation) => {
      retryOperation = operation;
      return operation('token-one');
    },
  });
  const pending = operations.updateOverlaySettings({ style: 'outline', fullscreenDurationSeconds: 8 });
  owner = 'two';
  resolve({ style: 'outline' });
  await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
  await assert.rejects(retryOperation('token-two'), { code: 'LICENSE_NOT_AUTHORIZED' });
  assert.equal(calls.length, 1);
});

test('overlay IPC gates sender, validates parameters and allowlists the server response', async () => {
  const handlers = new Map(),
    writes = [];
  const webContents = {};
  const event = { sender: webContents, senderFrame: { url: 'http://127.0.0.1:3000/admin' } };
  let reply = {
    style: 'outline',
    fullscreenDurationSeconds: 12,
    overlayUrl: 'https://test.example/overlay/syntheticKey_123',
    token: 'secret',
    cookie: 'private',
    streamerId: 33,
  };
  registerLicenseIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    licenseManager: {
      getState: () => 'authorized',
      onStateChanged: () => () => {},
      getOverlaySettings: async () => reply,
      updateOverlaySettings: async (settings) => {
        writes.push(settings);
        return reply;
      },
    },
    getMainWindow: () => ({ webContents }),
    getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
    hasExactOrigin: (value, expected) => new URL(value).origin === expected,
  });
  const read = handlers.get('license:get-overlay-settings');
  const update = handlers.get('license:update-overlay-settings');
  assert.equal((await update({ ...event, sender: {} }, reply)).error, 'IPC_SOURCE_INVALID');
  for (const duration of [1, 31, 1.5, '6', null, true]) {
    assert.equal(
      (await update(event, { style: 'outline', fullscreenDurationSeconds: duration })).error,
      'INVALID_OVERLAY_DURATION',
    );
  }
  assert.equal(
    (await update(event, { style: 'unknown', fullscreenDurationSeconds: 6 })).error,
    'INVALID_OVERLAY_STYLE',
  );
  assert.equal(writes.length, 0);
  const expected = {
    ok: true,
    style: 'outline',
    fullscreenDurationSeconds: 12,
    overlayUrl: 'https://test.example/overlay/syntheticKey_123',
  };
  assert.deepEqual(await read(event), expected);
  assert.deepEqual(await update(event, reply), expected);
  assert.deepEqual(writes, [{ style: 'outline', fullscreenDurationSeconds: 12 }]);
  for (const style of ['cream', 'glow']) {
    reply = { ...reply, style };
    assert.deepEqual(await read(event), { ...expected, style });
    assert.deepEqual(await update(event, reply), { ...expected, style });
    assert.deepEqual(writes.at(-1), { style, fullscreenDurationSeconds: 12 });
  }
  for (const overlayUrl of [
    'https://test.example/overlay',
    'https://test.example/overlay/short',
    'https://test.example/overlay/syntheticKey_123?token=secret',
  ]) {
    reply = { ...reply, overlayUrl };
    assert.equal((await read(event)).error, 'INVALID_RESPONSE');
  }
  const styleOptions = { cream: { fontSize: 24, fontFamily: 'kai', backgroundOpacity: 0, giftImage: 'gift' } };
  reply = { ...expected, style: 'cream', styleOptions, token: 'private' };
  assert.deepEqual(await update(event, reply), { ...expected, style: 'cream', styleOptions });
  assert.deepEqual(writes.at(-1), { style: 'cream', fullscreenDurationSeconds: 12, styleOptions });
  const count = writes.length;
  assert.equal(
    (await update(event, { ...reply, styleOptions: { cream: { fontSize: 41 } } })).error,
    'INVALID_OVERLAY_OPTIONS',
  );
  assert.equal(writes.length, count);
  reply = { ...reply, styleOptions: { cream: { cookie: 'private' } } };
  assert.equal((await read(event)).error, 'INVALID_OVERLAY_OPTIONS');
});

test('remote overlay settings use the fixed Device endpoints and bearer stays in main', async () => {
  const calls = [];
  const client = createRemoteLicenseClient({
    baseUrl: 'https://api.example.test',
    isProduction: true,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  await client.getOverlaySettings('test-token');
  await client.updateOverlaySettings({ style: 'identity', fullscreenDurationSeconds: 8 }, 'test-token');
  assert.deepEqual(
    calls.map(({ init }) => init.method),
    ['GET', 'PUT'],
  );
  for (const call of calls) {
    assert.equal(call.url, 'https://api.example.test/api/device/overlay-settings');
    assert.equal(call.init.headers.Authorization, 'Bearer test-token');
  }
  assert.deepEqual(JSON.parse(calls[1].init.body), { style: 'identity', fullscreenDurationSeconds: 8 });
});
