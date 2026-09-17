'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createRemoteGiftController } = require('../src/electron/remote-gift-controller');
const { createRemoteGiftSourceKey } = require('../src/electron/remote-gift-cursor-store');
const { createGiftSyncStore } = require('../src/storage/gift-sync-store');
const { getGiftHistory, getGiftStatistics } = require('../src/bilibili/gift/query-service');
const { createFixture: createQueryFixture } = require('./helpers/gift-query-fixture');
const { createFixture, createDeferred, capabilityPage, waitFor } = require('./helpers/remote-gift-controller-fixture');

const ORIGIN = 'https://api.example.test';

function createOwnerFixture(getGiftEventsPage) {
  const query = createQueryFixture();
  const fixture = createFixture({ getGiftEventsPage });
  const store = createGiftSyncStore({ giftDb: query.giftDb });
  const owner = { accountName: 'alice', streamerId: 10 };
  fixture.options.licenseManager.getCloudSyncIdentity = () => ({ ...owner });
  Object.assign(fixture.options.runtime, {
    resolveGiftSource: store.resolveSource,
    getGiftSyncState: store.getState,
    setActiveGiftSource: (context) => query.setActiveSource(context.sourceId, context),
  });
  return { query, fixture, store, owner };
}

test('discovery failure exposes only the verified stable owner, never same-name or legacy rows', async () => {
  const { query, fixture, store, owner } = createOwnerFixture(async () => {
    throw new Error('NETWORK_UNAVAILABLE');
  });
  const controller = createRemoteGiftController(fixture.options);
  try {
    const original = store.resolveSource(createRemoteGiftSourceKey(ORIGIN, owner));
    const legacyKey = crypto.createHash('sha256')
      .update(`gift-source-v1\n${ORIGIN}\nalice`).digest('hex');
    const legacy = store.resolveSource(legacyKey);
    query.insertGift(original.id, 'original');
    query.insertGift(legacy.id, 'legacy');
    assert.equal(await controller.start(), false);
    assert.equal(getGiftHistory(query.context, { range: 'all' }).items.length, 1,
      'the same verified owner can still read its own offline projection');

    owner.streamerId = 11;
    fixture.authorization.epoch += 1;
    assert.equal(await controller.start(), false);
    assert.equal(controller.getStatus().state, 'ERROR');
    const replacement = store.resolveSource(createRemoteGiftSourceKey(ORIGIN, owner));
    assert.notEqual(replacement.id, original.id);
    assert.notEqual(replacement.id, legacy.id);
    assert.equal(controller.getStatus().sourceId, replacement.id);
    assert.deepEqual(getGiftHistory(query.context, { range: 'all' }).items, []);
    assert.equal(getGiftStatistics(query.context, { range: 'all' }).summary.eventCount, 0);
    assert.equal(query.giftDb.prepare('SELECT count(*) AS count FROM gift_events').get().count, 2,
      'unproven and previous-owner data is retained, never reassigned or deleted');
  } finally {
    controller.dispose();
    query.close();
  }
});

test('late old-owner discovery cannot publish or advance the replacement owner', async () => {
  const deferred = createDeferred();
  let calls = 0;
  const { query, fixture, store, owner } = createOwnerFixture(async () => {
    calls += 1;
    if (calls === 1) return deferred.promise;
    throw new Error('NETWORK_UNAVAILABLE');
  });
  const controller = createRemoteGiftController(fixture.options);
  try {
    const starting = controller.start();
    await waitFor(() => calls === 1);
    const originalId = controller.getStatus().sourceId;
    owner.streamerId = 11;
    fixture.authorization.epoch += 1;
    const replacementStart = controller.start();
    assert.throws(() => getGiftHistory(query.context), { code: 'GIFT_SOURCE_UNAVAILABLE' });
    deferred.resolve(capabilityPage({ latestCursor: 99 }));
    assert.equal(await starting, false);
    assert.equal(await replacementStart, false);
    assert.notEqual(controller.getStatus().sourceId, originalId);
    assert.equal(store.getState(originalId).finalCursor, null);
    assert.equal(controller.getCursor(), null);
    assert.deepEqual(fixture.historyImports, []);
    assert.deepEqual(fixture.liveImports, []);
    assert.deepEqual(getGiftHistory(query.context, { range: 'all' }).items, []);
  } finally {
    controller.dispose();
    query.close();
  }
});

test('missing internal owner identity cannot fall back to the renderer snapshot', async () => {
  const fixture = createFixture();
  fixture.options.licenseManager.getCloudSyncIdentity = () => null;
  const controller = createRemoteGiftController(fixture.options);
  try {
    assert.equal(await controller.start(), false);
    assert.equal(controller.getStatus().sourceId, null);
    assert.deepEqual(fixture.pullCalls, []);
  } finally {
    controller.dispose();
  }
});
