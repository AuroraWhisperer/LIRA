const test = require('node:test');
const assert = require('node:assert/strict');
const { createLicenseIpcFixture } = require('../helpers/license-ipc-fixture');
const { createDisplaySettingsEndpoints, createDisplaySettingsOperations } = require('../../src/electron/license/display-settings-protocol');

test('nickname IPC rejects foreign frames and invalid writes, filters private fields and drops old-account replies', async () => {
  let generation = 1;
  const writes = [];
  const f = createLicenseIpcFixture({ licenseManager: {
    getAuthorizationGeneration: () => generation,
    getViewerNameSettings: async () => ({ enabled: true, token: 'private' }),
    listViewerNames: async () => ({ items: [{ uid: '42', name: '灰灰', cookie: 'private' }], page: 1, pageSize: 20, total: 1 }),
    updateViewerName: async (value) => { writes.push(value); return value; },
    deleteViewerName: async () => ({ ok: true, token: 'private' }),
  } });
  const get = f.handlers.get('license:list-viewer-names');
  assert.equal((await get({ ...f.trustedEvent, senderFrame: {} }, { page: 1 })).error, 'IPC_SOURCE_INVALID');
  assert.equal((await f.invoke('license:update-viewer-name', { uid: '../42', name: '灰灰' })).error, 'INVALID_VIEWER_NAME_REQUEST');
  assert.equal((await f.invoke('license:update-viewer-name', { uid: '42', name: '灰灰', streamerId: 2 })).error, 'INVALID_VIEWER_NAME_REQUEST');
  assert.equal(writes.length, 0);
  const page = await f.invoke('license:list-viewer-names', { page: 1 });
  assert.deepEqual(page.items, [{ uid: '42', name: '灰灰' }]);
  assert.deepEqual(await f.invoke('license:get-viewer-name-settings'), { ok: true, enabled: true });
  await f.invoke('license:update-viewer-name', { uid: '42', name: ' 新称呼🌟 ' });
  assert.deepEqual(writes, [{ uid: '42', name: '新称呼🌟' }]);
  f.licenseManager.listViewerNames = async () => { generation++; return page; };
  assert.equal((await f.invoke('license:list-viewer-names', { page: 1 })).error, 'LICENSE_NOT_AUTHORIZED');
});

test('nickname transport uses the authorized Device resources and rejects account changes', async () => {
  let owner = 'one', finish;
  const requests = [];
  const remote = createDisplaySettingsEndpoints({ request: (...args) => {
    requests.push(args);
    return new Promise((resolve) => { finish = resolve; });
  } });
  const operations = createDisplaySettingsOperations({ remote, getOverlayOwner: () => owner,
    isDisposed: () => false, withAuthorizedToken: (operation) => operation('synthetic-token') });
  const pending = operations.listViewerNames({ page: 2 });
  assert.deepEqual(requests[0].slice(0, 2), ['GET', '/api/device/viewer-names?page=2']);
  assert.equal(requests[0][3], 'synthetic-token');
  owner = 'two';
  finish({ items: [], page: 1, pageSize: 20, total: 0 });
  await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
  remote.getViewerNameSettings = async () => { throw Object.assign(new Error(), { status: 404 }); };
  await assert.rejects(operations.getViewerNameSettings(), { code: 'VIEWER_NAMES_UNSUPPORTED' });
  remote.updateViewerName = async () => { throw Object.assign(new Error(), { status: 404, code: 'VIEWER_NAME_NOT_FOUND' }); };
  await assert.rejects(operations.updateViewerName({ uid: '42', name: '灰灰' }), { code: 'VIEWER_NAME_NOT_FOUND' });
});
