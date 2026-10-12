'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('../helpers/gift-query-fixture');
const { createGiftProjectionService } = require('../../src/bilibili/gift/projection-service');
const { createGiftRetentionStore } = require('../../src/storage/gift-retention-store');
const { pruneLocalGiftBatch } = require('../../src/storage/gift-local-retention');
const { groupKey, METRIC_KEYS, normalizeGiftSummaryPage } = require('../../src/shared/gift-summary-contract');
const { normalizeProcessedGiftPage, normalizeProcessedGiftHistoryPage } = require('../../src/shared/processed-gift-contract');
const { syncRetainedGifts } = require('../../src/electron/remote-gift-retention');
const { clearGiftScopeInTransaction } = require('../../src/storage/database-clear-operations');
const { cleanupGiftRetentionBatch } = require('../../src/storage/gift-retention-cleanup');
const { createGiftProjectionStore } = require('../../src/storage/gift-projection-store');
const { DatabaseSync } = require('node:sqlite');

const NOW = '2026-10-12T04:00:00.000Z';
const BEFORE = '2026-10-11T16:00:00.000Z';
const DETAIL = '2026-07-13T16:00:00.000Z';
const OLD = '2026-01-01T02:00:00.000Z';
const DAY = '2025-12-31T16:00:00.000Z';
const RECENT = '2026-10-12T01:00:00.000Z';

