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
  const resolver = hybrid.getArtworkResolver();
  assert.equal(hybrid.getArtworkResolver(), resolver);
  assert.equal(resolver('1'), 'image-1');
  const conditional = hybrid.getGlobalSnapshot({ conditional: true });
  assert.deepEqual(hybrid.getGlobalSnapshot({ conditional: true, contentRevision: conditional.contentRevision }),
    { unchanged: true, contentRevision: conditional.contentRevision });
  imageRevision++;
  const repaired = hybrid.getGlobalSnapshot({ conditional: true, contentRevision: conditional.contentRevision });
  assert.equal(repaired.version, conditional.version, 'image repair need not change the catalog version');
  assert.notEqual(repaired.contentRevision, conditional.contentRevision);
  assert.equal(hybrid.getArtworkResolver()('1'), 'image-2');
});

test('artwork resolves unique stable gift IDs from variant catalogs without guessing ambiguous artwork', () => {
  const gifts = [
    { id: '32251', variantId: 'heart-v1', name: '心动盲盒' },
    { id: '32132', variantId: 'castle-v1', name: '浪漫城堡' },
    { id: '32132', variantId: 'castle-v2', name: '浪漫城堡' },
  ];
  const checks = [];
  const hybrid = createHybridGiftSaleCatalogService({
    local: { getSnapshot: () => ({ gifts: [] }), refresh: async () => null },
    remoteCatalog: { getSnapshot: () => ({ gifts }), refresh: async () => null },
    remoteImageCache: { getCachedGiftImagePath(gift) { checks.push(gift.variantId); return `${gift.variantId}.webp`; } },
  });
  const artwork = hybrid.getArtworkResolver();
  assert.equal(artwork('32251'), 'heart-v1.webp');
  assert.equal(artwork('32132'), undefined);
  assert.equal(artwork('castle-v2'), 'castle-v2.webp');
  assert.deepEqual(checks, ['heart-v1', 'castle-v2']);
});

test('artwork resolvers check only requested images and reuse the directory index across image revisions', () => {
  let localRevision = 0;
  let remoteRevision = 0;
  let imageRevision = 0;
  let directoryReads = 0;
  const checked = [];
  const gifts = Array.from({ length: 1000 }, (_, index) => ({ id: String(index + 1), name: `Gift ${index + 1}` }));
  const hybrid = createHybridGiftSaleCatalogService({
    local: { getRevision: () => localRevision,
      getSnapshot: () => ({ gifts: [{ id: '1', name: `Room ${localRevision}` }] }), refresh: async () => null },
    remoteCatalog: { getRevision: () => remoteRevision,
      getSnapshot() { directoryReads++; return { gifts }; }, refresh: async () => null },
    remoteImageCache: { getRevision: () => imageRevision,
      getCachedGiftImagePath(gift) { checked.push(gift.id); return `${gift.name}:${imageRevision}`; } },
  });
  const resolver = hybrid.getArtworkResolver();
  assert.equal(checked.length, 0, 'an empty wish list must not inspect the whole image library');
  assert.equal(resolver('1'), 'Room 0:0');
  assert.equal(resolver('1'), 'Room 0:0');
  assert.equal(resolver('999'), 'Gift 999:0');
  assert.equal(resolver('missing'), undefined);
  assert.deepEqual(checked, ['1', '999']);
  const reads = directoryReads;
  imageRevision++;
  assert.equal(hybrid.getArtworkResolver()('1'), 'Room 0:1');
  assert.equal(directoryReads, reads, 'an image check does not rebuild unchanged gift identities');
  assert.deepEqual(checked, ['1', '999', '1']);
  localRevision++;
  assert.equal(hybrid.getArtworkResolver()('1'), 'Room 1:1');
  gifts[998] = { id: '999', name: 'Updated' };
  remoteRevision++;
  assert.equal(hybrid.getArtworkResolver()('999'), 'Updated:1');
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
  const artwork = hybrid.getArtworkResolver();
  assert.equal(artwork('1'), 'first.webp');
  assert.equal(artwork('21'), '', 'global images stay unavailable without the local image cache');
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

test('custom room outputs require unique name and price evidence and retain their configured order', () => {
  const { giftVariantId } = require('../../src/shared/gift-identity');
  const gift = (id, name, priceRaw, bagGift = false) => {
    const item = { id, name, priceRaw, coinType: 'gold', bagGift };
    return { ...item, variantId: giftVariantId(item) };
  };
  const box = gift('900', '自定义盒', 10000);
  const first = gift('901', '第一产物', 1250);
  const ambiguous = gift('902', '无法唯一确定', 3000);
  const last = gift('903', '末尾产物', 4000);
  const snapshot = { schemaVersion: 3, variantBlindBoxes: [], gifts: [
    box, first, gift('901', '同 ID 不同名', 1250), gift('901', first.name, 1500),
    ambiguous, gift('902', ambiguous.name, ambiguous.priceRaw, true), last,
  ] };
  const customItem = (item) => ({ giftId: item.id, name: item.name, price: item.priceRaw / 1000 });
  const custom = [{ ...customItem(box), outputs: [first, ambiguous, last, first].map(customItem) }];
  const merged = mergeRoomCatalog({ gifts: [box] }, snapshot, custom);
  assert.deepEqual(merged.gifts.map((item) => item.variantId), [box.variantId, first.variantId, last.variantId]);

  snapshot.gifts.push(gift(box.id, box.name, box.priceRaw, true));
  assert.equal(mergeRoomCatalog({ gifts: [box] }, snapshot, custom).gifts.length, 1,
    'ambiguous box evidence cannot attach any custom outputs');
});
