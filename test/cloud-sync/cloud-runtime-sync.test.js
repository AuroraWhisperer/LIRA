'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const songService = require('../../src/music/song-service');
const { createServerRuntime } = require('../../src/server');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { createQueueStore } = require('../../src/storage/queue-store');
const { createSongStore } = require('../../src/storage/song-store');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

test('account recovery gates song edits and current-library reads until the replacement reaches storage', async () => {
  const dataDir = createScratchDirectory('cloud-song-account-runtime-');
  const runtime = createServerRuntime({ dataDir, licenseGate: { isAuthorized: () => true } });
  try {
    const server = await runtime.start({ host: '127.0.0.1', startPort: 0 });
    runtime.prepareCloudRoomAccount('first');
    runtime.replaceCloudSongsSnapshot([{ title: 'First library' }], 'first');
    runtime.prepareCloudRoomAccount('second');
    assert.throws(() => runtime.getCloudSongsSnapshot('second'), { code: 'CLOUD_SONGS_NOT_READY' });
    const save = () => fetch(`${server.baseUrl}/api/songs/save`, {
      method: 'POST',
      headers: { authorization: `Bearer ${runtime.getApiToken()}`, 'content-type': 'application/json', origin: server.baseUrl },
      body: JSON.stringify({ name: 'Second edit' }),
    });
    const rejected = await save();
    assert.equal(rejected.status, 503);
    const error = await rejected.json();
    assert.equal(error.code, 'CLOUD_SONGS_NOT_READY');
    assert.ok(error.error);
    assert.equal(runtime.getCloudSongsSnapshot()[0].name, 'First library');
    assert.equal(runtime.hasPendingCloudSongs('second'), false);

    runtime.replaceCloudSongsSnapshot([{ title: 'Second library' }], 'second');
    const saved = await save();
    assert.equal(saved.status, 200);
    assert.deepEqual(runtime.getCloudSongsSnapshot('second').map((song) => song.name).sort(), ['Second edit', 'Second library']);
    assert.ok(runtime.hasPendingCloudSongs('second'));
  } finally {
    await runtime.stop({ exitProcess: false });
    removeScratchDirectory(dataDir);
  }
});