function fixture(t, projectionOptions) {
  const scratch = path.resolve('tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const f = createFixture({ scratchDir: scratch });
  t.after(() => f.close());
  const source = f.resolveSource('a'.repeat(64));
  const other = f.resolveSource('b'.repeat(64));
  const projection = createGiftProjectionService({ store: f.context.projectionStore, settings: f.context.settings }, projectionOptions);
  t.after(() => projection.dispose());
  const store = createGiftRetentionStore({ giftDb: f.giftDb, now: () => NOW,
    importHistoryRecord: (record,id) => projection.importProcessedHistoryRecord(record,id),
    importLiveEvent: (event,id,options) => projection.importProcessedEvent(event,id,options) });
  const scope = () => ({ sourceId: source.id, projectionGeneration: f.store.getState(source.id).projectionGeneration });
  const statistics = (options = {}) => f.context.queryStore.readStatistics({ sourceId: source.id, query: '', range: 'all', asOf: NOW, ...options });
  return { ...f, source, other, projection, retention: store, scope, statistics };
}
function row(count = 2) {
  const dimensions = { userName: '观众', giftId: 'gift-1', giftName: '礼物', unitPriceCents: 100,
    coinType: 'gold', isBlindBox: false, giftVariantId: null, blindBoxId: null, blindBoxName: '',
    blindBoxVariantId: null, blindBoxUnitPriceCents: null };
  const metrics = Object.fromEntries(METRIC_KEYS.map((key) => [key,0]));
  Object.assign(metrics, { eventCount: count, itemCount: count, totalPriceCents: count * 100 });
  return { dayStart: DAY, groupKey: groupKey(dimensions), dimensions, metrics };
}
function summary(overrides = {}) {
  return { ok: true, giftRetentionVersion: 1, syncEpoch: 'epoch-1', revision: 1, baseRevision: 0,
    summarizedBefore: BEFORE, coveredThroughCursor: 2, detailStart: DETAIL, rows: [row()],
    hasMore: false, nextPageToken: null, historyPageToken: 'history-1', ...overrides };
}
function record(id, cursor, date = RECENT) {
  return { eventId: id, finalCursor: cursor, gift: { giftId: 'gift-1', giftName: '礼物', userName: '观众',
    num: 1, unitPrice: 1, totalPrice: 1, coinType: 'gold', isBlindBox: false,
    blindBoxId: null, blindBoxName: '', blindBoxPrice: null, blindProfit: null, createdAt: date } };
}
function history(records = [record('recent',3)], overrides = {}) {
  return { ok: true, historyBootstrapVersion: 1, giftRetentionVersion: 1, syncEpoch: 'epoch-1',
    summaryRevision: 1, detailStart: DETAIL, recoveryCursor: 3, events: records, hasMore: false,
    nextPageToken: null, ...overrides };
}
function stage(f, summaryPage = summary(), records) {
  f.retention.summaryPage({ ...f.scope(), full: true, page: summaryPage });
  f.retention.historyPage({ ...f.scope(), pageToken: summaryPage.historyPageToken, page: history(records) });
}

test('snapshot pages stay hidden until atomic activation, preserve old values on failure and fence stale accounts', (t) => {
  const f = fixture(t);
  f.insertGift(f.source.id, 'old-1', { createdAt: OLD });
  f.insertGift(f.source.id, 'old-2', { createdAt: OLD });
  f.insertGift(f.other.id, 'private', { totalPrice: 999 });
  const before = f.statistics();
  f.retention.summaryPage({ ...f.scope(), full: true, page: summary() });
  f.retention.historyPage({ ...f.scope(), pageToken: 'history-1', page: history([record('recent',3)], { hasMore: true, nextPageToken: 'history-2' }) });
  assert.deepEqual(f.statistics(), before);
  assert.equal(f.retention.progress(f.source.id).active, null);
  assert.throws(() => f.retention.historyPage({ ...f.scope(), pageToken: 'history-2',
    page: history([], { recoveryCursor: 4 }) }), /MISMATCH/);
  assert.deepEqual(f.statistics(), before);
  assert.throws(() => f.retention.historyPage({ sourceId: f.other.id, projectionGeneration: 1,
    pageToken: 'history-2', page: history([]) }), /MISMATCH/);
  f.retention.historyPage({ ...f.scope(), pageToken: 'history-2', page: history([]) });
  f.retention.activate(f.scope());
  assert.equal(f.statistics().summaryRow.totalPriceCents, 300);
  assert.equal(f.statistics().summaryRow.eventCount, 3);
  assert.equal(f.context.queryStore.countHistory({ sourceId: f.source.id, asOf: NOW }), 1);
  assert.throws(() => f.retention.activate({ sourceId: f.source.id, projectionGeneration: 1 }), /STALE/);
  assert.equal(f.context.queryStore.readStatistics({ sourceId: f.other.id, asOf: NOW, range: 'all' }).summaryRow.totalPriceCents, 99900);
});

test('changed-day replacement includes late finals once and retains the full top/date metrics', (t) => {
  const f = fixture(t);
  stage(f);
  f.retention.activate(f.scope());
  const first = f.statistics();
  const late = record('late-old',4,OLD);
  f.projection.importProcessedHistoryRecord(late,f.source.id);
  f.giftDb.prepare('UPDATE gift_events SET remote_final_cursor=4 WHERE platform_id=?').run('lira-server:late-old');
  f.giftDb.prepare('UPDATE gift_sync_state SET final_cursor=4 WHERE source_id=?').run(f.source.id);
  assert.equal(f.statistics().summaryRow.eventCount, 4);
  f.retention.summaryPage({ ...f.scope(), page: summary({ revision: 2, baseRevision: 1, coveredThroughCursor: 4, rows: [row(3)] }) });
  assert.equal(f.statistics().summaryRow.eventCount, 4);
  f.retention.activate(f.scope());
  assert.equal(f.statistics().summaryRow.eventCount, 4);
  assert.equal(f.statistics().topRows[0].itemCount, 4);
  assert.equal(f.statistics({ query: '缺席' }).summaryRow.eventCount, 0);
  assert.equal(f.statistics({ rangeStart: '2026-02-01T00:00:00.000Z' }).summaryRow.eventCount, 1);
  assert.equal(first.summaryRow.eventCount, 3);
});

test('bounded deletion keeps sprint carry and local blind-box eligibility, pins pending settlements and clears together', (t) => {
  const f = fixture(t);
  const first = f.insertGift(f.source.id, 'old-1', { createdAt: OLD, countedInSprint: 1, isBlindBox: true, blindBoxName: '测试盒', blindBoxPrice: 0.5 });
  const second = f.insertGift(f.source.id, 'old-2', { createdAt: OLD, countedInSprint: 1 });
  f.giftDb.prepare('UPDATE gift_events SET gift_stats_delivered=1 WHERE source_id=?').run(f.source.id);
  f.giftDb.prepare(`INSERT INTO overtime_settlements(gift_event_id,status,created_at,updated_at) VALUES (?,'pending',?,?)`).run(second.lastInsertRowid,OLD,OLD);
  const sourceScope = { kind: 'source', sourceId: f.source.id };
  const before = f.context.queryStore.readSprint(sourceScope);
  stage(f);
  f.retention.activate(f.scope());
  assert.equal(pruneLocalGiftBatch(f.giftDb,f.source.id,1).deleted, 1);
  assert.equal(pruneLocalGiftBatch(f.giftDb,f.source.id,1).deleted, 0);
  assert.deepEqual(f.context.queryStore.readSprint(sourceScope), before);
  const archived = f.context.queryStore.listBlindBoxRows({ sourceScope, from: DAY, to: '2026-01-02T16:00:00.000Z' });
  assert.equal(archived.length,1);
  assert.equal(archived[0].archived,true);
  assert.equal(archived[0].blind_profit,0.5);
  f.setActiveSource(f.source.id);
  const analysis = require('../../src/bilibili/gift/blind-box-analysis').getBlindBoxAnalysis(f.context,
    { startDate: '2026-01-01', endDate: '2026-01-01', view: 'records' });
  assert.equal(analysis.summary.totalProfit,0.5);
  assert.equal(analysis.hasArchivedDetails,true);
  assert.deepEqual(analysis.items,[]);
  assert.equal(f.giftDb.prepare('SELECT 1 FROM gift_events WHERE id=?').get(first.lastInsertRowid),undefined);
  assert.equal(f.projection.importProcessedEvent({ ...record('old-1',1,OLD), phase: 'final', cursor: 1 },f.source.id),null);
  f.giftDb.prepare("UPDATE overtime_settlements SET status='applied' WHERE gift_event_id=?").run(second.lastInsertRowid);
  assert.equal(pruneLocalGiftBatch(f.giftDb,f.source.id).deleted,1);
  assert.deepEqual(f.context.queryStore.readSprint(sourceScope),before);
  assert.equal(f.statistics().summaryRow.totalPriceCents,300);
  f.context.queryStore.resetSprint({ sourceScope, updatedAt: NOW });
  assert.equal(f.context.queryStore.readSprint(sourceScope).receivedRmb,0);
  f.giftDb.exec('BEGIN IMMEDIATE');
  clearGiftScopeInTransaction(f.giftDb,f.source.id,NOW);
  f.giftDb.exec('COMMIT');
  for (const table of ['gift_retention_days','gift_retention_receipts','gift_retention_snapshots','gift_local_archives','gift_sprint_carry'])
    assert.equal(f.giftDb.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
});

test('retention protocol rejects unknown/private fields, bad arithmetic and invalid empty outbox bounds', () => {
  assert.equal(normalizeGiftSummaryPage(summary()).rows[0].metrics.eventCount,2);
  const privatePage = summary(); privatePage.rows[0].dimensions.uid = 'private';
  assert.throws(() => normalizeGiftSummaryPage(privatePage));
  const invalid = summary(); invalid.rows[0].metrics.itemCount = 1;
  assert.throws(() => normalizeGiftSummaryPage(invalid));
  const empty = { ok: true, events: [], nextCursor: 7, hasMore: false, historyBootstrapVersion: 1,
    syncEpoch: 'epoch-1', earliestCursor: 8, latestCursor: 7, giftRetentionVersion: 1, prunedThroughCursor: 7 };
  assert.equal(normalizeProcessedGiftPage(empty).earliestCursor,8);
  assert.throws(() => normalizeProcessedGiftPage({ ...empty, prunedThroughCursor: 6 }));
  assert.throws(() => normalizeProcessedGiftPage({ ok: true, events: [], nextCursor: 0, hasMore: false,
    giftRetentionVersion: 1, prunedThroughCursor: 0 }));
  assert.throws(() => normalizeProcessedGiftPage({ ...empty, nextCursor: 6 }));
  assert.throws(() => normalizeProcessedGiftHistoryPage(history([{ ...record('x',3), finalCursor: 4 }])));
});

test('rate-limited history resumes and activates at its covered snapshot; subsequent finals retain live catch-up ownership', async (t) => {
  const f = fixture(t);
  const runtime = {
    getGiftRetentionProgress: f.retention.progress, restartGiftRetention: f.retention.restart,
    commitGiftSummaryPage: f.retention.summaryPage, commitRetainedGiftHistoryPage: f.retention.historyPage,
    activateGiftRetention: f.retention.activate,
    getGiftSyncState: f.store.getState,
  };
  let requested = [], limited = true;
  const licenseManager = {
    async getGiftSummariesInternal() { requested.push('summary'); return summary(); },
    async getGiftHistoryInternal({ pageToken }) {
      requested.push(pageToken);
      if (pageToken === 'history-1') return history([record('recent',3)], { hasMore: true, nextPageToken: 'history-2' });
      if (limited) throw Object.assign(new Error('RATE_LIMITED'), { retryable: true, retryAfterMs: 60000 });
      return history([]);
    },
    async getGiftEventsInternal() {
      return { ok: true, syncEpoch: 'epoch-1', events: [{ eventId: 'new-final', cursor: 4, phase: 'final', gift: record('x',4).gift }],
        nextCursor: 4, hasMore: false, latestCursor: 4, earliestCursor: 1 };
    },
  };
  const options = { ...f.scope(), runtime, licenseManager, syncEpoch: 'epoch-1', full: true, isCurrent: () => true };
  await assert.rejects(syncRetainedGifts(options),/RATE_LIMITED/);
  assert.equal(f.retention.progress(f.source.id).active,null);
  limited = false;
  assert.equal(await syncRetainedGifts(options),true);
  assert.deepEqual(requested,['summary','history-1','history-2','history-2']);
  assert.equal(f.store.getState(f.source.id).finalCursor,3);
  assert.equal(f.statistics().summaryRow.eventCount,3);
});

test('an existing progress group finishes only after activation, with its original eligibility and no historical replay', (t) => {
  const delivered = [];
  const f = fixture(t, { consumerRegistry: { dispatch: (event) => {
    delivered.push(event); return { delivered: [], failed: [] };
  } } });
  const pending = record('pending',3);
  f.projection.importProcessedEvent({ eventId: pending.eventId, phase: 'progress', cursor: null, gift: pending.gift },f.source.id);
  pending.gift.num = 2;
  pending.gift.totalPrice = 2;
  stage(f,summary(),[pending]);
  assert.equal(delivered.length,1);
  assert.equal(f.giftDb.prepare('SELECT detection_status FROM gift_events').get().detection_status,'progress');
  f.retention.activate(f.scope());
  assert.equal(delivered.length,2);
  assert.equal(delivered[1].phase,'final');
  const saved = f.giftDb.prepare('SELECT * FROM gift_events').get();
  assert.equal(saved.gift_stats_eligible,1);
  assert.equal(saved.num,2);
  assert.equal(f.statistics().summaryRow.totalPriceCents,400);
  f.projection.importProcessedEvent({ eventId: pending.eventId, phase: 'final', cursor: 3, gift: pending.gift },f.source.id);
  assert.equal(delivered.length,2);
});

test('persisted staging resumes after database reopen and obsolete snapshots are collected in bounded batches', (t) => {
  const f = fixture(t);
  f.retention.summaryPage({ ...f.scope(), full: true, page: summary() });
  f.retention.historyPage({ ...f.scope(), pageToken: 'history-1', page: history([record('recent',3)], { hasMore: true, nextPageToken: 'next' }) });
  const filename = f.giftDb.prepare('PRAGMA database_list').all().find((entry) => entry.name === 'main').file;
  f.giftDb.close();
  const reopened = new DatabaseSync(filename);
  f.databases.giftDb = reopened;
  reopened.exec('PRAGMA foreign_keys=ON');
  const projection = createGiftProjectionService({ store: createGiftProjectionStore(reopened), settings: () => ({}) });
  t.after(() => projection.dispose());
  const store = createGiftRetentionStore({ giftDb: reopened,
    importHistoryRecord: (record,id) => projection.importProcessedHistoryRecord(record,id),
    importLiveEvent: (event,id,options) => projection.importProcessedEvent(event,id,options) });
  const scope = { sourceId: f.source.id, projectionGeneration: 1 };
  assert.equal(store.progress(f.source.id).staging.history_page_token,'next');
  store.historyPage({ ...scope, pageToken: 'next', page: history([]) });
  store.activate(scope);
  const pending = record('abandoned-progress',4);
  projection.importProcessedEvent({ eventId: pending.eventId, phase: 'progress', cursor: null, gift: pending.gift },f.source.id);
  store.summaryPage({ ...scope, projectionGeneration: 2, full: true, page: summary() });
  store.historyPage({ ...scope, projectionGeneration: 2, pageToken: 'history-1', page: history([pending], { recoveryCursor: 4 }) });
  store.restart({ ...scope, projectionGeneration: 2 });
  store.summaryPage({ ...scope, projectionGeneration: 2, full: true, page: summary() });
  store.historyPage({ ...scope, projectionGeneration: 2, pageToken: 'history-1', page: history() });
  assert.equal(cleanupGiftRetentionBatch(reopened,f.source.id,1),0,'a paused download pins staging');
  store.activate({ ...scope, projectionGeneration: 2 });
  for (let i=0;i<20;i++) {
    const changes = () => reopened.prepare('SELECT total_changes() AS n').get().n;
    const before = changes();
    const n = cleanupGiftRetentionBatch(reopened,f.source.id,1);
    assert.ok(n<=1);
    assert.ok(changes()-before<=1,'abandoned pending finals must not cascade outside the batch limit');
    if (!n) break;
  }
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM gift_retention_snapshots').get().n,1);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM gift_retention_members').get().n,1);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM gift_retention_pending_finals').get().n,0);
});

