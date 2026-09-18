'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

async function fixture(loadProfile) {
  const module = await loadModuleExports(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'settings-room-profile.js'),
    { URL, URLSearchParams },
  );
  const elements = Object.fromEntries([
    'roomId', 'bilibiliRoomStatus', 'bilibiliRoomAvatar',
    'bilibiliRoomName', 'bilibiliRoomNumber',
  ].map((id) => [id, {
    value: '123', textContent: '', title: '', src: '', alt: '', hidden: true,
    listeners: {},
    addEventListener(event, handler) { this.listeners[event] = handler; },
    removeAttribute(name) { this[name] = ''; },
  }]));
  const view = module.createBilibiliRoomProfile({
    documentRef: { getElementById: (id) => elements[id] },
    fetchRef: async (...args) => ({
      ok: true,
      json: async () => ({ ok: true, ...await loadProfile(...args) }),
    }),
    apiToken: 'synthetic-token',
  });
  return { view, elements };
}

test('room card renders owner identity with the existing authenticated avatar proxy', async () => {
  let requests = 0;
  const { view, elements } = await fixture(async (url, options) => {
    requests += 1;
    assert.equal(url, '/api/bilibili/room/profile');
    assert.equal(options.method, undefined, 'Room profile requests use GET');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return { data: {
      roomId: '123000', uid: '456', name: '房主名字',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/owner.jpg',
    } };
  });
  await view.refresh('123');
  assert.equal(elements.bilibiliRoomStatus.textContent, '已设置');
  assert.equal(elements.bilibiliRoomName.textContent, '房主名字');
  assert.equal(elements.bilibiliRoomNumber.textContent, '房间号：123000');
  const avatar = elements.bilibiliRoomAvatar;
  assert.equal(avatar.hidden, false);
  assert.equal(avatar.alt, '房主名字的头像');
  const source = new URL(avatar.src, 'http://127.0.0.1');
  assert.equal(source.pathname, '/api/bilibili/avatar');
  assert.equal(source.searchParams.get('token'), 'synthetic-token');
  assert.equal(source.searchParams.get('url'), 'https://i0.hdslb.com/bfs/face/owner.jpg');
  await view.refresh('123');
  assert.equal(requests, 1, 'Unrelated snapshots must not repeat the profile lookup');
  avatar.listeners.error();
  assert.equal(avatar.hidden, true);
  assert.equal(avatar.src, '');
});

test('editing a room clears the previous identity and invalidates pending responses', async () => {
  const pending = Promise.withResolvers();
  const { view, elements } = await fixture(() => pending.promise);
  const loading = view.refresh('123');
  elements.roomId.value = '456';
  elements.roomId.listeners.input();
  pending.resolve({ data: {
    roomId: '123', name: '旧房主', avatarUrl: 'https://i0.hdslb.com/old.jpg',
  } });
  await loading;
  assert.equal(elements.bilibiliRoomStatus.textContent, '待保存');
  assert.doesNotMatch(elements.bilibiliRoomName.textContent, /旧房主/);
  assert.equal(elements.bilibiliRoomAvatar.hidden, true);
  assert.equal(elements.bilibiliRoomNumber.textContent, '');
});

test('a late response cannot replace the newly saved room identity', async () => {
  const pending = Promise.withResolvers();
  let requests = 0;
  const { view, elements } = await fixture(() => ++requests === 1
    ? pending.promise
    : Promise.resolve({ data: { roomId: '456', name: '新房主', avatarUrl: '' } }));
  const oldRequest = view.refresh('123');
  await view.refresh('456');
  pending.reject(new Error('Old lookup failed'));
  await oldRequest;
  assert.equal(elements.bilibiliRoomName.textContent, '新房主');
  assert.equal(elements.bilibiliRoomNumber.textContent, '房间号：456');
  assert.equal(elements.bilibiliRoomStatus.textContent, '已设置');
});

test('an empty room skips lookup and a failed lookup can be retried on save', async () => {
  let requests = 0;
  const { view, elements } = await fixture(async () => {
    if (++requests === 1) throw new Error('Unavailable');
    return { data: { roomId: '123', name: '房主', avatarUrl: '' } };
  });
  await view.refresh('');
  assert.equal(requests, 0);
  assert.equal(elements.bilibiliRoomStatus.textContent, '未设置');
  await view.refresh('123');
  assert.equal(elements.bilibiliRoomStatus.textContent, '读取失败');
  assert.equal(elements.bilibiliRoomNumber.textContent, '房间号：123');
  await view.refresh('123', true);
  assert.equal(elements.bilibiliRoomStatus.textContent, '已设置');
  assert.equal(elements.bilibiliRoomName.textContent, '房主');
  assert.equal(elements.bilibiliRoomAvatar.hidden, true);
});
