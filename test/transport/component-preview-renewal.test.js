'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('../helpers/license-manager-harness');
const { RemoteLicenseError } = require('../../src/electron/license/remote-license-client');
const { HEARTBEAT_INTERVAL_MS } = require('../../src/electron/license/license-runtime-policy');
const { getComponentPreviewOwner } = require('../../src/electron/scene-cloud-controller');
const { createComponentPreviewSessions } = require('../../src/server/component-preview-sessions');

async function fixture(t) {
  const tasks = new Set();
  const timers = {
    setTimeout(callback, delay) { const task = { callback, delay }; tasks.add(task); return task; },
    clearTimeout(task) { tasks.delete(task); },
  };
  const harness = createHarness({ identity: { deviceId: 'd', licenseId: 'l', streamerId: 1, publicKeyPem: 'public' }, timers });
  const { manager } = harness;
  t.after(() => manager.dispose());
  await manager.bootstrap();
  const sessions = createComponentPreviewSessions({ getOwner: () => getComponentPreviewOwner(manager) });
  const state = { saved: { label: 'saved' }, draft: { label: 'saved' }, loaded: true, generation: 0 };
  const session = sessions.open({ component: 'clock', state });
  const { key } = sessions.link({ links: [session], selectedId: 'clock' });
  return { ...harness, sessions, session, state, key,
    async renew() {
      const renewal = [...tasks].find(({ delay }) => delay !== HEARTBEAT_INTERVAL_MS);
      assert.ok(renewal, 'The normal background renewal must be scheduled.');
      tasks.delete(renewal);
      renewal.callback();
      await manager.ensureAuthorized();
    },
  };
}

test('background token renewal retains preview links, pending edits and the desktop exchange', async t => {
  const { manager, sessions, session, state, key, renew } = await fixture(t);
  const before = getComponentPreviewOwner(manager);
  const tokenEpoch = manager.getAuthorizationEpoch();
  const edit = sessions.browser({ id: session.id, action: 'edit', change: { label: 'unfinished' } }, session.token);
  await renew();
  await renew();
  assert.equal(manager.getAuthorizationEpoch(), tokenEpoch + 2, 'Other token-epoch consumers retain their contract.');
  assert.deepEqual(sessions.resolveLink(key).links[0].id, session.id);
  assert.deepEqual(getComponentPreviewOwner(manager), before);
  assert.equal(sessions.browser({ id: session.id, action: 'read' }, session.token).sequence, edit.sequence);
  const commands = sessions.exchange({ id: session.id, state, ack: 0 }).commands;
  assert.deepEqual(commands, [{ sequence: edit.sequence, action: 'edit', change: { label: 'unfinished' } }]);
  const next = { ...state, draft: { label: 'unfinished' }, dirty: true };
  sessions.exchange({ id: session.id, state: next, ack: edit.sequence });
  assert.equal(sessions.browser({ id: session.id, action: 'read' }, session.token).state.draft.label, 'unfinished');
});

for (const action of ['reauthorize', 'switch-account', 'revoke', 'dispose']) {
  test(`${action} still invalidates existing preview capabilities`, async t => {
    const { manager, remote, state: controllerState, sessions, session, key } = await fixture(t);
    const previous = getComponentPreviewOwner(manager);
    if (action === 'reauthorize') await manager.bootstrap();
    if (action === 'switch-account') {
      const activate = remote.activate;
      remote.activate = async () => ({ ...await activate(), streamerId: 2 });
      await manager.activate({ accountName: 'next', password: 'synthetic-password', activationCode: 'ABCD-EFGH' });
    }
    if (action === 'revoke') {
      remote.heartbeat = async () => { throw new RemoteLicenseError('DEVICE_REVOKED', 'revoked'); };
      await manager.resume();
    }
    if (action === 'dispose') manager.dispose();
    assert.notDeepEqual(getComponentPreviewOwner(manager), previous);
    assert.throws(() => sessions.resolveLink(key), { statusCode: 410 });
    assert.throws(() => sessions.browser({ id: session.id, action: 'read' }, session.token), { statusCode: 410 });
    assert.throws(() => sessions.exchange({ id: session.id, state: controllerState, ack: 0 }), { statusCode: 410 });
  });
}

test('preview ownership requires current authorization and a valid lifecycle generation', () => {
  const valid = {
    isAuthorized: () => true, getCloudSyncIdentity: () => ({ streamerId: 1 }),
    getRemoteBaseUrl: () => 'https://api.example.test', getAuthorizationEpoch: () => 7,
    getAuthorizationGeneration: () => 3,
  };
  assert.deepEqual(getComponentPreviewOwner(valid), { scope: '["https://api.example.test","1"]', epoch: 3 });
  for (const generation of [undefined, -1, NaN, '3']) {
    assert.equal(getComponentPreviewOwner({ ...valid, getAuthorizationGeneration: () => generation }), null);
  }
  assert.equal(getComponentPreviewOwner({ ...valid, getAuthorizationGeneration() { throw new Error('not ready'); } }), null);
  assert.equal(getComponentPreviewOwner({ ...valid, isAuthorized: () => false,
    getAuthorizationGeneration() { assert.fail('Do not read an unauthorized lifecycle.'); } }), null);
});
