const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');
const { createLicenseOperations } = require('../src/electron/license/license-operations');
const { createHarness } = require('./helpers/license-manager-harness');
const fixture = require('./fixtures/pk-report-settings.json');

test('PK settings use fixed authenticated endpoints and manager projection', async () => {
  const calls = [];
  const client = createRemoteLicenseClient({ baseUrl: 'https://api.example.test', isProduction: true,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '{}' }; },
  });
  await client.getPkReportSettings('synthetic');
  await client.updatePkReportSettings({ enabled: true }, 'synthetic');
  assert.deepEqual(calls.map(({ init }) => init.method), ['GET', 'PUT']);
  for (const { url, init } of calls) {
    assert.equal(url, 'https://api.example.test/api/device/pk-report-settings');
    assert.equal(init.headers.Authorization, 'Bearer synthetic');
  }
  assert.deepEqual(JSON.parse(calls[1].init.body), { enabled: true });
  const { manager, remote } = createHarness({ identity: { deviceId: 'd', streamerId: 1, publicKeyPem: 'public' } });
  remote.getPkReportSettings = async () => ({ ...fixture.defaultResponse, cookie: 'private' });
  remote.updatePkReportSettings = async (patch) => ({ ok: true, ...patch });
  try {
    await manager.bootstrap();
    assert.deepEqual(await manager.getPkReportSettings(), fixture.defaultResponse);
    assert.deepEqual(await manager.updatePkReportSettings({ enabled: true }), fixture.response);
  } finally { manager.dispose(); }
});

test('PK IPC rejects foreign windows/invalid inputs and strips unsolicited server data', async () => {
  const handlers = new Map(), writes = [], webContents = {};
  const event = { sender: webContents, senderFrame: { url: 'http://127.0.0.1:3000/admin' } };
  let response = { ...fixture.response, cookie: 'private', streamerId: 2 };
  registerLicenseIpc({ ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    licenseManager: { getState: () => 'authorized', onStateChanged: () => () => {},
      getPkReportSettings: async () => response,
      updatePkReportSettings: async (patch) => { writes.push(patch); return response; } },
    getMainWindow: () => ({ webContents }), getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
    hasExactOrigin: (url, origin) => new URL(url).origin === origin,
  });
  const read = handlers.get('license:get-pk-report-settings'), write = handlers.get('license:update-pk-report-settings');
  assert.equal((await read({ ...event, sender: {} })).error, 'IPC_SOURCE_INVALID');
  assert.equal((await write({ ...event, senderFrame: { url: 'https://other.example' } }, { enabled: true })).error, 'IPC_SOURCE_INVALID');
  for (const patch of fixture.invalidUpdates)
    assert.equal((await write(event, patch)).error, 'INVALID_PK_REPORT_SETTINGS');
  assert.equal(writes.length, 0);
  assert.deepEqual(await read(event), fixture.response);
  assert.deepEqual(await write(event, { enabled: true }), fixture.response);
  assert.deepEqual(writes, [{ enabled: true }]);
  response = { enabled: true };
  assert.equal((await read(event)).error, 'INVALID_RESPONSE');
});

test('PK reads/writes reject late old-account responses and automatic retries after switching', async () => {
  for (const method of ['getPkReportSettings', 'updatePkReportSettings']) {
    let owner = 'one', resolve, retry, calls = 0;
    const operations = createLicenseOperations({
      remote: { [method]: () => { calls++; return new Promise((done) => { resolve = done; }); } },
      getOverlayOwner: () => owner, isDisposed: () => false,
      withAuthorizedToken: (operation) => { retry = operation; return operation('one-token'); },
    });
    const pending = operations[method]({ enabled: true });
    owner = 'two'; resolve(fixture.response);
    await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
    await assert.rejects(retry('two-token'), { code: 'LICENSE_NOT_AUTHORIZED' });
    assert.equal(calls, 1);
  }
});
