'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerLicenseIpc } = require('../../src/electron/ipc/license-ipc');
const { createLicenseOperations } = require('../../src/electron/license/license-operations');
const { fixedReplyParameters, sanitizeFixedReplySettings } = require('../../src/shared/fixed-reply-contract');
const { createHarness } = require('../helpers/license-manager-harness');

const values = {
  customExactReplyEnabled: true,
  customExactReplies: [{ trigger: '月卡', reply: '上舰解锁点歌月卡' }],
  scheduledDanmakuEnabled: false,
  scheduledDanmaku: { mode: 'fixed', intervalSeconds: 300, minSeconds: 300, maxSeconds: 600, selection: 'sequential', messages: [] },
};

test('fixed reply contract validates only the requested fields and strips unsolicited response fields', () => {
  assert.deepEqual(fixedReplyParameters({ customExactReplies: [{ trigger: ' 月卡 ', reply: ' 月卡说明 ' }] }), {
    customExactReplies: [{ trigger: '月卡', reply: '月卡说明' }],
  });
  assert.equal(fixedReplyParameters({ customExactReplies: [{ trigger: '🚀'.repeat(30), reply: '🚀'.repeat(120) }] }).customExactReplies.length, 1);
  for (const input of [
    null, {}, [], { streamerId: 1 }, { customExactReplyEnabled: 'true' }, { scheduledDanmakuEnabled: 1 },
    { customExactReplies: [{ trigger: '菜单', reply: '替代内置菜单' }] },
    { customExactReplies: [{ trigger: 'a', reply: 'a' }, { trigger: ' a ', reply: 'b' }] },
    { customExactReplies: [{ trigger: 'a', reply: 'a', enabled: true }] },
    { customExactReplies: [{ trigger: 'a'.repeat(31), reply: 'a' }] },
    { customExactReplies: [{ trigger: 'a', reply: 'a'.repeat(121) }] },
    { customExactReplies: [{ trigger: 'a', reply: 'line\nbreak' }] },
    { customExactReplies: Array.from({ length: 31 }, (_, index) => ({ trigger: String(index), reply: 'a' })) },
    ...[{ intervalSeconds: 9 }, { maxSeconds: 86401 }, { minSeconds: 601 }, { mode: 'once' },
      { selection: 'shuffle' }, { messages: [''] }, { messages: Array(101).fill('a') }].map((patch) => ({
      scheduledDanmaku: { ...values.scheduledDanmaku, ...patch },
    })),
  ]) assert.throws(() => fixedReplyParameters(input), { code: 'INVALID_FIXED_REPLY_SETTINGS' });
  assert.deepEqual(sanitizeFixedReplySettings({ ok: true, ...values, cookie: 'private', revision: 5 }), { ok: true, ...values });
  assert.throws(() => sanitizeFixedReplySettings({ ok: true }), { code: 'FIXED_REPLY_UNSUPPORTED' });
  assert.throws(() => sanitizeFixedReplySettings({ ok: true, ...values, customExactReplyEnabled: 'true' }), { code: 'INVALID_RESPONSE' });
});

test('fixed reply manager uses only a narrow cloud settings patch and preserves revision internally', async (t) => {
  const { manager, remote } = createHarness({ identity: { deviceId: 'd', streamerId: 1, publicKeyPem: 'public' } });
  t.after(() => manager.dispose());
  const writes = [];
  remote.getCloudState = async () => ({ settings: { revision: 4, values: { ...values, cookie: 'private' } } });
  remote.updateCloudSettings = async (patch) => {
    writes.push(patch);
    return { revision: 5, values: { ...values, ...patch, token: 'private' } };
  };
  await manager.bootstrap();
  assert.deepEqual(await manager.getFixedReplySettings(), { ok: true, ...values, revision: 4 });
  assert.deepEqual(await manager.updateFixedReplySettings({ scheduledDanmakuEnabled: true }), {
    ok: true, ...values, scheduledDanmakuEnabled: true, revision: 5,
  });
  assert.deepEqual(writes, [{ scheduledDanmakuEnabled: true }]);
  remote.getCloudState = async () => ({ settings: { revision: 1, values: { roomId: '1' } } });
  await assert.rejects(manager.getFixedReplySettings(), { code: 'FIXED_REPLY_UNSUPPORTED' });
});

test('fixed reply IPC accepts only the main frame and updates the local projection before returning', async () => {
  const handlers = new Map(), writes = [], projections = [];
  const frame = { url: 'http://127.0.0.1:3000/admin' }, webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  let generation = 1;
  let read = async () => ({ ok: true, ...values, revision: 4, cookie: 'private' });
  registerLicenseIpc({
    ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
    licenseManager: {
      getState: () => 'authorized', getAuthorizationGeneration: () => generation, onStateChanged: () => () => {},
      getFixedReplySettings: () => read(),
      updateFixedReplySettings: async (patch) => { writes.push(patch); return read(); },
    },
    getMainWindow: () => ({ webContents }), getDesktopBaseUrl: () => 'http://127.0.0.1:3000',
    hasExactOrigin: (url, origin) => new URL(url).origin === origin,
    onFixedReplySettings: (settings, revision) => projections.push({ settings, revision }),
  });
  const get = handlers.get('license:get-fixed-reply-settings'), put = handlers.get('license:update-fixed-reply-settings');
  for (const foreign of [{ ...event, sender: {} }, { ...event, senderFrame: { ...frame } }]) {
    assert.equal((await get(foreign)).error, 'IPC_SOURCE_INVALID');
  }
  assert.equal((await put(event, { roomId: '2' })).error, 'INVALID_FIXED_REPLY_SETTINGS');
  assert.equal(writes.length, 0);
  assert.deepEqual(await get(event), { ok: true, ...values });
  assert.deepEqual(projections, [{ settings: { ok: true, ...values }, revision: 4 }]);
  read = async () => { generation++; return { ok: true, ...values, revision: 5 }; };
  assert.equal((await get(event)).error, 'LICENSE_NOT_AUTHORIZED');
  assert.equal(projections.length, 1);
});

test('fixed reply reads and writes reject old-account completion and retry', async () => {
  for (const method of ['getFixedReplySettings', 'updateFixedReplySettings']) {
    let owner = 'one', resolve, retry, calls = 0;
    const response = { revision: 3, values };
    const request = () => { calls++; return new Promise((done) => { resolve = done; }); };
    const operations = createLicenseOperations({
      remote: { getCloudState: request, updateCloudSettings: request },
      getOverlayOwner: () => owner, isDisposed: () => false,
      withAuthorizedToken: (operation) => { retry = operation; return operation('one-token'); },
    });
    const pending = operations[method]({ customExactReplyEnabled: false });
    owner = 'two';
    resolve(method === 'getFixedReplySettings' ? { settings: response } : response);
    await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
    await assert.rejects(retry('two-token'), { code: 'LICENSE_NOT_AUTHORIZED' });
    assert.equal(calls, 1);
  }
});