test('expired incremental revisions switch to a full snapshot; a clear during download fences all late writes', async (t) => {
  const f = fixture(t);
  stage(f); f.retention.activate(f.scope());
  const requested = [];
  const runtime = { getGiftRetentionProgress: f.retention.progress, restartGiftRetention: f.retention.restart,
    commitGiftSummaryPage: f.retention.summaryPage, commitRetainedGiftHistoryPage: f.retention.historyPage,
    activateGiftRetention: f.retention.activate, getGiftSyncState: f.store.getState };
  const licenseManager = {
    async getGiftSummariesInternal({ afterRevision }) {
      requested.push(afterRevision);
      if (afterRevision) throw Object.assign(new Error('expired'),{ code: 'GIFT_QUERY_SNAPSHOT_EXPIRED' });
      return summary();
    },
    async getGiftHistoryInternal() { return history(); },
  };
  assert.equal(await syncRetainedGifts({ ...f.scope(), runtime, licenseManager, syncEpoch: 'epoch-1', full: false, isCurrent: () => true }),true);
  assert.deepEqual(requested,[1,0]);
  const stale = f.scope();
  f.retention.summaryPage({ ...stale, full: true, page: summary() });
  f.giftDb.exec('BEGIN IMMEDIATE');
  clearGiftScopeInTransaction(f.giftDb,f.source.id,NOW);
  f.giftDb.exec('COMMIT');
  assert.throws(() => f.retention.historyPage({ ...stale, pageToken: 'history-1', page: history() }),/STALE/);
  assert.equal(f.statistics().summaryRow.eventCount,0);
});

