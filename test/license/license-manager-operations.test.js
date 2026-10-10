'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mapSongForSync } = require('../../src/electron/license/license-manager');
const { createHarness } = require('../helpers/license-manager-harness');

test('profile reads share only the current in-flight request and retry after failure', async (t) => {
  const { manager, remote } = createHarness({ identity: { deviceId: 'd', publicKeyPem: 'public' } });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  let calls = 0;
  let finish;
  remote.profile = () => {
    calls += 1;
    return new Promise((resolve, reject) => { finish = { resolve, reject }; });
  };
  const concurrent = Promise.all(Array.from({ length: 6 }, () => manager.getProfile()));
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  finish.resolve({ streamer: { accountName: 'mlbb' } });
  assert.equal((await concurrent).length, 6);
  const failed = assert.rejects(manager.getProfile(), { code: 'NETWORK_UNAVAILABLE' });
  await new Promise(setImmediate);
  assert.equal(calls, 2);
  finish.reject(Object.assign(new Error(), { code: 'NETWORK_UNAVAILABLE' }));
  await failed;
  const refreshed = manager.getProfile();
  await new Promise(setImmediate);
  assert.equal(calls, 3);
  finish.resolve({ streamer: { accountName: 'mlbb', displayName: 'Refreshed' } });
  assert.equal((await refreshed).streamer.displayName, 'Refreshed');
});

test('song sync maps local snake_case song fields to the remote contract', () => {
  assert.deepEqual(
    mapSongForSync({
      title: 'Song',
      artist: 'Artist',
      category_name: 'Pop',
      source_platform: 'QQ',
      request_price: '30',
      song_clip: 'clip',
      is_enabled: 0,
      sort_order: 3,
    }),
    {
      title: 'Song',
      artist: 'Artist',
      categoryName: 'Pop',
      tags: '',
      language: '',
      sourcePlatform: 'QQ',
      note: '',
      requestPrice: '30',
      songClip: 'clip',
      enabled: false,
      sortOrder: 3,
    },
  );
  assert.equal(mapSongForSync({ title: 'Free', requestPrice: ' 免费 ' }).requestPrice, '免费');
  assert.equal(mapSongForSync({ title: 'Guard', request_price: '舰长' }).requestPrice, '舰长');
  assert.equal(mapSongForSync({ title: 'Legacy', requestPrice: 12.5 }).requestPrice, 12.5);
  assert.equal(mapSongForSync({ title: 'Empty' }).requestPrice, null);
});

test('song counts use cloud summaries and read full songs only for an older server', async (t) => {
  const { manager, remote } = createHarness({ identity: { deviceId: 'd', publicKeyPem: 'public' } });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  let reads = 0;
  let songs = { initialized: true, revision: 2, count: 3 };
  remote.getCloudState = async () => ({ songs });
  remote.getCloudSongs = async () => { reads += 1; return { songs: [{}, {}] }; };
  assert.deepEqual(await manager.getCloudSongCount(), { count: 3 });
  songs.count = 0;
  assert.deepEqual(await manager.getCloudSongCount(), { count: 0 });
  assert.equal(reads, 0);
  delete songs.count;
  assert.deepEqual(await manager.getCloudSongCount(), { count: 2 });
  assert.equal(reads, 1);
  for (const invalid of [-1, 0.5, '3', null]) {
    songs.count = invalid;
    await assert.rejects(manager.getCloudSongCount(), { code: 'INVALID_RESPONSE' });
  }
  assert.equal(reads, 1);
});

test('song uploads require a success acknowledgement for the complete submitted snapshot', async (t) => {
  const { manager, remote } = createHarness({ identity: { deviceId: 'd', publicKeyPem: 'public' } });
  t.after(() => manager.dispose());
  await manager.bootstrap();
  for (const response of [{}, { ok: true }, { ok: true, count: 0 }, { ok: true, count: '1' }, { ok: false, count: 1 }]) {
    remote.syncSongs = async () => response;
    await assert.rejects(manager.syncSongs([{ title: 'One' }]), { code: 'INVALID_RESPONSE' });
  }
  remote.syncSongs = async () => ({ ok: true, count: 1 });
  assert.deepEqual(await manager.syncSongs([{ title: 'One' }]), { ok: true, count: 1 });
});

