'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function fixture(loadProfile) {
  const module = await loadModuleExports(
    path.join(__dirname, '../..', 'public', 'js', 'admin', 'settings-room-profile.js'),
    { URL, URLSearchParams },
  );
  const elements = Object.fromEntries(
    ['roomId', ...['Status', 'Hint', 'Avatar', 'Name', 'Overview', 'RefreshBtn', 'Title', 'Level',
      'Followers', 'Uid', 'Medal', 'Id', 'LiveStatus', 'Area', 'Announcement'].map((field) => `bilibiliRoom${field}`)].map((id) => [
      id,
      {
        value: '123',
        textContent: '',
        title: '',
        src: '',
        alt: '',
        hidden: true,
        listeners: {},
        addEventListener(event, handler) {
          this.listeners[event] = handler;
        },
        removeAttribute(name) {
          this[name] = '';
        },
      },
    ]),
  );
  const profiles = [];
  const view = module.createBilibiliRoomProfile({
    documentRef: { getElementById: (id) => elements[id] },
    fetchRef: async (...args) => ({
      ok: true,
      json: async () => ({ ok: true, ...(await loadProfile(...args)) }),
    }),
    apiToken: 'synthetic-token',
    onProfileChange: (profile) => profiles.push(profile),
  });
  return { module, view, elements, profiles };
}

test('room card renders owner identity with the existing authenticated avatar proxy', async () => {
  let requests = 0;
  const { module, view, elements, profiles } = await fixture(async (url, options) => {
    requests += 1;
    assert.equal(url, '/api/bilibili/room/profile');
    assert.equal(options.method, undefined, 'Room profile requests use GET');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return {
      data: {
        roomId: '123000',
        uid: '456',
        name: '房主名字',
        avatarUrl: 'https://i0.hdslb.com/bfs/face/owner.jpg',
        title: '<直播标题>', liveStatus: 2, level: 23, followers: 2444264,
        medalName: '粉丝牌', parentAreaName: '娱乐', areaName: '视频唱见', announcement: '',
      },
    };
  });
  await view.refresh('123');
  assert.equal(elements.bilibiliRoomName.textContent, '房主名字');
  assert.equal(elements.roomId.value, '123');
  assert.equal(elements.bilibiliRoomOverview.hidden, false);
  assert.equal(elements.bilibiliRoomHint.textContent, '');
  assert.equal(elements.bilibiliRoomTitle.textContent, '<直播标题>');
  assert.match(elements.bilibiliRoomLevel.textContent, /23/);
  assert.equal(elements.bilibiliRoomFollowers.textContent, '2,444,264');
  assert.equal(elements.bilibiliRoomUid.textContent, '456');
  assert.equal(elements.bilibiliRoomId.textContent, '123000');
  assert.equal(elements.bilibiliRoomMedal.textContent, '粉丝牌');
  assert.match(elements.bilibiliRoomArea.textContent, /娱乐.*视频唱见/);
  assert.match(elements.bilibiliRoomLiveStatus.textContent, /轮播/);
  const avatar = elements.bilibiliRoomAvatar;
  assert.equal(avatar.hidden, false);
  const source = new URL(avatar.src, 'http://127.0.0.1');
  assert.equal(source.pathname, '/api/bilibili/avatar');
  assert.equal(source.searchParams.get('token'), 'synthetic-token');
  assert.equal(source.searchParams.get('url'), 'https://i0.hdslb.com/bfs/face/owner.jpg');
  const snapshot = module.getBilibiliRoomProfileSnapshot('123');
  assert.equal(snapshot.uid, '456');
  assert.equal(snapshot.name, '房主名字');
  assert.equal(snapshot.avatarSource, avatar.src);
  assert.equal(profiles.at(-1).avatarSource, avatar.src);
  assert.equal(module.getBilibiliRoomProfileSnapshot('456'), null);
  await view.refresh('123');
  assert.equal(requests, 1, 'Unrelated snapshots must not repeat the profile lookup');
  await elements.bilibiliRoomRefreshBtn.listeners.click();
  assert.equal(requests, 2, 'Manual refresh reloads the saved room without changing the input');
  assert.equal(elements.bilibiliRoomRefreshBtn.disabled, false);
  avatar.listeners.error();
  assert.equal(avatar.hidden, true);
  assert.equal(avatar.src, '');
  assert.equal(profiles.at(-1).avatarSource, '');
});

test('editing a room clears the previous identity and invalidates pending responses', async () => {
  const pending = Promise.withResolvers();
  const { module, view, elements, profiles } = await fixture(() => pending.promise);
  const loading = view.refresh('123');
  elements.roomId.value = '456';
  elements.roomId.listeners.input();
  pending.resolve({
    data: {
      roomId: '123',
      name: '旧房主',
      avatarUrl: 'https://i0.hdslb.com/old.jpg',
    },
  });
  await loading;
  assert.doesNotMatch(elements.bilibiliRoomName.textContent, /旧房主/);
  assert.equal(elements.bilibiliRoomAvatar.hidden, true);
  assert.equal(elements.bilibiliRoomOverview.hidden, true);
  assert.equal(module.getBilibiliRoomProfileSnapshot('123'), null);
  assert.equal(profiles.at(-1), null);
});

test('a late response cannot replace the newly saved room identity', async () => {
  const pending = Promise.withResolvers();
  let requests = 0;
  const { view, elements } = await fixture(() =>
    ++requests === 1 ? pending.promise : Promise.resolve({ data: { roomId: '456', name: '新房主', avatarUrl: '' } }),
  );
  const oldRequest = view.refresh('123');
  await view.refresh('456');
  const savedStatus = elements.bilibiliRoomStatus.textContent;
  pending.reject(new Error('Old lookup failed'));
  await oldRequest;
  assert.equal(elements.bilibiliRoomName.textContent, '新房主');
  assert.equal(elements.bilibiliRoomStatus.textContent, savedStatus);
});

test('an empty room skips lookup and a failed lookup can be retried on save', async () => {
  let requests = 0;
  const { view, elements } = await fixture(async () => {
    if (++requests === 1) throw new Error('Unavailable');
    return { data: { roomId: '123', name: '房主', avatarUrl: '' } };
  });
  await view.refresh('');
  assert.equal(requests, 0);
  await view.refresh('123');
  const failedStatus = elements.bilibiliRoomStatus.textContent;
  await view.refresh('123', true);
  assert.equal(requests, 2);
  assert.notEqual(elements.bilibiliRoomStatus.textContent, failedStatus);
  assert.equal(elements.bilibiliRoomName.textContent, '房主');
  assert.equal(elements.bilibiliRoomAvatar.hidden, true);
  assert.equal(elements.bilibiliRoomLevel.hidden, true);
  assert.equal(elements.bilibiliRoomFollowers.textContent, '—', 'Missing data must not appear as zero followers');
});