for (const previousEpoch of [null, 'old-epoch']) test(`retention controller activates before live catch-up and respects an existing ${previousEpoch} epoch`, async (t) => {
  const { createFixture: controllerFixture, capabilityPage } = require('../helpers/remote-gift-controller-fixture');
  const { createRemoteGiftController } = require('../../src/electron/remote-gift-controller');
  const { createGiftSyncStore } = require('../../src/storage/gift-sync-store');
  const delivered = [];
  const f = fixture(t, { consumerRegistry: { dispatch: (event) => {
    delivered.push(event); return { delivered: [], failed: [] };
  } } });
  if (previousEpoch) {
    f.giftDb.prepare('UPDATE gift_sync_state SET sync_epoch=?,bootstrap_complete=1,final_cursor=2 WHERE source_id=?').run(previousEpoch,f.source.id);
    f.insertGift(f.source.id,'discarded-old-epoch',{ countedInSprint: 1 });
    f.giftDb.prepare('INSERT INTO gift_sprint_carry VALUES (?,100,1)').run(f.source.id);
  }
  const final = { eventId: 'live-4', phase: 'final', cursor: 4, gift: record('live-4',4).gift };
  const controllerF = controllerFixture({ discovery: capabilityPage({ latestCursor: 4, giftRetentionVersion: 1, prunedThroughCursor: 0 }),
    historyPages: new Map([['history-1',history()]]),
    catchUpPages: new Map([[3,capabilityPage({ latestCursor: 4, nextCursor: 4, events: [final] })]]) });
  controllerF.options.licenseManager.getGiftSummariesInternal = async () => summary();
  const syncStore = createGiftSyncStore({ giftDb: f.giftDb,
    importLiveEvent: (event,id,options) => f.projection.importProcessedEvent(event,id,options) });
  Object.assign(controllerF.options.runtime, {
    resolveGiftSource: (sourceKey) => ({ ...f.source, sourceKey }),
    getGiftSyncState: syncStore.getState,
    resetGiftProjectionForRebuild: syncStore.resetProjectionForRebuild,
    commitGiftCatchUpPage: syncStore.commitCatchUpPage,
    getGiftRetentionProgress: f.retention.progress, restartGiftRetention: f.retention.restart,
    commitGiftSummaryPage: f.retention.summaryPage, commitRetainedGiftHistoryPage: f.retention.historyPage,
    activateGiftRetention: f.retention.activate,
    pruneLocalGiftRetention: (id) => pruneLocalGiftBatch(f.giftDb,id),
  });
  const controller = createRemoteGiftController(controllerF.options);
  t.after(() => controller.dispose());
  assert.equal(await controller.start(),true);
  assert.equal(controller.getStatus().state,'LIVE');
  assert.equal(controller.getCursor(),4);
  assert.equal(delivered.length,1);
  assert.equal(delivered[0].phase,'final');
  assert.equal(f.giftDb.prepare("SELECT gift_stats_eligible FROM gift_events WHERE platform_id='lira-server:live-4'").get().gift_stats_eligible,1);
  assert.equal(f.giftDb.prepare("SELECT gift_stats_eligible FROM gift_events WHERE platform_id='lira-server:recent'").get().gift_stats_eligible,0);
  assert.equal(f.statistics().summaryRow.eventCount,4);
  assert.equal(f.giftDb.prepare("SELECT id FROM gift_events WHERE platform_id='lira-server:discarded-old-epoch'").get(),undefined);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_sprint_carry').get().n,0);
});
