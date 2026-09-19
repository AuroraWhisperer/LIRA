const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');
const { createLicenseOperations } = require('../src/electron/license/license-operations');
const { createRemoteLicenseClient } = require('../src/electron/license/remote-license-client');

test('filter IPC requires the main frame, validates patches and strips private response fields', async () => {
  const handlers = new Map(), writes = [];
  const frame = { url: 'http://127.0.0.1:3000/admin' };
  const webContents = { mainFrame: frame }, event = { sender: webContents, senderFrame: frame };
  const settings = { blockedUsers: [{ uid: '123', name: '观众', cookie: 'private' }], blockedKeywords: ['广告'], token: 'secret' };
  registerLicenseIpc({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    licenseManager: { getState: () => 'authorized', onStateChanged: () => () => {},
      getOverlayFilters: async () => settings,
      updateOverlayFilters: async (patch) => { writes.push(patch); return settings; },
      getOverlayViewers: async () => ({ roomId: '99', viewers: settings.blockedUsers, cookie: 'secret' }),
    },
    getMainWindow: () => ({ webContents }), getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
    hasExactOrigin: (value, expected) => new URL(value).origin === expected,
  });
  const read = handlers.get('license:get-overlay-filters'), update = handlers.get('license:update-overlay-filters');
  const viewers = handlers.get('license:get-overlay-viewers');
  for (const handler of [read, update, viewers]) {
    for (const invalid of [{ ...event, sender: {} }, { ...event, senderFrame: { ...frame } },
      { ...event, senderFrame: { url: 'https://evil.test/admin' } }]) {
      assert.equal((await handler(invalid, { blockedKeywords: [] })).error, 'IPC_SOURCE_INVALID');
    }
  }
  for (const patch of [null, {}, { streamerId: 2 }, { blockedKeywords: [''] },
    { blockedUsers: [{ uid: 123, name: '' }] }, { blockedUsers: settings.blockedUsers },
    { blockedKeywords: ['x'.repeat(101)] }, { blockedKeywords: Array(201).fill('x') }]) {
    assert.equal((await update(event, patch)).error, 'INVALID_OVERLAY_FILTERS');
  }
  assert.equal(writes.length, 0);
  const safe = { ok: true, blockedUsers: [{ uid: '123', name: '观众' }], blockedKeywords: ['广告'] };
  assert.deepEqual(await read(event), safe);
  assert.deepEqual(await update(event, { blockedKeywords: [] }), safe);
  assert.deepEqual(writes, [{ blockedKeywords: [] }]);
  assert.deepEqual(await viewers(event), { ok: true, roomId: '99', viewers: safe.blockedUsers });
  settings.blockedKeywords = null;
  assert.equal((await read(event)).error, 'INVALID_RESPONSE');
});

test('new remote operations use only fixed Device URLs with main-process bearer auth', async () => {
  const calls = [];
  const remote = createRemoteLicenseClient({ baseUrl: 'https://api.example.test', isProduction: true,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '{}' }; },
  });
  await remote.getOverlayFilters('synthetic');
  await remote.updateOverlayFilters({ blockedKeywords: [] }, 'synthetic');
  await remote.getOverlayViewers('synthetic');
  assert.deepEqual(calls.map(({ url, init }) => [new URL(url).pathname, init.method]), [
    ['/api/device/overlay-filters', 'GET'], ['/api/device/overlay-filters', 'PUT'], ['/api/device/overlay-viewers', 'GET'],
  ]);
  assert.ok(calls.every(({ init }) => init.headers.Authorization === 'Bearer synthetic'));
});

test('filter operations reject late account responses and surface unsupported servers', async () => {
  let owner = 'one', resolve;
  const operations = createLicenseOperations({
    remote: {
      getOverlayViewers: () => new Promise((done) => { resolve = done; }),
      getOverlayFilters: async () => { throw Object.assign(new Error('not found'), { status: 404 }); },
    }, getOverlayOwner: () => owner, isDisposed: () => false,
    withAuthorizedToken: (operation) => operation('synthetic'),
  });
  const pending = operations.getOverlayViewers();
  owner = 'two';
  resolve({ roomId: '99', viewers: [] });
  await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
  await assert.rejects(operations.getOverlayFilters(), { code: 'OVERLAY_FILTERS_UNSUPPORTED' });
});
