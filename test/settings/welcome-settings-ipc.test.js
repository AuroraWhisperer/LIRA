const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLicenseIpc } = require('../../src/electron/ipc/license-ipc');
const { createRemoteLicenseClient, RemoteLicenseError } = require('../../src/electron/license/remote-license-client');
const { createLicenseOperations } = require('../../src/electron/license/license-operations');
const { sanitizeWelcomeV2 } = require('../../src/shared/welcome-settings-contract');
const { createHarness } = require('../helpers/license-manager-harness');

const v2Settings = {
  schemaVersion: 2,
  enabled: false,
  messages: ['欢迎 {username}'],
  welcomeDelaySeconds: 0,
  welcomeMinHonorLevel: 0,
  greetingEnabled: false,
  greetingDelaySeconds: 10,
  greetingMinHonorLevel: 0,
  attentionEnabled: false,
  attentionMinHonorLevel: 31,
  rareNamePinyinEnabled: false,
  greetingMessages: ['{username}，你好呀～'],
  attentionWelcomeMessages: ['专属 {username}'],
  attentionGreetingMessages: ['{username}，来点歌吧'],
};

const versions = [
  { name: 'V1', read: 'getWelcomeSettings', write: 'updateWelcomeSettings', path: '/api/device/welcome-settings' },
  { name: 'V2', read: 'getWelcomeSettingsV2', write: 'updateWelcomeSettingsV2', path: '/api/device/welcome-settings/v2' },
];

function registerWelcomeIpc(licenseManager) {
  const handlers = new Map();
  const webContents = {};
  registerLicenseIpc({
    ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    licenseManager: { getState: () => 'authorized', onStateChanged: () => () => {}, ...licenseManager },
    getMainWindow: () => ({ webContents }),
    getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
    hasExactOrigin: (url, origin) => new URL(url).origin === origin,
  });
  return { handlers, event: { sender: webContents, senderFrame: { url: 'http://127.0.0.1:3000/admin' } } };
}

