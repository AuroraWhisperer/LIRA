'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createDesktopNotifications } = require('../../src/electron/desktop-notifications');
const { createRemoteGiftController } = require('../../src/electron/remote-gift-controller');
const { createLicenseTransport } = require('../../src/electron/license/license-transport');
const { createGiftEndpoints, createGiftOperations } = require('../../src/electron/license/gift-protocol');
const { createGiftProjectionService } = require('../../src/bilibili/gift/projection-service');
const { createGiftRetentionStore } = require('../../src/storage/gift-retention-store');
const { createFixture: createDatabaseFixture } = require('../helpers/gift-query-fixture');
const { makeProcessedGiftEvent } = require('../helpers/processed-gift-fixture');
const { capabilityPage, historyPage, createDeferred } = require('../helpers/remote-gift-controller-fixture');

const SOURCE_TIME = Date.parse('2026-11-26T12:00:00Z');

// The source owns its clock and final ledger. Only the desktop clock is skewed;
// HTTP responses pass through the real transport, protocol and source fences.
function fixture(t, skewMs = 0) {
  const scratchDir = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(scratchDir, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(scratchDir, 'gift-notification-cutoff-'));
  const requests = [];
  const historyRequests = [];
  const summaryRequests = [];
  const shown = [];
  const deliveries = [];
  const timers = new Set();
  const sources = new Map();
  let account = 10;
  let authorizationEpoch = 1;
  let localTime = SOURCE_TIME + skewMs;
  let stream;
  let boundaryResponse = null;
  let historyResponse = null;
  let failBoundary = false;
  let failHistory = false;
  let failImport = null;
  let notificationSource = null;
  let projection;
  const source = () => {
    if (!sources.has(account)) sources.set(account, { epoch: `epoch-${account}`, events: [], now: SOURCE_TIME });
    return sources.get(account);
  };
  const database = createDatabaseFixture({
    scratchDir,
    importHistoryRecord: (record, sourceId) => projection.importProcessedHistoryRecord(record, sourceId),
    importLiveEvent(event, sourceId, options) {
      if (event.eventId === failImport) throw new Error('synthetic transaction failure');
      return projection.importProcessedEvent(event, sourceId, options);
    },
  });
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    show() { shown.push(this); }
    close() { this.emit('close'); }
    constructor(options) { super(); this.options = options; }
  }
  const notificationOptions = { dataDir, Notification, now: () => localTime, getMainWindow: () => null };
  let notifications = createDesktopNotifications(notificationOptions);
  projection = createGiftProjectionService({ store: database.context.projectionStore, settings: () => ({}) }, {
    now: () => localTime,
    onGiftFinalized(row) {
      const committed = database.store.getState(row.source_id);
      deliveries.push({ row, cursorAtCallback: committed.finalCursor });
      notifications.notifyGift(row);
    },
  });
  const retention = createGiftRetentionStore({ giftDb: database.giftDb,
    now: () => new Date(localTime).toISOString(),
    importHistoryRecord: (record, sourceId) => projection.importProcessedHistoryRecord(record, sourceId),
    importLiveEvent: (event, sourceId, options) => projection.importProcessedEvent(event, sourceId, options),
  });
  const transport = createLicenseTransport({
    baseUrl: 'https://gift-source.example.test',
    now: () => localTime,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, '/api/device/gift-events');
      const owner = Number(options.headers.Authorization.slice('Bearer fixture-'.length));
      const ledger = sources.get(owner);
      const after = parsed.searchParams.has('after') ? Number(parsed.searchParams.get('after')) : null;
      const limit = Number(parsed.searchParams.get('limit'));
      const latestCursor = ledger.events.length;
      requests.push({ owner, after, limit, latestCursor });
      if (after === null && limit === 1 && failBoundary) throw new Error('synthetic offline boundary');
      const events = after === null ? [] : ledger.events.slice(after, after + limit);
      const nextCursor = after === null ? latestCursor : events.at(-1)?.cursor ?? after;
      const page = capabilityPage({
        syncEpoch: ledger.epoch, events, latestCursor, nextCursor,
        earliestCursor: latestCursor ? 1 : 0, hasMore: nextCursor < latestCursor,
        ...(ledger.retention && { giftRetentionVersion: 1, prunedThroughCursor: 0 }),
      });
      const response = new Response(JSON.stringify(ledger.legacy
        ? { ok: true, events, nextCursor, hasMore: page.hasMore } : page), {
        headers: { 'Content-Type': 'application/json', Date: new Date(ledger.now).toUTCString() },
      });
      if (after === null && limit === 1 && boundaryResponse) {
        const deferred = boundaryResponse;
        boundaryResponse = null;
        deferred.started.resolve();
        await deferred.promise;
      }
      return response;
    },
  });
  const giftOperations = createGiftOperations({
    remote: createGiftEndpoints(transport),
    withAuthorizedToken: callback => callback(`fixture-${account}`),
  });
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'AUTHORIZED' }, getState: () => 'AUTHORIZED',
    getAuthorizationEpoch: () => authorizationEpoch,
    getCloudSyncIdentity: () => ({ accountName: 'fixture', streamerId: account }),
    getRemoteBaseUrl: () => 'https://gift-source.example.test',
    getGiftEventsInternal: giftOperations.getGiftEventsInternal,
    async getGiftHistoryInternal() {
      historyRequests.push(account);
      if (failHistory) throw Object.assign(new Error('synthetic history failure'), { retryable: true });
      const page = {
        ...historyPage({ syncEpoch: source().epoch, recoveryCursor: source().events.length }),
        ...(source().retention && { giftRetentionVersion: 1, summaryRevision: 1, detailStart: '2026-08-01T16:00:00.000Z' }),
        events: source().events.map(event => ({ eventId: event.eventId, gift: event.gift,
          ...(source().retention && { finalCursor: event.cursor }),
        })),
      };
      if (historyResponse) {
        const deferred = historyResponse;
        historyResponse = null;
        deferred.started.resolve();
        await deferred.promise;
      }
      return page;
    },
    async getGiftSummariesInternal() {
      summaryRequests.push(account);
      return { ok: true, giftRetentionVersion: 1, syncEpoch: source().epoch, revision: 1, baseRevision: 0,
        summarizedBefore: '2026-11-25T16:00:00.000Z', detailStart: '2026-08-01T16:00:00.000Z',
        coveredThroughCursor: 0, rows: [], hasMore: false, nextPageToken: null, historyPageToken: 'fixture-history',
      };
    },
    watchGiftEventsInternal(options) {
      stream = options;
      options.onOpen({ syncEpoch: source().legacy ? null : source().epoch });
      return new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    },
  };
  const controller = createRemoteGiftController({
    licenseManager,
    runtime: {
      resolveGiftSource: database.store.resolveSource,
      getGiftSyncState: database.store.getState,
      commitGiftHistoryPage: database.store.commitHistoryPage,
      restartGiftHistoryBootstrap: database.store.restartHistoryBootstrap,
      commitGiftCatchUpPage: database.store.commitCatchUpPage,
      commitLegacyGiftPage: database.store.commitLegacyPage,
      resetGiftProjectionForRebuild: database.store.resetProjectionForRebuild,
      importProcessedGiftEvent: projection.importProcessedEvent,
      getGiftRetentionProgress: retention.progress,
      restartGiftRetention: retention.restart,
      commitGiftSummaryPage: retention.summaryPage,
      commitRetainedGiftHistoryPage: retention.historyPage,
      activateGiftRetention: retention.activate,
      pruneLocalGiftRetention() {},
    },
    now: () => new Date(localTime).toISOString(),
    timers: {
      setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; timers.add(timer); return timer; },
      clearTimeout(timer) { timers.delete(timer); },
    },
    onGiftNotificationSource(next) {
      notificationSource = next;
      notifications.setGiftSource(next);
    },
  });
  source();
  t.after(async () => {
    controller.dispose();
    notifications.dispose();
    await notifications.whenIdle();
    projection.dispose();
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    controller, requests, historyRequests, summaryRequests, shown, deliveries, database, source,
    get notifications() { return notifications; },
    get notificationSource() { return notificationSource; },
    setLocalTime(value) { localTime = value; },
    switchAccount() { account++; authorizationEpoch++; source(); },
    deferBoundary(deferred) {
      const started = createDeferred();
      boundaryResponse = { ...deferred, started };
      return started.promise;
    },
    failBoundary(value) { failBoundary = value; },
    failHistory(value) { failHistory = value; },
    deferHistory(deferred) {
      const started = createDeferred();
      historyResponse = { ...deferred, started };
      return started.promise;
    },
    failImport(eventId) { failImport = eventId; },
    async restartNotifications() {
      notifications.dispose();
      notifications = createDesktopNotifications(notificationOptions);
      await notifications.setGiftSource(notificationSource);
    },
    append(eventId, sourceTime = source().now) {
      const event = makeProcessedGiftEvent({
        createdAt: new Date(sourceTime).toISOString(), giftName: eventId, totalPrice: 1200, unitPrice: 1200,
      }, { eventId, cursor: source().events.length + 1 });
      source().events.push(event);
      return event;
    },
    async deliver(event) {
      stream.onEvent(event);
      await controller.whenIdle();
      await notifications.whenIdle();
    },
    async reconcile(delay = 10_000) {
      const timer = [...timers].find(item => item.delay === delay);
      assert.ok(timer, 'uses the existing reconciliation or retry timer');
      timers.delete(timer);
      timer.callback();
      await controller.whenIdle();
      await notifications.whenIdle();
    },
  };
}

