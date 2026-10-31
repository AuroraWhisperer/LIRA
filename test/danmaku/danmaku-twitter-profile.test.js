'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { FakeNode } = require('../helpers/fake-dom');

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
  assert.equal(f.node('twitterProfileName').textContent, '当前房主');
  f.profile.update('twitter', '100', null);
  assert.equal(f.node('twitterProfileUid').textContent, '@等待当前房间');
  f.profile.dispose();
});

test('Twitter preview uses a synthetic owner and preserves its text fallback on avatar failure', async () => {
  let loads = 0;
  const f = await fixture(() => { loads += 1; });
  f.profile.showPreview();
  assert.equal(loads, 0);
  assert.equal(f.node('twitterProfileName').textContent, '合成房主');
  assert.equal(f.node('twitterProfileUid').textContent, '@10001');
  const avatar = f.node('twitterProfileAvatar');
  assert.equal(avatar.src, '/resolved/img/overlays/danmaku-ranked/viewer.webp');
  avatar.onload();
  assert.equal(avatar.hidden, false);
  assert.equal(f.node('twitterProfileAvatarFallback').hidden, true);
  avatar.onerror();
  assert.equal(avatar.hidden, true);
  assert.equal(f.node('twitterProfileAvatarFallback').hidden, false);
  assert.equal(f.node('twitterProfileName').textContent, '合成房主');
  f.profile.dispose();
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
  assert.equal(f.node('twitterProfileName').textContent, '当前房主');
  requests[1].resolve({ roomId: '100', uid: 'other', name: '其他房主', avatarUrl: '/other.png', secret: 'private' });
  await Promise.resolve();
  assert.equal(f.node('twitterProfileName').textContent, '当前房主');
  assert.equal(f.node('twitterProfileUid').textContent, '@等待当前房间');
  assert.equal(f.node('twitterProfileAvatarFallback').hidden, false);

  f.profile.update('twitter', '300');
  requests[2].resolve({ roomId: '300', uid: '456', name: '合成房主', avatarUrl: '/owner.png', secret: 'private' });
  await Promise.resolve();
  assert.equal(f.node('twitterProfileName').textContent, '合成房主');
  assert.equal(f.node('twitterProfileUid').textContent, '@456');
  assert.equal(f.node('twitterProfileAvatar').src, '/resolved/owner.png');
  f.profile.update('signal', '300');
  f.profile.update('twitter', '400');
  requests[3].resolve({ roomId: '400', uid: 'late', name: '迟到资料' });
  f.profile.dispose();
  await Promise.resolve();
  assert.equal(f.node('twitterProfileName').textContent, '当前房主');
});