for (const version of versions) {
  test(`${version.name} requests use fixed authenticated endpoints and carry only safe field errors`, async () => {
    const calls = [];
    const client = createRemoteLicenseClient({
      baseUrl: 'https://api.example.test',
      isProduction: true,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: 'INVALID_WELCOME_SETTINGS',
              fieldErrors: [
                { field: 'greetingDelaySeconds', reason: 'AFTER_WELCOME_REQUIRED', secret: 'private' },
                { field: 'token', reason: 'private' },
              ],
              cookie: 'private',
            }),
        };
      },
    });
    for (const operation of [() => client[version.read]('synthetic'), () => client[version.write]({ enabled: true }, 'synthetic')]) {
      await assert.rejects(operation(), (error) => {
        if (version.name === 'V2') {
          assert.deepEqual(error.fieldErrors, [{ field: 'greetingDelaySeconds', reason: 'AFTER_WELCOME_REQUIRED' }]);
        }
        return true;
      });
    }
    assert.deepEqual(
      calls.map(({ init }) => init.method),
      ['GET', 'PUT'],
    );
    for (const { url, init } of calls) {
      assert.equal(url, `https://api.example.test${version.path}`);
      assert.equal(init.headers.Authorization, 'Bearer synthetic');
    }
    assert.deepEqual(JSON.parse(calls[1].init.body), { enabled: true });
  });

  test(`${version.name} writes reject old-account responses and retries after account changes`, async () => {
    let owner = 'one';
    let resolve;
    let retry;
    const calls = [];
    const operations = createLicenseOperations({
      remote: {
        [version.write]: (patch, token) => {
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
    const pending = operations[version.write]({ enabled: true });
    owner = 'two';
    resolve(version.name === 'V2' ? v2Settings : { enabled: true, messages: ['Hi'] });
    await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
    await assert.rejects(retry('two-token'), { code: 'LICENSE_NOT_AUTHORIZED' });
    assert.deepEqual(calls, ['one-token']);
  });
}

test('the license manager exposes V1 welcome settings without private reply fields', async () => {
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

test('V1 welcome IPC requires the main window and validates patches before any write', async () => {
  const writes = [];
  const reply = { enabled: true, messages: ['欢迎 {username}'], cookie: 'private', streamerId: 2 };
  const { handlers, event } = registerWelcomeIpc({
    getWelcomeSettings: async () => reply,
    updateWelcomeSettings: async (patch) => {
      writes.push(patch);
      return reply;
    },
  });
  const read = handlers.get('license:get-welcome-settings');
  const write = handlers.get('license:update-welcome-settings');
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

test('V2 IPC projects all typed fields, rejects bad patches, invalid success and untrusted frames', async () => {
  const writes = [];
  let reply = { ...v2Settings, accessToken: 'private', streamerId: 7 };
  const { handlers, event } = registerWelcomeIpc({
    getWelcomeSettingsV2: async () => reply,
    updateWelcomeSettingsV2: async (patch) => {
      writes.push(patch);
      return reply;
    },
  });
  const read = handlers.get('license:get-welcome-settings-v2');
  const write = handlers.get('license:update-welcome-settings-v2');
  assert.equal((await read({ ...event, sender: {} })).error, 'IPC_SOURCE_INVALID');
  assert.deepEqual(await read(event), { ok: true, ...v2Settings });
  for (const patch of [
    {},
    { streamerId: 2 },
    { schemaVersion: 2 },
    { welcomeDelaySeconds: '5' },
    { welcomeDelaySeconds: 301 },
    { attentionMinHonorLevel: 0 },
    { rareNamePinyinEnabled: 1 },
    { greetingMessages: [] },
    { attentionWelcomeMessages: ['x'.repeat(81)] },
  ])
    assert.match((await write(event, patch)).error, /^INVALID_WELCOME_/);
  assert.equal(writes.length, 0);
  await write(event, { welcomeDelaySeconds: 5, attentionWelcomeMessages: [' 新文案 '] });
  assert.deepEqual(writes[0], { welcomeDelaySeconds: 5, attentionWelcomeMessages: ['新文案'] });
  for (const invalid of [
    { ...v2Settings, greetingDelaySeconds: '10' },
    { ...v2Settings, greetingEnabled: true },
    { ...v2Settings, welcomeDelaySeconds: undefined },
    { ...v2Settings, schemaVersion: 3 },
  ]) {
    reply = invalid;
    assert.equal((await read(event)).error, 'INVALID_RESPONSE');
  }
  assert.throws(() => sanitizeWelcomeV2({ ...v2Settings, greetingEnabled: true }), { code: 'INVALID_RESPONSE' });
});

test('V2 reads fall back only on an explicit 404, never on malformed success/auth/network or any write', async () => {
  let error = new RemoteLicenseError('HTTP_404', '', { status: 404 });
  let legacyReads = 0;
  let oldWrites = 0;
  const operations = createLicenseOperations({
    remote: {
      getWelcomeSettingsV2: async () => {
        if (error) throw error;
        return { schemaVersion: 1, enabled: false, messages: ['Hi'] };
      },
      getWelcomeSettings: async () => {
        legacyReads += 1;
        return { enabled: false, messages: ['Hi'] };
      },
      updateWelcomeSettingsV2: async () => {
        throw new RemoteLicenseError('HTTP_404', '', { status: 404 });
      },
      updateWelcomeSettings: async () => {
        oldWrites += 1;
      },
    },
    getOverlayOwner: () => 'one',
    isDisposed: () => false,
    withAuthorizedToken: (operation) => operation('synthetic'),
  });
  assert.equal((await operations.getWelcomeSettingsV2()).schemaVersion, 1);
  for (const status of [401, 403, 500, 0]) {
    error = new RemoteLicenseError('SYNTHETIC_ERROR', '', { status });
    await assert.rejects(operations.getWelcomeSettingsV2());
  }
  error = null;
  await assert.rejects(operations.getWelcomeSettingsV2(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(operations.updateWelcomeSettingsV2({ enabled: true }));
  assert.equal(legacyReads, 1);
  assert.equal(oldWrites, 0);
});