for (const skew of [-60_000, 60_000]) {
  test(`source cursor separates delayed pre-enable history and post-enable finals with local skew ${skew}ms`, async (t) => {
    const f = fixture(t, skew);
    await f.controller.start();
    f.append('before-enable', SOURCE_TIME - 1000);
    await f.notifications.update({ largeGiftEnabled: true });
    f.source().now = SOURCE_TIME + 1000;
    f.setLocalTime(f.source().now + skew);
    const after = f.append('after-enable');
    // The SSE gap forces both records through actual HTTP catch-up and one DB commit.
    await f.deliver(after);
    assert.equal(f.deliveries.length, 2);
    assert.deepEqual(f.deliveries.map(item => item.cursorAtCallback), [2, 2]);
    assert.equal(f.shown.length, 1);
    assert.match(f.shown[0].options.body, /after-enable/);
    assert.equal(f.requests.filter(item => item.limit === 1).length, 1);
    t.diagnostic(JSON.stringify({ localSkewMs: skew, sourceEnableAt: new Date(SOURCE_TIME).toISOString(),
      sourceBoundary: f.requests.find(item => item.limit === 1).latestCursor,
      deliveredCursors: f.deliveries.map(item => item.row.remote_delivery.cursor), notifications: f.shown.length }));
    f.setLocalTime(SOURCE_TIME - skew);
    await f.deliver(f.append('after-clock-correction', SOURCE_TIME + 2000));
    await f.deliver(f.source().events.at(-1));
    await f.notifications.update({ largeGiftThresholdRmb: 1100 });
    await f.reconcile();
    assert.equal(f.shown.length, 2, 'live final and duplicate recovery keep the original boundary');
    assert.equal(f.requests.length, 5, 'startup 2, enable 1, gap recovery 1, ordinary reconcile 1');
  });
}

