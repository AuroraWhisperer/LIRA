'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mapSongForSync } = require('../src/electron/license/license-manager');
const { createHarness } = require('./helpers/license-manager-harness');

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
      name: 'Song',
      artist: 'Artist',
      categoryName: 'Pop',
      tags: '',
      language: '',
      sourcePlatform: 'QQ',
      note: '',
      requestPrice: '30',
      songClip: 'clip',
      isEnabled: false,
      sortOrder: 3,
    },
  );
  assert.equal(
    mapSongForSync({ title: 'Free', requestPrice: ' 免费 ' }).requestPrice,
    '免费',
  );
  assert.equal(
    mapSongForSync({ title: 'Guard', request_price: '舰长' }).requestPrice,
    '舰长',
  );
  assert.equal(
    mapSongForSync({ title: 'Legacy', requestPrice: 12.5 }).requestPrice,
    12.5,
  );
  assert.equal(mapSongForSync({ title: 'Empty' }).requestPrice, null);
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
  assert.deepEqual(calls.catalog, [
    { etag: '"old-catalog"', token: undefined },
  ]);
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
  assert.deepEqual(calls.giftEventRequests, [
    { after: 4, limit: 17, token: 'token' },
  ]);
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
    await assert.rejects(
      manager.getGiftEventsInternal(input),
      (error) => error.code === 'INVALID_GIFT_CURSOR',
    );
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

  await assert.rejects(
    manager.getSongPageBackground(),
    (error) => error.code === 'BACKGROUND_URL_INVALID',
  );
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
    manager.uploadSongPageBackground(
      new Uint8Array(5 * 1024 * 1024 + 1),
      'cover.png',
    ),
    (error) => error.code === 'PAYLOAD_TOO_LARGE',
  );
  assert.equal(backgroundCalls.length, 0);
  manager.dispose();
});