test('song background operations use the authorized device token and preserve binary bytes', async () => {
  const { manager, backgroundCalls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  assert.deepEqual(await manager.getSongPageBackground(), {
    ok: true,
    background: {
      url: '/background.png',
      previewUrl: 'https://api.example.test/background.png',
    },
  });
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(await manager.uploadSongPageBackground(bytes, 'cover.JPG'), {
    ok: true,
    background: {
      url: '/background.png',
      previewUrl: 'https://api.example.test/background.png',
    },
  });
  assert.equal(Buffer.isBuffer(backgroundCalls[0].bytes), true);
  assert.deepEqual([...backgroundCalls[0].bytes], [1, 2, 3]);
  assert.equal(backgroundCalls[0].contentType, 'image/jpeg');
  assert.equal(backgroundCalls[0].token, 'token');
  assert.deepEqual(await manager.deleteSongPageBackground(), {
    ok: true,
    background: null,
  });
  manager.dispose();
});

test('gift catalog refresh is authorization-gated but uses the public endpoint without a bearer token', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  const result = await manager.getGiftCatalog({ etag: '"old-catalog"' });
  assert.equal(result.version, 'catalog-1');
  assert.equal(result.imageBaseUrl, 'https://api.example.test');
  assert.deepEqual(calls.catalog, [{ etag: '"old-catalog"', token: undefined }]);
  manager.dispose();
});

test('internal gift operations use the current authorized token and bypass public IPC', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  const signal = new AbortController().signal;

  const syncEpoch = 'x'.repeat(128);
  const pageToken = 't'.repeat(4096);
  const page = await manager.getGiftEventsInternal({
    after: 4,
    limit: 17,
    syncEpoch,
    signal,
  });
  const historyPage = await manager.getGiftHistoryInternal({
    pageToken,
    signal,
  });
  const cleared = await manager.clearGiftHistoryInternal({ signal });
  await manager.watchGiftEventsInternal({ signal, onEvent() {} });

  assert.deepEqual(page, {
    ok: true,
    events: [],
    nextCursor: 4,
    hasMore: false,
  });
  assert.deepEqual(calls.giftEventRequests, [{ after: 4, limit: 17, token: 'token' }]);
  assert.equal(calls.giftEventOptions[0].syncEpoch, syncEpoch);
  assert.equal(calls.giftEventOptions[0].signal, signal);
  assert.equal(historyPage.recoveryCursor, 4);
  assert.equal(calls.giftHistoryRequests[0].pageToken, pageToken);
  assert.equal(calls.giftHistoryRequests[0].token, 'token');
  assert.equal(calls.giftHistoryRequests[0].options.signal, signal);
  assert.deepEqual(cleared, {
    ok: true,
    deletedCounts: { giftEvents: 12, giftEventDeliveries: 10 },
    syncEpoch: 'epoch-2',
  });
  assert.equal(calls.giftHistoryClearRequests[0].token, 'token');
  assert.equal(calls.giftHistoryClearRequests[0].options.signal, signal);
  assert.equal(calls.giftWatchRequests.length, 1);
  assert.equal(calls.giftWatchRequests[0].token, 'token');
  assert.equal(calls.giftWatchRequests[0].options.signal, signal);
  manager.dispose();
});

test('gift card profiles retain sender evidence and reject replies after authorization disposal', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  const signal = new AbortController().signal;
  const result = { ok: true, items: [{ senderId: '123', userName: '新昵称', guardLevel: 2 }] };
  remote.getGiftCardProfiles = async (cursor, token, options) => {
    assert.equal(cursor, 'event:1');
    assert.equal(token, 'token');
    assert.equal(options.signal, signal);
    return result;
  };
  assert.deepEqual(await manager.getGiftCardProfilesInternal({ cursor: 'event:1', signal }), result);
  let resolve;
  let started;
  const ready = new Promise((done) => {
    started = done;
  });
  remote.getGiftCardProfiles = () =>
    new Promise((done) => {
      resolve = done;
      started();
    });
  const pending = manager.getGiftCardProfilesInternal();
  await ready;
  manager.dispose();
  resolve(result);
  await assert.rejects(pending, { code: 'LICENSE_NOT_AUTHORIZED' });
});

test('internal gift operations reject coerced and oversized cursors before remote I/O', async () => {
  const { manager, calls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  for (const input of [
    { after: '4' },
    { after: 1.5 },
    { syncEpoch: 1 },
    { syncEpoch: '' },
    { syncEpoch: 'x'.repeat(129) },
  ]) {
    await assert.rejects(manager.getGiftEventsInternal(input), (error) => error.code === 'INVALID_GIFT_CURSOR');
  }
  for (const pageToken of [1, '', 'x'.repeat(4097)]) {
    await assert.rejects(
      manager.getGiftHistoryInternal({ pageToken }),
      (error) => error.code === 'INVALID_BOOTSTRAP_TOKEN',
    );
  }

  assert.deepEqual(calls.giftEventRequests, []);
  assert.deepEqual(calls.giftHistoryRequests, []);
  manager.dispose();
});

test('internal gift clear rejects malformed server success responses', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.clearGiftHistory = async () => ({
    ok: true,
    deletedCounts: { giftEvents: '12', giftEventDeliveries: 10 },
    syncEpoch: 'epoch-2',
  });

  await assert.rejects(
    manager.clearGiftHistoryInternal(),
    (error) => error.code === 'INVALID_RESPONSE' && error.retryable === true,
  );
  manager.dispose();
});