test('loaded enabled settings and re-enabling capture a fresh boundary with a frozen local clock', async (t) => {
  const f = fixture(t, 60_000);
  await f.controller.start();
  await f.notifications.update({ largeGiftEnabled: true });
  await f.deliver(f.append('first'));
  f.append('before-restart');
  await f.restartNotifications();
  await f.deliver(f.append('after-restart'));
  assert.equal(f.shown.length, 2);
  assert.match(f.shown[1].options.body, /after-restart/);
  await f.notifications.update({ largeGiftEnabled: false });
  f.append('while-disabled');
  await f.notifications.update({ largeGiftEnabled: true });
  await f.deliver(f.append('after-reenable'));
  assert.equal(f.shown.length, 3);
  assert.match(f.shown[2].options.body, /after-reenable/);
});

test('an unavailable boundary stays silent and retries only on ordinary reconciliation', async (t) => {
  const f = fixture(t, -60_000);
  await f.controller.start();
  f.failBoundary(true);
  assert.equal((await f.notifications.update({ largeGiftEnabled: true })).ok, true);
  await f.deliver(f.append('without-boundary'));
  assert.equal(f.shown.length, 0);
  assert.equal(f.requests.filter(item => item.limit === 1).length, 1);
  f.failBoundary(false);
  await f.reconcile();
  await f.deliver(f.append('with-boundary'));
  assert.equal(f.shown.length, 1);
  assert.match(f.shown[0].options.body, /with-boundary/);
  assert.equal(f.requests.filter(item => item.limit === 1).length, 2);
});

