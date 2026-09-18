const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLicenseIpc } = require('../src/electron/ipc/license-ipc');
const { createRemoteLicenseClient, RemoteLicenseError } = require('../src/electron/license/remote-license-client');
const { createLicenseOperations } = require('../src/electron/license/license-operations');
const { sanitizeWelcomeV2 } = require('../src/shared/welcome-settings-contract');
const settings = { schemaVersion: 2, enabled: false, messages: ['欢迎 {username}'],
  welcomeDelaySeconds: 0, welcomeMinHonorLevel: 0, greetingEnabled: false, greetingDelaySeconds: 10,
  greetingMinHonorLevel: 0, attentionEnabled: false, attentionMinHonorLevel: 31, rareNamePinyinEnabled: false,
  greetingMessages: ['{username}，你好呀～'], attentionWelcomeMessages: ['专属 {username}'],
  attentionGreetingMessages: ['{username}，来点歌吧'] };

test('V2 IPC projects all typed fields, rejects bad patches, invalid success and untrusted frames', async () => {
  const handlers = new Map(), writes = [], webContents = {};
  let reply = { ...settings, accessToken: 'private', streamerId: 7 };
  const event = { sender: webContents, senderFrame: { url: 'http://127.0.0.1:3000/admin' } };
  registerLicenseIpc({ ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    licenseManager: { getState: () => 'authorized', onStateChanged: () => () => {},
      getWelcomeSettingsV2: async () => reply,
      updateWelcomeSettingsV2: async (patch) => { writes.push(patch); return reply; } },
    getMainWindow: () => ({ webContents }), getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
    hasExactOrigin: (url, origin) => new URL(url).origin === origin,
  });
  const read = handlers.get('license:get-welcome-settings-v2'), write = handlers.get('license:update-welcome-settings-v2');
  assert.equal((await read({ ...event, sender: {} })).error, 'IPC_SOURCE_INVALID');
  assert.deepEqual(await read(event), { ok: true, ...settings });
  for (const patch of [{}, { streamerId: 2 }, { schemaVersion: 2 }, { welcomeDelaySeconds: '5' },
    { welcomeDelaySeconds: 301 }, { attentionMinHonorLevel: 0 }, { rareNamePinyinEnabled: 1 },
    { greetingMessages: [] }, { attentionWelcomeMessages: ['x'.repeat(81)] }])
    assert.match((await write(event, patch)).error, /^INVALID_WELCOME_/);
  assert.equal(writes.length, 0);
  await write(event, { welcomeDelaySeconds: 5, attentionWelcomeMessages: [' 新文案 '] });
  assert.deepEqual(writes[0], { welcomeDelaySeconds: 5, attentionWelcomeMessages: ['新文案'] });
  for (const invalid of [{ ...settings, greetingDelaySeconds: '10' }, { ...settings, greetingEnabled: true },
    { ...settings, welcomeDelaySeconds: undefined }, { ...settings, schemaVersion: 3 }]) {
    reply = invalid; assert.equal((await read(event)).error, 'INVALID_RESPONSE');
  }
});

test('V2 reads fall back only on an explicit 404, never on malformed success/auth/network or any write', async () => {
  let error = new RemoteLicenseError('HTTP_404', '', { status: 404 }), legacyReads = 0, oldWrites = 0;
  const operations = createLicenseOperations({ remote: {
    getWelcomeSettingsV2: async () => { if (error) throw error; return { schemaVersion: 1, enabled: false, messages: ['Hi'] }; },
    getWelcomeSettings: async () => { legacyReads += 1; return { enabled: false, messages: ['Hi'] }; },
    updateWelcomeSettingsV2: async () => { throw new RemoteLicenseError('HTTP_404', '', { status: 404 }); },
    updateWelcomeSettings: async () => { oldWrites += 1; },
  }, getOverlayOwner: () => 'one', isDisposed: () => false, withAuthorizedToken: (operation) => operation('synthetic') });
  assert.equal((await operations.getWelcomeSettingsV2()).schemaVersion, 1);
  for (const status of [401, 403, 500, 0]) {
    error = new RemoteLicenseError('SYNTHETIC_ERROR', '', { status });
    await assert.rejects(operations.getWelcomeSettingsV2());
  }
  error = null; await assert.rejects(operations.getWelcomeSettingsV2(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(operations.updateWelcomeSettingsV2({ enabled: true }));
  assert.equal(legacyReads, 1); assert.equal(oldWrites, 0);
});

test('V2 uses fixed endpoints, carries only safe field errors and rejects late account writes', async () => {
  const calls = [];
  const remote = createRemoteLicenseClient({ baseUrl: 'https://api.example.test',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: false, status: 400,
      text: async () => JSON.stringify({ error: 'INVALID_WELCOME_SETTINGS', fieldErrors: [
        { field: 'greetingDelaySeconds', reason: 'AFTER_WELCOME_REQUIRED', secret: 'private' },
        { field: 'token', reason: 'private' }], cookie: 'private' }) }; } });
  for (const operation of [() => remote.getWelcomeSettingsV2('synthetic'),
    () => remote.updateWelcomeSettingsV2({ enabled: true }, 'synthetic')]) {
    await assert.rejects(operation(), (error) => {
      assert.deepEqual(error.fieldErrors, [{ field: 'greetingDelaySeconds', reason: 'AFTER_WELCOME_REQUIRED' }]); return true;
    });
  }
  assert.deepEqual(calls.map(({ init }) => init.method), ['GET', 'PUT']);
  assert.ok(calls.every(({ url, init }) => url === 'https://api.example.test/api/device/welcome-settings/v2' && init.headers.Authorization === 'Bearer synthetic'));
  let owner = 'one', finish;
  const operations = createLicenseOperations({ remote: { updateWelcomeSettingsV2: () => new Promise((resolve) => { finish = resolve; }) },
    getOverlayOwner: () => owner, isDisposed: () => false, withAuthorizedToken: (operation) => operation('synthetic') });
  const pending = operations.updateWelcomeSettingsV2({ enabled: true }); owner = 'two'; finish(settings);
  await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
  assert.throws(() => sanitizeWelcomeV2({ ...settings, greetingEnabled: true }), { code: 'INVALID_RESPONSE' });
});