test('room account preparation reaches the runtime without dirty echo or metadata exposure', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-room-runtime-'));
  const runtime = createServerRuntime({
    dataDir,
    licenseGate: { isAuthorized: () => true },
  });
  const dirty = [];
  const unsubscribe = runtime.onCloudSyncRequested((scope) => dirty.push(scope));
  try {
    await runtime.start({ host: '127.0.0.1', startPort: 0 });
    assert.equal(runtime.prepareCloudRoomAccount('first'), true);
    runtime.applyCloudSettingsSnapshot({
      ...runtime.getCloudSettingsSnapshot(),
      roomId: '111',
      enableBilibili: false,
      danmakuMonitoringEnabled: false,
      giftMonitoringEnabled: false,
    });
    assert.equal(runtime.prepareCloudRoomAccount('first'), false);
    assert.equal(runtime.getCloudSettingsSnapshot().roomId, '111');
    assert.equal(runtime.prepareCloudRoomAccount('second'), true);
    assert.equal(runtime.getCloudSettingsSnapshot().roomId, '');
    assert.equal(runtime.getSetting('cloudRoomAccountKey'), undefined);
    assert.equal(runtime.getCloudSettingsSnapshot().cloudRoomAccountKey, undefined);
    assert.deepEqual(dirty, []);
  } finally {
    unsubscribe();
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('previewed song updates run through the API facade and request one complete cloud snapshot', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-import-update-runtime-'));
  const runtime = createServerRuntime({
    dataDir,
    licenseGate: { isAuthorized: () => true },
  });
  const snapshots = [];
  const unsubscribe = runtime.onCloudSyncRequested((scope) => {
    if (scope === 'songs') snapshots.push(runtime.getCloudSongsSnapshot());
  });
  try {
    const server = await runtime.start({ host: '127.0.0.1', startPort: 0 });
    const accountKey = JSON.stringify(['https://api.example.test', 'fixture', 1]);
    runtime.prepareCloudRoomAccount(accountKey);
    assert.equal(runtime.hasPendingCloudSongs(accountKey), false);
    assert.equal(runtime.getPendingCloudSongs(accountKey), null);
    const headers = {
      authorization: `Bearer ${runtime.getApiToken()}`,
      'content-type': 'application/json',
      origin: server.baseUrl,
    };
    async function call(endpoint, body) {
      const response = await fetch(`${server.baseUrl}/api/songs/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    await call('save', {
      name: '本地原曲',
      artist: '甲',
      requestPrice: '舰长',
      sourcePlatform: 'QQ音乐',
    });
    snapshots.length = 0;
    const input = {
      rows: [
        { name: '本地原曲', artist: '甲', requestPrice: '30元SC' },
        { name: '新曲', requestPrice: '免费' },
      ],
    };
    const preview = await call('import-preview', input);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.counts.updated, 1);
    assert.equal(snapshots.length, 0);
    const stale = await call('import-apply', {
      ...input,
      previewToken: 'stale',
    });
    assert.equal(stale.status, 409);
    assert.equal(snapshots.length, 0);
    const applied = await call('import-apply', {
      ...input,
      previewToken: preview.body.data.previewToken,
    });
    assert.equal(applied.status, 200);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].length, 2);
    assert.equal(snapshots[0].find((song) => song.name === '本地原曲').request_price, '30元SC');
    assert.equal(snapshots[0].find((song) => song.name === '本地原曲').source_platform, 'QQ音乐');
    assert.equal(runtime.hasPendingCloudSongs(accountKey), true);
    assert.equal(runtime.hasPendingCloudSongs('other-account'), false);
    const pending = runtime.getPendingCloudSongs(accountKey);
    assert.equal(pending.songs.length, 2);
    assert.equal(pending.songs.find((song) => song.name === '本地原曲').request_price, '30元SC');
    const response = await fetch(`${server.baseUrl}/api/state`, { headers });
    assert.equal(response.status, 200);
    const settings = (await response.json()).data.settings;
    assert.equal(
      Object.keys(settings).some((key) => key.startsWith('cloudSongSyncPending:')),
      false,
    );
    assert.equal(runtime.acknowledgePendingCloudSongs(accountKey, pending.mutationId), true);
    assert.equal(runtime.hasPendingCloudSongs(accountKey), false);
    assert.equal(runtime.getPendingCloudSongs(accountKey), null);
    assert.equal(snapshots.length, 1, 'acknowledgement does not emit a dirty echo');
  } finally {
    unsubscribe();
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

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
  const songStore = createSongStore(songDb);

  try {
    const oldSong = songService.saveSong(songStore, {
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

    const result = songService.replaceCloudSongs(songStore, [
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
    assert.equal(songDb.prepare('SELECT name FROM song_categories WHERE name=?').get('旧分类'), undefined);
    assert.deepEqual(
      {
        ...songDb.prepare('SELECT song_id,song_name FROM queue WHERE id=?').get(queueItem.id),
      },
      { song_id: null, song_name: '旧歌曲' },
    );
    assert.deepEqual(
      {
        ...songDb.prepare('SELECT song_id,song_name,message FROM requests WHERE queue_id=?').get(queueItem.id),
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
    const appliedSettings = runtime.getCloudSettingsSnapshot();
    for (const [key, value] of Object.entries({
      roomId: '1963694209',
      enableBilibili: false,
      danmakuMonitoringEnabled: false,
      giftMonitoringEnabled: false,
      paused: true,
      queueLimit: 75,
      userCooldownSeconds: 12,
      onlyFromLibrary: true,
      allowDuplicate: false,
    })) assert.equal(appliedSettings[key], value, key);
    assert.deepEqual(appliedSettings.giftBlindBoxConfig, localBlindBoxConfig);

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
          giftBlindBoxConfig: [{ name: '非法盲盒', price: 1, outputs: [] }],
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
    const mappingState = {
      mode: 'v2',
      catalogVersion: 'sha256:catalog',
      settingsRevision: 7,
      customCount: 1,
      takenOverCount: 2,
      migrationPendingCount: 0,
      applied: true,
    };
    runtime.setBlindBoxMappingState(mappingState);
    const stateResponse = await fetch(`${server.baseUrl}/api/state`, {
      headers,
    });
    assert.equal(stateResponse.status, 200);
    assert.deepEqual((await stateResponse.json()).data.blindBoxMapping, mappingState);
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

test('local song mutations emit complete snapshots for cloud upload', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-song-mutations-'));
  const runtime = createServerRuntime({
    dataDir,
    licenseGate: { isAuthorized: () => true },
  });
  const requestedSnapshots = [];
  const unsubscribe = runtime.onCloudSyncRequested((scope) => {
    if (scope !== 'songs') return;
    requestedSnapshots.push(
      runtime.getCloudSongsSnapshot().map((song) => ({
        name: song.name,
        artist: song.artist,
        tags: song.tags,
        is_enabled: song.is_enabled,
      })),
    );
  });

  try {
    const server = await runtime.start({ host: '127.0.0.1', startPort: 0 });
    const headers = {
      authorization: `Bearer ${runtime.getApiToken()}`,
      'content-type': 'application/json',
      origin: server.baseUrl,
    };
    const save = async (body) => {
      const response = await fetch(`${server.baseUrl}/api/songs/save`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      return (await response.json()).data;
    };
    const remove = async (id) => {
      const response = await fetch(`${server.baseUrl}/api/songs/delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id }),
      });
      assert.equal(response.status, 200);
    };

    const first = await save({ name: '本地新增', artist: '原歌手' });
    const second = await save({ name: '另一首', artist: '另一歌手' });
    await save({
      id: first.id,
      name: '本地编辑',
      artist: '新歌手',
      tags: '编辑标签',
      isEnabled: false,
    });
    await remove(second.id);

    const clearResponse = await fetch(`${server.baseUrl}/api/database/clear`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(clearResponse.status, 200);

    assert.deepEqual(requestedSnapshots, [
      [{ name: '本地新增', artist: '原歌手', tags: '', is_enabled: true }],
      [
        { name: '本地新增', artist: '原歌手', tags: '', is_enabled: true },
        { name: '另一首', artist: '另一歌手', tags: '', is_enabled: true },
      ],
      [
        {
          name: '本地编辑',
          artist: '新歌手',
          tags: '编辑标签',
          is_enabled: false,
        },
        { name: '另一首', artist: '另一歌手', tags: '', is_enabled: true },
      ],
      [
        {
          name: '本地编辑',
          artist: '新歌手',
          tags: '编辑标签',
          is_enabled: false,
        },
      ],
      [],
    ]);
  } finally {
    unsubscribe();
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