test('cold loaded enablement waits for the source; the boundary describes finalization, not platform send time', async (t) => {
  const f = fixture(t, 60_000);
  await f.notifications.update({ largeGiftEnabled: true });
  await f.restartNotifications();
  assert.equal(f.requests.length, 0, 'no clock service or request without an authorized source');
  f.append('pre-activation-history', SOURCE_TIME - 1000);
  await f.controller.start();
  await f.notifications.whenIdle();
  assert.equal(f.shown.length, 0);
  assert.equal(f.database.giftDb.prepare('SELECT COUNT(*) AS n FROM gift_events').get().n, 1,
    'cold history is actually imported without a desktop notification');
  // A long combo may have an older business timestamp but finalize after the
  // captured server cursor. The protocol cannot prove its platform send cutoff.
  await f.deliver(f.append('new-final-old-business-time', SOURCE_TIME - 600_000));
  assert.equal(f.shown.length, 1);
});

for (const retained of [false, true]) {
  test(`ordinary legacy reconciliation discovers an upgraded source (retention: ${retained})`, async (t) => {
    const f = fixture(t, -60_000);
    f.source().legacy = true;
    await f.controller.start();
    await f.notifications.update({ largeGiftEnabled: true });
    await f.deliver(f.append('legacy-history'));
    assert.equal(f.shown.length, 0);
    const before = f.requests.length;
    f.source().legacy = false;
    f.source().retention = retained;
    f.append('before-upgrade-discovery');
    await f.reconcile();
    assert.equal(f.controller.getStatus().state, 'LIVE');
    assert.equal(f.requests.length - before, 3, 'gift-events: existing catch-up discovers capability, then current catch-up and one boundary read');
    assert.equal(f.historyRequests.length, 1);
    assert.equal(f.summaryRequests.length, retained ? 1 : 0);
    assert.equal(f.shown.length, 0, 'bootstrap and pre-boundary finals stay silent');
    await f.deliver(f.append('after-upgrade'));
    assert.equal(f.shown.length, 1);
    assert.match(f.shown[0].options.body, /after-upgrade/);
    await f.reconcile();
    assert.equal(f.requests.filter(item => item.limit === 1).length, 1, 'ordinary recovery reuses the new boundary');
  });
}

test('a failed upgrade bootstrap stays silent and recovers on the existing bounded retry', async (t) => {
  const f = fixture(t);
  f.source().legacy = true;
  await f.controller.start();
  await f.notifications.update({ largeGiftEnabled: true });
  f.source().legacy = false;
  f.append('before-upgrade');
  f.failHistory(true);
  await f.reconcile();
  assert.equal(f.controller.getStatus().state, 'ERROR');
  assert.equal(f.requests.filter(item => item.limit === 1).length, 0);
  assert.equal(f.shown.length, 0);
  f.failHistory(false);
  await f.reconcile(1000);
  assert.equal(f.controller.getStatus().state, 'LIVE');
  assert.equal(f.shown.length, 0);
  await f.deliver(f.append('after-retry'));
  assert.equal(f.shown.length, 1);
});

test('an upgrade bootstrap returning after an account switch cannot commit or arm the old source', async (t) => {
  const f = fixture(t);
  f.source().legacy = true;
  await f.controller.start();
  await f.notifications.update({ largeGiftEnabled: true });
  f.source().legacy = false;
  f.append('old-source-history');
  const delayed = createDeferred();
  t.after(() => delayed.resolve());
  const started = f.deferHistory(delayed);
  const reconciling = f.reconcile();
  await started;
  f.switchAccount();
  f.append('new-source-history');
  const restarted = f.controller.start();
  delayed.resolve();
  await Promise.all([reconciling, restarted]);
  await f.notifications.whenIdle();
  assert.equal(f.database.giftDb.prepare('SELECT COUNT(*) AS n FROM gift_events').get().n, 1);
  assert.deepEqual(f.requests.filter(item => item.limit === 1).map(item => item.owner), [11]);
  assert.equal(f.shown.length, 0);
  await f.deliver(f.append('new-source-final'));
  assert.equal(f.shown.length, 1);
  assert.match(f.shown[0].options.body, /new-source-final/);
});

