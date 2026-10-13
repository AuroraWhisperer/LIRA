'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHybridGiftSaleCatalogService, mergeRoomCatalog } = require('../../src/bilibili/gift/hybrid-catalog');

test('hybrid memoization invalidates for local, remote, custom and image changes and protects returned snapshots', () => {
  let localRevision = 0;
  let remoteRevision = 0;
  let imageRevision = 0;
  let custom = [];
  let reads = 0;
  let imageChecks = 0;
  const remote = {
    getRevision: () => remoteRevision,
    getSnapshot() { reads++; return { version: String(remoteRevision), gifts: [
      { id: '1', name: 'box', imagePath: 'source' }, { id: '2', name: 'output' },
    ], blindBoxes: [] }; }, refresh: async () => null,
  };
  const hybrid = createHybridGiftSaleCatalogService({
    local: { getRevision: () => localRevision, getSnapshot: () => ({ roomId: String(localRevision), gifts: [{ id: '1' }] }), refresh: async () => null },
    remoteCatalog: remote, getBlindBoxCustomConfigV2: () => custom,
    remoteImageCache: { getRevision: () => imageRevision,
      getCachedGiftImagePath() { imageChecks++; return `image-${imageRevision}`; } },
  });
  const first = hybrid.getSnapshot();
  first.gifts[0].name = 'caller mutation';
  const checks = imageChecks;
  const count = reads;
  assert.notEqual(hybrid.getSnapshot().gifts[0].name, 'caller mutation');
  assert.equal(imageChecks, checks);
  assert.equal(reads, count);
  imageRevision++;
  assert.equal(hybrid.getSnapshot().gifts[0].imagePath, 'image-1');
  localRevision++;
  assert.equal(hybrid.getSnapshot().roomId, '1');
  custom = [{ giftId: '1', outputs: [{ giftId: '2' }] }];
  assert.equal(hybrid.getSnapshot().gifts.length, 2);
  custom = [];
  assert.equal(hybrid.getSnapshot().gifts.length, 1);
  const global = hybrid.getGlobalSnapshot();
  global.gifts[0].name = 'caller mutation';
  const globalChecks = imageChecks;
  assert.equal(hybrid.getGlobalSnapshot().gifts[0].name, 'box');
  assert.equal(imageChecks, globalChecks);
  remoteRevision++;
  assert.equal(hybrid.getGlobalSnapshot().version, '1');
});

test('hybrid catalog keeps local room catalog primary and exposes remote search separately', async () => {
  const calls = { local: 0, remote: 0, search: 0 };
  const local = {
    getSnapshot: () => ({
      source: 'local',
      gifts: [
        { id: '1', name: '同名礼物' },
        { id: '2', name: '同名礼物' },
      ],
    }),
    refresh: async () => {
      calls.local += 1;
      return local.getSnapshot();
    },
  };
  const remote = {
    getSnapshot: () => ({
      source: 'server',
      version: '1',
      gifts: [
        { id: '1', name: '同名礼物', imagePath: 'first.webp' },
        { id: '2', name: '同名礼物', imagePath: 'second.webp' },
        { id: '21', name: '服务器礼物', imagePath: '' },
        { id: '22', name: '另一个礼物', imagePath: '' },
      ],
    }),
    refresh: async () => {
      calls.remote += 1;
      calls.search += 1;
      return remote.getSnapshot();
    },
  };
  const hybrid = createHybridGiftSaleCatalogService({
    local,
    remoteCatalog: remote,
  });
  assert.deepEqual(await hybrid.refresh(), {
    source: 'local',
    gifts: [
      { id: '1', name: '同名礼物', imagePath: 'first.webp' },
      { id: '2', name: '同名礼物', imagePath: 'second.webp' },
    ],
    count: 2,
    cached: false,
  });
  assert.equal(calls.local, 1);
  assert.deepEqual(hybrid.getSnapshot(), {
    source: 'local',
    gifts: [
      { id: '1', name: '同名礼物', imagePath: 'first.webp' },
      { id: '2', name: '同名礼物', imagePath: 'second.webp' },
    ],
    count: 2,
    cached: true,
  });
  const search = await hybrid.searchRemote('服务器');
  assert.deepEqual(
    search.gifts.map((gift) => gift.id),
    ['21'],
  );
  assert.equal(calls.remote, 1);
  assert.equal(calls.search, 1);
});

test('room expansion uses exact box ids and removes relation-only outputs', () => {
  const serverSnapshot = {
    gifts: [
      { id: '900', name: '同名盲盒', active: true },
      { id: '901', name: '同名盲盒', active: true },
      { id: '902', name: '有效产物', active: true },
      { id: '903', name: '停用产物', active: false },
    ],
    blindBoxes: [{ giftId: '900', outputGiftIds: ['902', '903'] }],
  };

  const wrongId = mergeRoomCatalog({ gifts: [{ id: '901', name: '同名盲盒' }] }, serverSnapshot);
  assert.deepEqual(
    wrongId.gifts.map((gift) => gift.id),
    ['901'],
  );

  const expanded = mergeRoomCatalog({ gifts: [{ id: '900', name: '同名盲盒' }] }, serverSnapshot);
  assert.deepEqual(
    expanded.gifts.map((gift) => gift.id),
    ['900', '902'],
  );

  const removed = mergeRoomCatalog({ gifts: [{ id: '900', name: '同名盲盒' }] }, { ...serverSnapshot, blindBoxes: [] });
  assert.deepEqual(
    removed.gifts.map((gift) => gift.id),
    ['900'],
  );

  const independentlyPresent = mergeRoomCatalog(
    {
      gifts: [
        { id: '900', name: '同名盲盒' },
        { id: '902', name: '有效产物' },
      ],
    },
    { ...serverSnapshot, blindBoxes: [] },
  );
  assert.deepEqual(
    independentlyPresent.gifts.map((gift) => gift.id),
    ['900', '902'],
  );
});

test('hybrid server search reports unavailable when refresh has no cache', async () => {
  const hybrid = createHybridGiftSaleCatalogService({
    local: {
      getSnapshot: () => ({ source: 'local', gifts: [] }),
      refresh: async () => ({ source: 'local', gifts: [] }),
    },
    remoteCatalog: {
      getSnapshot: () => null,
      refresh: async () => null,
    },
  });
  await assert.rejects(hybrid.searchRemote('礼物'), /服务器礼物目录本地缓存尚不可用/);
});

test('rule artwork lookup checks only the requested gift, not all catalog images', () => {
  let snapshots = 0;
  let imageChecks = 0;
  let imagePath = 'first';
  const catalog = createHybridGiftSaleCatalogService({
    local: {
      getSnapshot: () => ({ gifts: [] }),
      refresh: async () => ({ gifts: [] }),
    },
    remoteCatalog: {
      getSnapshot() {
        snapshots += 1;
        return { gifts: [] };
      },
      getGift: (id) => (id === '1001' ? { id, imagePath } : null),
      refresh: async () => ({ gifts: [] }),
    },
    remoteImageCache: {
      getCachedGiftImagePath(gift) {
        imageChecks += 1;
        return gift.imagePath;
      },
    },
  });
  const initialSnapshots = snapshots;
  assert.equal(catalog.resolveGiftImagePath('1001'), 'first');
  imagePath = 'updated';
  assert.equal(catalog.resolveGiftImagePath('1001'), 'updated');
  assert.equal(snapshots, initialSnapshots);
  assert.equal(imageChecks, 2);
});