test('song background preview rejects credential query parameters', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.getSongPageBackground = async () => ({
    ok: true,
    background: { url: '/background.png?token=secret&v=1' },
  });

  await assert.rejects(manager.getSongPageBackground(), (error) => error.code === 'BACKGROUND_URL_INVALID');
  manager.dispose();
});

test('protected remote responses cannot echo credentials across the renderer boundary', async () => {
  const { manager, remote } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();
  remote.syncSongs = async () => ({
    ok: true,
    count: 0,
    accessToken: 'secret-token',
    nested: {
      refresh_token: 'secret-refresh-token',
      private_key_pem: 'secret-key',
      safe: 'keep',
    },
  });

  assert.deepEqual(await manager.syncSongs([]), {
    ok: true,
    count: 0,
    nested: { safe: 'keep' },
  });
  manager.dispose();
});

test('song background upload validates size and filename before authorization request', async () => {
  const { manager, backgroundCalls } = createHarness({
    identity: { deviceId: 'd', publicKeyPem: 'public' },
  });
  await manager.bootstrap();

  await assert.rejects(
    manager.uploadSongPageBackground(new Uint8Array([1]), 'cover.txt'),
    (error) => error.code === 'BACKGROUND_FORMAT_UNSUPPORTED',
  );
  await assert.rejects(
    manager.uploadSongPageBackground(new Uint8Array(5 * 1024 * 1024 + 1), 'cover.png'),
    (error) => error.code === 'PAYLOAD_TOO_LARGE',
  );
  assert.equal(backgroundCalls.length, 0);
  manager.dispose();
});

test('cloud settings and Bilibili credential writes validate input and need an authorized session', async () => {
  const { manager, calls } = createHarness({ identity: { deviceId: 'd', publicKeyPem: 'public' } });
  await manager.bootstrap();

  for (const settings of [null, undefined, [], 'queueLimit=1', 7]) {
    await assert.rejects(manager.updateCloudSettings(settings), { code: 'INVALID_SYNC_SETTINGS' });
  }
  for (const cookie of ['', '   ', null, undefined, 'SESSDATA=a\r\nX-Injected: 1', 'SESSDATA=a\nb', 'SESSDATA=a\0b', 'x'.repeat(12_001)]) {
    await assert.rejects(manager.setBilibiliCredentialsInternal(cookie), { code: 'BILIBILI_CREDENTIALS_INVALID' });
  }
  assert.deepEqual(calls.cloudSettingsRequests, []);
  assert.deepEqual(calls.bilibiliCredentialRequests, []);

  const boundary = `SESSDATA=${'x'.repeat(12_000 - 'SESSDATA='.length)}`;
  await manager.setBilibiliCredentialsInternal(`  ${boundary}  `);
  await manager.updateCloudSettings({ queueLimit: 7 });
  await manager.getBilibiliCredentialsInternal();
  await manager.clearBilibiliCredentialsInternal();
  assert.deepEqual(calls.cloudSettingsRequests, [{ settings: { queueLimit: 7 }, token: 'token' }]);
  assert.deepEqual(calls.bilibiliCredentialRequests, [
    { action: 'set', cookie: boundary, token: 'token' },
    { action: 'get', token: 'token' },
    { action: 'clear', token: 'token' },
  ]);
  manager.dispose();

  const unauthorized = createHarness();
  await unauthorized.manager.bootstrap();
  for (const operation of [
    () => unauthorized.manager.updateCloudSettings({ queueLimit: 7 }),
    () => unauthorized.manager.setBilibiliCredentialsInternal('SESSDATA=a'),
    () => unauthorized.manager.getBilibiliCredentialsInternal(),
    () => unauthorized.manager.clearBilibiliCredentialsInternal(),
  ]) {
    await assert.rejects(operation(), (error) => error.message === 'LICENSE_NOT_AUTHORIZED');
  }
  assert.deepEqual(unauthorized.calls.cloudSettingsRequests, []);
  assert.deepEqual(unauthorized.calls.bilibiliCredentialRequests, []);
  unauthorized.manager.dispose();
});