test('a legacy source without an epoch never substitutes local arrival or a response Date for proof', async (t) => {
  const f = fixture(t, -60_000);
  f.source().legacy = true;
  await f.notifications.update({ largeGiftEnabled: true });
  await f.controller.start();
  await f.deliver(f.append('legacy-final', SOURCE_TIME + 1000));
  assert.equal(f.deliveries.length, 1, 'legacy gift synchronization still works');
  assert.equal(f.shown.length, 0);
  assert.equal(f.requests.filter(item => item.limit === 1).length, 0);
});

test('a late boundary from a previous account cannot arm or replace the new source', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const delayed = createDeferred();
  t.after(() => delayed.resolve());
  const boundaryStarted = f.deferBoundary(delayed);
  const enabling = f.notifications.update({ largeGiftEnabled: true });
  await boundaryStarted;
  f.switchAccount();
  f.append('new-source-history');
  await f.controller.start();
  delayed.resolve();
  await enabling;
  await f.notifications.whenIdle();
  await f.deliver(f.append('new-source-final'));
  assert.equal(f.shown.length, 1);
  assert.match(f.shown[0].options.body, /new-source-final/);
  const row = f.deliveries.at(-1).row;
  f.notifications.notifyGift({ ...row, remote_delivery: { ...row.remote_delivery, sourceId: row.source_id + 1 } });
  f.notifications.notifyGift({ ...row, remote_delivery: { ...row.remote_delivery, syncEpoch: 'other-epoch' } });
  f.notifications.notifyGift({ ...row, remote_delivery: undefined });
  assert.equal(f.shown.length, 1, 'unknown, mismatched and legacy provenance cannot use a current cutoff');
});

test('disposal during the boundary read cannot arm a notification after shutdown', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  const delayed = createDeferred();
  t.after(() => delayed.resolve());
  const boundaryStarted = f.deferBoundary(delayed);
  const enabling = f.notifications.update({ largeGiftEnabled: true });
  await boundaryStarted;
  f.notifications.dispose();
  delayed.resolve();
  await enabling;
  await f.deliver(f.append('after-disposal'));
  assert.equal(f.shown.length, 0);
});

test('finals received while establishing the boundary stay silent without later replay', async (t) => {
  const f = fixture(t, -60_000);
  await f.controller.start();
  const delayed = createDeferred();
  t.after(() => delayed.resolve());
  const boundaryStarted = f.deferBoundary(delayed);
  const enabling = f.notifications.update({ largeGiftEnabled: true });
  await boundaryStarted;
  // Do not await notification.whenIdle here: the enable read is deliberately held.
  const during = f.append('while-arming', SOURCE_TIME + 1000);
  const delivery = f.deliver(during);
  assert.equal(f.deliveries.length, 1, 'the final commits before the boundary response');
  assert.equal(f.shown.length, 0);
  delayed.resolve();
  await Promise.all([enabling, delivery]);
  await f.deliver(during);
  assert.equal(f.shown.length, 0, 'duplicate ingestion does not replay a skipped notification');
  await f.deliver(f.append('armed', SOURCE_TIME + 2000));
  assert.equal(f.shown.length, 1);
});

test('only a committed final reaches notifications; source epoch replacement invalidates its boundary', async (t) => {
  const f = fixture(t);
  await f.controller.start();
  await f.notifications.update({ largeGiftEnabled: true });
  f.append('rolled-back');
  const failed = f.append('fail-import');
  f.failImport(failed.eventId);
  await f.deliver(failed);
  assert.equal(f.deliveries.length, 0);
  assert.equal(f.shown.length, 0);
  assert.equal(f.database.giftDb.prepare('SELECT COUNT(*) AS n FROM gift_events').get().n, 0);
  f.failImport(null);
  await f.controller.start();
  await f.notifications.whenIdle();
  assert.equal(f.shown.length, 0, 'recovery before a new source boundary does not replay notifications');
  await f.deliver(f.append('new-epoch-final'));
  assert.equal(f.shown.length, 1);
  const oldSource = f.notificationSource;
  f.source().epoch = 'replacement-epoch';
  await f.controller.start();
  await f.notifications.whenIdle();
  assert.equal(oldSource.isCurrent(), false);
  await f.deliver(f.append('after-rebuild'));
  assert.equal(f.shown.length, 2);
});
