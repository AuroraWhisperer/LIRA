'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const songService = require('../src/music/song-service');
const { createServerRuntime } = require('../src/server');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { createQueueStore } = require('../src/storage/queue-store');

const TEST_BLIND_BOX_CONFIG = [
  {
    name: '测试盲盒',
    price: 2.345,
    outputs: [{ name: '测试礼物', price: 3.456 }, '无定价礼物'],
  },
];

test('cloud song replacement is atomic, deduplicates local identities, and preserves history text', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-songs-'));
  const databases = createDatabases({ dataDir });
  const { songDb } = databases;

  try {
    const oldSong = songService.saveSong(songDb, {
      name: '旧歌曲',
      artist: '旧歌手',
      categoryName: '旧分类',
    });
    const queueItem = createQueueStore(songDb).insertRequest({
      songId: oldSong.id,
      songName: oldSong.name,
      artist: oldSong.artist,
      categoryName: '旧分类',
      requesterUid: '123',
      requesterName: '测试观众',
      requesterGuardLevel: 0,
      requesterMedalName: '',
      requesterMedalLevel: 0,
      message: '点歌 旧歌曲',
      source: 'danmaku',
      status: 'waiting',
      isPinned: 0,
      pinnedAt: '',
      createdAt: '2026-08-30T00:00:00.000Z',
    });

    const result = songService.replaceCloudSongs(songDb, [
      { title: '云端歌曲', artist: '歌手', categoryName: '云端分类' },
      {
        title: '云端歌曲',
        artist: '歌手',
        categoryName: '最终分类',
        enabled: false,
      },
      { title: '第二首', artist: '', enabled: true },
    ]);

    assert.deepEqual(result, { total: 3, count: 2, duplicate: 1 });
    assert.deepEqual(
      songDb
        .prepare('SELECT name,artist,is_enabled FROM songs ORDER BY name')
        .all()
        .map((row) => ({ ...row })),
      [
        { name: '云端歌曲', artist: '歌手', is_enabled: 0 },
        { name: '第二首', artist: '', is_enabled: 1 },
      ],
    );
    assert.equal(
      songDb
        .prepare('SELECT name FROM song_categories WHERE name=?')
        .get('旧分类'),
      undefined,
    );
    assert.deepEqual(
      {
        ...songDb
          .prepare('SELECT song_id,song_name FROM queue WHERE id=?')
          .get(queueItem.id),
      },
      { song_id: null, song_name: '旧歌曲' },
    );
    assert.deepEqual(
      {
        ...songDb
          .prepare('SELECT song_id,song_name,message FROM requests WHERE queue_id=?')
          .get(queueItem.id),
      },
      { song_id: null, song_name: '旧歌曲', message: '点歌 旧歌曲' },
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('runtime applies cloud snapshots without echo and emits dirty scopes after local writes', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-runtime-'));
  const runtime = createServerRuntime({
    dataDir,
    licenseGate: { isAuthorized: () => true },
  });
  const dirty = [];
  const unsubscribe = runtime.onCloudSyncRequested((scope) => dirty.push(scope));

  try {
    const server = await runtime.start({ host: '127.0.0.1', startPort: 0 });
    const localBlindBoxConfig = runtime.getCloudSettingsSnapshot().giftBlindBoxConfig;
    runtime.applyCloudSettingsSnapshot({
      roomId: 'https://live.bilibili.com/1963694209',
      enableBilibili: false,
      paused: true,
      queueLimit: 75,
      userCooldownSeconds: 12,
      onlyFromLibrary: true,
      allowDuplicate: false,
    });
    assert.deepEqual(runtime.getCloudSettingsSnapshot(), {
      roomId: '1963694209',
      enableBilibili: false,
      paused: true,
      queueLimit: 75,
      userCooldownSeconds: 12,
      onlyFromLibrary: true,
      allowDuplicate: false,
      giftBlindBoxConfig: localBlindBoxConfig,
    });

    runtime.applyCloudSettingsSnapshot({
      roomId: '1963694209',
      enableBilibili: false,
      paused: true,
      queueLimit: 75,
      userCooldownSeconds: 12,
      onlyFromLibrary: true,
      allowDuplicate: false,
      giftBlindBoxConfig: TEST_BLIND_BOX_CONFIG,
    });
    assert.deepEqual(runtime.getCloudSettingsSnapshot().giftBlindBoxConfig, [
      {
        name: '测试盲盒',
        price: 2.35,
        outputs: [{ name: '测试礼物', price: 3.46 }, '无定价礼物'],
      },
    ]);
    assert.deepEqual(
      JSON.parse(runtime.getSetting('giftBlindBoxConfig')),
      runtime.getCloudSettingsSnapshot().giftBlindBoxConfig,
    );

    const beforeInvalid = runtime.getSetting('giftBlindBoxConfig');
    assert.throws(
      () =>
        runtime.applyCloudSettingsSnapshot({
          roomId: '1963694209',
          enableBilibili: false,
          paused: true,
          queueLimit: 75,
          userCooldownSeconds: 12,
          onlyFromLibrary: true,
          allowDuplicate: false,
          giftBlindBoxConfig: [
            { name: '非法盲盒', price: 1, outputs: [] },
          ],
        }),
      /INVALID_GIFT_BLIND_BOX_CONFIG/,
    );
    assert.equal(runtime.getSetting('giftBlindBoxConfig'), beforeInvalid);

    runtime.applyCloudSettingsSnapshot({
      roomId: '1963694209',
      enableBilibili: false,
      paused: true,
      queueLimit: 75,
      userCooldownSeconds: 12,
      onlyFromLibrary: true,
      allowDuplicate: false,
      giftBlindBoxConfig: [],
    });
    assert.deepEqual(runtime.getCloudSettingsSnapshot().giftBlindBoxConfig, []);
    runtime.replaceCloudSongsSnapshot([{ title: '云端初始化', enabled: true }]);
    assert.equal(runtime.getCloudSongsSnapshot()[0].name, '云端初始化');
    assert.deepEqual(dirty, []);

    const headers = {
      authorization: `Bearer ${runtime.getApiToken()}`,
      'content-type': 'application/json',
      origin: server.baseUrl,
    };
    const settingsResponse = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ paused: false }),
    });
    assert.equal(settingsResponse.status, 200);
    const songResponse = await fetch(`${server.baseUrl}/api/songs/save`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '本地新增', artist: '歌手' }),
    });
    assert.equal(songResponse.status, 200);
    assert.deepEqual(dirty, ['settings', 'songs']);
  } finally {
    unsubscribe();
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
