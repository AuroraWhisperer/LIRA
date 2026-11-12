'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { FakeNode } = require('../helpers/fake-dom');
const { createSceneDanmakuDisplay } = require('../../public/js/overlays/scene-danmaku-display.js');

function fixture(loadProfile) {
  const nodes = new Map();
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new FakeNode(id.includes('Avatar') ? 'img' : 'span'));
      return nodes.get(id);
    },
  };
  return import(pathToFileURL(path.join(__dirname, '../../public/js/overlays/danmaku-twitter-profile.js')).href)
    .then(({ createTwitterRoomProfile }) => ({
      profile: createTwitterRoomProfile({ document, loadProfile, resolveAvatarUrl: (value) => value ? `/resolved${value}` : '' }),
      node: (id) => document.getElementById(id),
    }));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('authorized scene projection updates its owner without HTTP and rejects mismatched rooms', async () => {
  const f = await fixture(() => assert.fail('Scene frames must never fetch a room profile'));
  f.profile.update('twitter', '100', { roomId: '100', uid: '456', name: '本房房主' });
  assert.equal(f.node('twitterProfileName').textContent, '本房房主');
  f.profile.update('twitter', '100', { roomId: '200', uid: 'private', name: '其他房主' });
  assert.notEqual(f.node('twitterProfileName').textContent, '其他房主');
  assert.doesNotMatch(f.node('twitterProfileUid').textContent, /private/);
  f.profile.dispose();
});

test('scene short-room projections render their verified canonical owner and clear unavailable profiles', async t => {
  const f = await fixture(() => assert.fail('Scene frames must never fetch a room profile'));
  t.after(() => f.profile.dispose());
  const display = createSceneDanmakuDisplay({ clear() {}, append() {}, status() {}, getStyle: () => 'twitter',
    room: (roomId, profile) => f.profile.update('twitter', roomId, profile) });
  const snapshot = { status: 'connected', epoch: 'owner:1',
    state: { liveStatus: 1, liveSessionId: 'live', roomGuard: { roomId: '100' } },
    roomProfile: { roomId: '100000', uid: '456', name: '已验证房主' }, events: [] };
  display.update(snapshot);
  assert.equal(f.node('twitterProfileName').textContent, '已验证房主');
  assert.equal(f.node('twitterProfileUid').textContent, '@456');
  display.update({ ...snapshot, roomProfile: null });
  assert.notEqual(f.node('twitterProfileName').textContent, '已验证房主');
  assert.doesNotMatch(f.node('twitterProfileUid').textContent, /456/);
});

test('Twitter preview never loads a room profile', async () => {
  let loads = 0;
  const f = await fixture(() => { loads += 1; });
  f.profile.showPreview();
  assert.equal(loads, 0);
  f.profile.dispose();
});

test('failed room profiles recover on a later update without repeated pending or cooled-down requests', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-11-12T00:00:00Z') });
  const requests = [];
  const f = await fixture(() => {
    const next = deferred();
    requests.push(next);
    return next.promise;
  });
  t.after(() => f.profile.dispose());
  f.profile.update('twitter', '100');
  f.profile.update('twitter', '100');
  assert.equal(requests.length, 1, 'updates reuse the pending request');
  requests[0].reject(new Error('Temporary room profile failure'));
  await new Promise(resolve => setImmediate(resolve));

  for (let index = 0; index < 50; index += 1) f.profile.update('twitter', '100');
  t.mock.timers.tick(29_999);
  f.profile.update('twitter', '100');
  assert.equal(requests.length, 1, 'dense updates respect the failure cooldown');
  t.mock.timers.tick(1);
  assert.equal(requests.length, 1, 'cooldown expiry alone does not start a request');
  f.profile.update('twitter', '100');
  f.profile.update('twitter', '100');
  assert.equal(requests.length, 2, 'a later update starts only one recovery request');
  requests[1].resolve({ roomId: '100', uid: '456', name: '已恢复房主' });
  await Promise.resolve();
  assert.equal(f.node('twitterProfileName').textContent, '已恢复房主');
  t.mock.timers.tick(60_000);
  f.profile.update('twitter', '100');
  assert.equal(requests.length, 2, 'successful room profiles stay cached');
});

test('room profile requests invalidate stale work and never show another room identity', async () => {
  const requests = [];
  const f = await fixture(({ signal }) => {
    const next = deferred();
    requests.push({ ...next, signal });
    return next.promise;
  });
  f.profile.update('twitter', '100');
  f.profile.update('twitter', '200');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({ roomId: '100', uid: 'old', name: '旧房主', avatarUrl: '/old.png' });
  await Promise.resolve();
  assert.notEqual(f.node('twitterProfileName').textContent, '旧房主');
  requests[1].resolve({ roomId: '100', uid: 'other', name: '其他房主', avatarUrl: '/other.png', secret: 'private' });
  await Promise.resolve();
  assert.notEqual(f.node('twitterProfileName').textContent, '其他房主');

  f.profile.update('twitter', '300');
  requests[2].resolve({ roomId: '300', uid: '456', name: '合成房主', avatarUrl: '/owner.png', secret: 'private' });
  await Promise.resolve();
  assert.equal(f.node('twitterProfileName').textContent, '合成房主');
  assert.equal(f.node('twitterProfileAvatar').src, '/resolved/owner.png');
  f.profile.update('signal', '300');
  f.profile.update('twitter', '400');
  requests[3].resolve({ roomId: '400', uid: 'late', name: '迟到资料' });
  f.profile.dispose();
  await Promise.resolve();
  assert.notEqual(f.node('twitterProfileName').textContent, '迟到资料');
});
