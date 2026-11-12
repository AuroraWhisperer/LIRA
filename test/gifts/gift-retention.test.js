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
const { createGiftWishStore } = require('../../src/storage/gift-wish-store');
const schema = require('../../src/storage/schema');
const { runAllMigrations } = require('../../src/storage/database-migrations');
const { getBlindBoxAnalysis } = require('../../src/bilibili/gift/blind-box-analysis');
const { getGiftHistory, getGiftSelection } = require('../../src/bilibili/gift/query-service');
const { DAY_MS, dayStart } = require('../../src/shared/gift-summary-contract');

const NOW = '2026-10-12T04:00:00.000Z';
const BEFORE = '2026-10-11T16:00:00.000Z';
const DETAIL = '2026-07-13T16:00:00.000Z';
const OLD = '2025-01-01T02:00:00.000Z';
const DAY = '2024-12-31T16:00:00.000Z';
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

function publishExisting(f) {
  const id = Number(f.giftDb.prepare(`INSERT INTO gift_retention_snapshots
    (source_id,projection_generation,sync_epoch,revision,base_revision,summarized_before,covered_cursor,
      detail_start,phase,updated_at) VALUES (?,1,'epoch-1',0,0,?,0,?,'active',?)`)
    .run(f.source.id,DAY,DAY,OLD).lastInsertRowid);
  f.giftDb.prepare('UPDATE gift_retention_snapshots SET member_snapshot_id=? WHERE id=?').run(id,id);
  f.giftDb.prepare('INSERT INTO gift_retention_state(source_id,active_snapshot_id) VALUES (?,?)').run(f.source.id,id);
  f.giftDb.prepare('INSERT INTO gift_retention_members SELECT ?,id FROM gift_events WHERE source_id=?').run(id,f.source.id);
  f.giftDb.prepare('UPDATE gift_events SET remote_final_cursor=id WHERE source_id=?').run(f.source.id);
  f.giftDb.prepare("UPDATE gift_sync_state SET sync_epoch='epoch-1',final_cursor=2,bootstrap_complete=1 WHERE source_id=?").run(f.source.id);
}

test('a same-epoch rebuild preserves 200-day details and export selection without double-counting', (t) => {
  const f = fixture(t);
  f.context.now = () => NOW;
  f.setActiveSource(f.source.id, { syncState: 'LIVE', partial: false, dirty: false, epochValidated: true });
  const oldDay = new Date(Date.parse(BEFORE) - 200 * DAY_MS).toISOString();
  const oldBefore = new Date(Date.parse(BEFORE) - 190 * DAY_MS).toISOString();
  const oldDetail = new Date(Date.parse(oldBefore) - 90 * DAY_MS).toISOString();
  const contribution = { ...row(1), dayStart: oldDay };
  f.retention.summaryPage({ ...f.scope(), full: true, page: summary({
    summarizedBefore: oldBefore, detailStart: oldDetail, rows: [contribution] }) });
  f.retention.historyPage({ ...f.scope(), pageToken: 'history-1', page: history([record('kept', 1, oldDay)],
    { detailStart: oldDetail, recoveryCursor: 2 }) });
  f.retention.activate(f.scope());
  f.giftDb.prepare('UPDATE gift_sync_state SET final_cursor=3 WHERE source_id=?').run(f.source.id);
  for (let rebuild = 0; rebuild < 2; rebuild++) {
    stage(f, summary({ rows: [contribution] }));
    f.retention.activate(f.scope());
    while (cleanupGiftRetentionBatch(f.giftDb, f.source.id, 1)) {}
  }
  const date = new Date(Date.parse(oldDay) + 8 * 3600000).toISOString().slice(0,10);
  const filtered = { range: 'all', startDate: date, endDate: date };
  const page = getGiftHistory(f.context, filtered);
  assert.equal(page.total, 1);
  assert.deepEqual(page.items.map(item => item.eventId), ['kept']);
  assert.equal(page.retention.availability, 'retained');
  assert.equal(getGiftSelection(f.context, { ...filtered, viewRevision: page.viewRevision,
    eventIds: ['kept'] }).items.length, 1);
  assert.equal(f.statistics().summaryRow.eventCount, 2);
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id).deleted, 0);

  const newMachine = fixture(t);
  stage(newMachine, summary({ rows: [contribution] }));
  newMachine.retention.activate(newMachine.scope());
  const oldRange = { rangeStart: oldDay, rangeEnd: new Date(Date.parse(oldDay)+DAY_MS).toISOString() };
  assert.equal(newMachine.context.queryStore.getRetention(newMachine.source.id, oldRange).availability, 'partial');
  assert.equal(newMachine.context.queryStore.countHistory({ sourceId: newMachine.source.id, asOf: NOW, ...oldRange }), 0);

  // A missed late final can belong to this same old day, outside server recovery.
  f.retention.summaryPage({ ...f.scope(), full: true, page: summary({ revision: 2,
    coveredThroughCursor: 4, rows: [{ ...row(2), dayStart: oldDay }] }) });
  f.retention.historyPage({ ...f.scope(), pageToken: 'history-1', page: history([], { summaryRevision: 2, recoveryCursor: 4 }) });
  f.retention.activate(f.scope());
  const partial = getGiftHistory(f.context, filtered);
  assert.equal(partial.total, 1, 'the received detail remains readable');
  assert.equal(partial.retention.availability, 'partial', 'summary two / detail one cannot retain a complete proof');
  assert.equal(f.statistics().summaryRow.eventCount, 3);
  f.setActiveSource(f.other.id);
  assert.equal(getGiftHistory(f.context, filtered).total, 0);
});

test('local deletion uses the trusted 365-day boundary, commits checkpoints atomically and revisits late arrivals next day', (t) => {
  const f = fixture(t);
  const cutoff = new Date(Date.parse(BEFORE) - 365 * DAY_MS).toISOString();
  const dates = [366, 365, 364, 200, 91, 90, 89, 0].map(days => new Date(Date.parse(BEFORE) - days * DAY_MS).toISOString());
  dates.forEach((createdAt, i) => f.insertGift(f.source.id, `age-${i}`, { createdAt }));
  f.giftDb.prepare('UPDATE gift_events SET gift_stats_delivered=1 WHERE source_id=?').run(f.source.id);
  publishExisting(f);
  const rows = dates.slice(0,-1).map(date => ({ ...row(1), dayStart: new Date(dayStart(date)).toISOString() }));
  f.retention.summaryPage({ ...f.scope(), full: true, page: summary({ rows, coveredThroughCursor: 8 }) });
  f.retention.historyPage({ ...f.scope(), pageToken: 'history-1', page: history([], { recoveryCursor: 8 }) });
  f.retention.activate(f.scope());
  t.mock.method(Date, 'now', () => Date.parse('2040-01-01T00:00:00.000Z'));
  f.giftDb.exec(`CREATE TRIGGER fail_retention_checkpoint BEFORE UPDATE ON gift_retention_work
    BEGIN SELECT RAISE(ABORT,'checkpoint failed'); END`);
  assert.throws(() => pruneLocalGiftBatch(f.giftDb, f.source.id, 1), /checkpoint failed/);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_retention_receipts').get().n, 0);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_events').get().n, 8);
  f.giftDb.exec('DROP TRIGGER fail_retention_checkpoint');
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id, 1).deleted, 1);
  const late = f.insertGift(f.source.id, 'late-old', { createdAt: dates[0] });
  f.giftDb.prepare('UPDATE gift_events SET remote_final_cursor=9,gift_stats_delivered=1 WHERE id=?').run(late.lastInsertRowid);
  let result;
  do { result = pruneLocalGiftBatch(f.giftDb, f.source.id, 2); assert.ok(result.scanned <= 2); } while (result.hasMore);
  assert.equal(f.giftDb.prepare('SELECT cutoff FROM gift_retention_work').get().cutoff, cutoff);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_events').get().n, 8, 'fixed scan horizon excludes the late arrival');
  f.giftDb.prepare('UPDATE gift_sync_state SET final_cursor=9 WHERE source_id=?').run(f.source.id);
  f.retention.summaryPage({ ...f.scope(), page: summary({ revision: 2, baseRevision: 1,
    summarizedBefore: new Date(Date.parse(BEFORE) + DAY_MS).toISOString(), coveredThroughCursor: 9,
    rows: [{ ...row(2), dayStart: dates[0] }, { ...row(1), dayStart: BEFORE }] }) });
  f.retention.activate(f.scope());
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id).deleted, 2, 'new day revisits both the old boundary and the late final');
  assert.equal(f.statistics().summaryRow.eventCount, 9);
  assert.equal(f.context.queryStore.getRetention(f.source.id, { rangeStart: dates[0], rangeEnd: cutoff }).availability, 'expired');
});

test('year-old blind-box records compact into daily groups with explicit timezone precision', (t) => {
  const originalTimezone = process.env.TZ;
  const resolvedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  t.after(() => {
    process.env.TZ = originalTimezone || resolvedTimezone;
    if (originalTimezone === undefined) delete process.env.TZ;
  });
  const f = fixture(t);
  process.env.TZ = 'Asia/Shanghai';
  f.setActiveSource(f.source.id);
  for (const [index, createdAt] of ['2025-01-01T20:00:00.000Z', '2025-01-02T08:00:00.000Z'].entries()) {
    f.insertGift(f.source.id, `timezone-${index}`, {
      createdAt, isBlindBox: true, blindBoxName: '测试盒', blindBoxPrice: 0.5,
    });
  }
  f.giftDb.prepare('UPDATE gift_events SET gift_stats_delivered=1 WHERE source_id=?').run(f.source.id);
  const readDays = () => ['2025-01-01', '2025-01-02'].map((date) =>
    getBlindBoxAnalysis(f.context, { startDate: date, endDate: date }).summary);
  const before = readDays();
  const archivedDay = { ...row(), dayStart: '2025-01-01T16:00:00.000Z' };
  Object.assign(archivedDay.dimensions, { isBlindBox: true, blindBoxName: '测试盒', blindBoxUnitPriceCents: 50 });
  archivedDay.groupKey = groupKey(archivedDay.dimensions);
  Object.assign(archivedDay.metrics, { blindBoxEventCount: 2, blindBoxPriceCents: 100, blindBoxValueCents: 200,
    blindProfitCents: 100, blindItemCount: 2, knownCostValueCents: 200 });
  publishExisting(f);
  stage(f, summary({ rows: [archivedDay] }));
  f.retention.activate(f.scope());
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id).deleted, 2);
  assert.deepEqual(readDays(), before);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_local_archives').get().n, 1);
  assert.equal(f.giftDb.prepare('SELECT occurred_at FROM gift_local_archives').get().occurred_at, null);
  process.env.TZ = 'America/New_York';
  const shifted = getBlindBoxAnalysis(f.context, { startDate: '2025-01-01', endDate: '2025-01-02' });
  assert.equal(shifted.summary.boxCount, 2);
  assert.equal(shifted.hasArchivedTimezoneMismatch, true);
  assert.deepEqual(shifted.archiveTimeZones, ['Asia/Shanghai']);
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id).deleted, 0);
});

test('the pre-release reset drops incompatible projections once and preserves unrelated state', (t) => {
  const run = schema.runMigrations;
  const legacy = t.mock.method(schema, 'runMigrations', (db, key, steps) =>
    run(db, key, key === 'gift_db' ? steps.slice(0, 20) : steps));
  let f;
  try { f = fixture(t); }
  finally { legacy.mock.restore(); }
  f.setActiveSource(f.source.id);
  const dimensions = JSON.stringify({ uid: '', user_name: '观众', gift_id: 'gift-1', gift_name: '礼物',
    blind_box_id: null, blind_box_name: '测试盒', unit_price: 1, known_cost: true });
  f.giftDb.prepare('INSERT INTO gift_local_archives VALUES (?,?,?,?,?,?,?,?,?)')
    .run(f.source.id, DAY, 'legacy-bucket', dimensions, 2, 2, 200, 100, OLD);
  f.insertGift(f.source.id, 'obsolete');
  f.insertGift(null, 'unidentified', { cmd: 'SEND_GIFT' });
  addWish(f, 'keep-configuration', 'long', OLD);
  runAllMigrations(f.databases);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_local_archives').get().n, 0);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_events WHERE source_id=?').get(f.source.id).n, 0);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_events WHERE source_id IS NULL').get().n, 1);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_wishes').get().n, 1);
  f.insertGift(f.source.id, 'new-baseline');
  runAllMigrations(f.databases);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_events WHERE source_id=?').get(f.source.id).n, 1);
});

test('a reopened database resumes a committed retention checkpoint without repeating sprint carry', (t) => {
  const f = fixture(t);
  for (let i=0; i<10; i++) f.insertGift(f.source.id, `reopen-${i}`, { createdAt: OLD, countedInSprint: 1 });
  f.giftDb.prepare('UPDATE gift_events SET gift_stats_delivered=1').run();
  publishExisting(f);
  f.retention.summaryPage({ ...f.scope(), full: true, page: summary({ rows: [row(10)], coveredThroughCursor: 10 }) });
  f.retention.historyPage({ ...f.scope(), pageToken: 'history-1', page: history([], { recoveryCursor: 10 }) });
  f.retention.activate(f.scope());
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id, 2).deleted, 2);
  const filename = f.giftDb.prepare('PRAGMA database_list').all().find(entry => entry.name === 'main').file;
  f.giftDb.close();
  const db = f.databases.giftDb = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON');
  let result;
  do { result = pruneLocalGiftBatch(db,f.source.id,2); } while (result.hasMore);
  while (cleanupGiftRetentionBatch(db,f.source.id,2)) {}
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gift_events').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM gift_retention_receipts').get().n, 10);
  const carry = db.prepare('SELECT * FROM gift_sprint_carry').get();
  assert.equal(carry.value_cents, 1000);
  assert.equal(carry.event_count, 10);
  assert.equal(db.prepare('SELECT phase FROM gift_retention_work').get().phase, 'done');
  assert.equal(pruneLocalGiftBatch(db,f.source.id).deleted, 0);
});

function addWish(f, id, period, createdAt) {
  f.giftDb.prepare(`INSERT INTO gift_wishes
    (id,source_id,period,gift_id,gift_name,gift_category,target,created_at) VALUES (?,?,?,'gift-1','礼物','directGift',100,?)`)
    .run(id, f.source.id, period, createdAt);
  return createGiftWishStore(f.giftDb).list(f.source.id).find(wish => wish.id === id);
}

test('wishes combine active history and summaries while preserving exact creation-day quantities', (t) => {
  const f = fixture(t);
  const store = createGiftWishStore(f.giftDb);
  const long = addWish(f, 'long', 'long', OLD);
  const all = addWish(f, 'all', 'long', DAY);
  const daily = addWish(f, 'day', 'day', NOW);
  f.insertGift(f.source.id, 'before-wish', { createdAt: '2025-01-01T01:00:00.000Z', giftStatsEligible: 0 });
  f.insertGift(f.source.id, 'after-wish', { createdAt: '2025-01-01T03:00:00.000Z', giftStatsEligible: 0 });
  publishExisting(f);
  const count = (wish, start = wish.created_at) => store.count(f.source.id, wish, start, NOW);
  stage(f);
  assert.equal(count(daily, BEFORE), 0, 'staging stays hidden');
  assert.equal(count(long), 1);
  f.retention.activate(f.scope());
  assert.equal(count(daily, BEFORE), 1);
  assert.equal(count(long), 2, 'creation day excludes the gift before creation');
  assert.equal(count(all), 3, 'complete days use summaries without doubling boundary contributions');
  const prepare = f.giftDb.prepare;
  const reads = { detail: 0, summary: 0, contribution: 0 };
  const observe = t.mock.method(f.giftDb, 'prepare', function (sql) {
    if (sql.includes('SUM(')) {
      if (sql.includes('FROM gift_events g WHERE')) reads.detail++;
      if (sql.includes('FROM gift_retention_days s')) reads.summary++;
      if (sql.includes('FROM gift_wish_boundary_totals c')) reads.contribution++;
    }
    return prepare.call(this, sql);
  });
  const windows = [
    { wish: long, start: OLD, end: NOW },
    { wish: all, start: DAY, end: NOW },
    { wish: daily, start: BEFORE, end: NOW },
    { wish: long, start: OLD, end: '2025-01-01T02:30:00.000Z' },
  ];
  assert.deepEqual(store.countMany(f.source.id, windows), [2, 3, 1, 0]);
  observe.mock.restore();
  assert.deepEqual(reads, { detail: 1, summary: 1, contribution: 1 });
  assert.equal(f.statistics().summaryRow.itemCount, 3);
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id).deleted, 2);
  assert.equal(count(long), 2);
  assert.equal(count(all), 3);
  assert.deepEqual(store.countMany(f.source.id, windows), [2, 3, 1, 0]);
  assert.equal(f.statistics().summaryRow.itemCount, 3);
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id).deleted, 0);
  assert.equal(createGiftWishStore(f.giftDb).count(f.source.id, long, OLD, NOW), 2);
  stage(f);
  f.retention.activate(f.scope());
  assert.equal(count(long), 2, 'same-epoch rebuild preserves each exact contribution once');
  f.retention.summaryPage({ ...f.scope(), full: true, page: summary({ syncEpoch: 'cleared', rows: [] }) });
  f.retention.historyPage({ ...f.scope(), pageToken: 'history-1', page: history([], { syncEpoch: 'cleared' }) });
  f.retention.activate(f.scope());
  assert.equal(count(long), 0, 'new epochs cannot inherit old contributions');
});

test('wishes retain late creation-day finals when pruning and respect a stale session end', (t) => {
  const f = fixture(t);
  const store = createGiftWishStore(f.giftDb);
  const long = addWish(f, 'long', 'long', OLD);
  const session = addWish(f, 'session', 'session', OLD);
  store.saveSession(f.source.id, '123', { started_at: OLD, checked_at: '2025-01-01T02:30:00.000Z', ended_at: null });
  f.insertGift(f.source.id, 'early', { createdAt: '2025-01-01T02:15:00.000Z', giftStatsEligible: 0 });
  f.insertGift(f.source.id, 'later', { createdAt: '2025-01-01T03:00:00.000Z', giftStatsEligible: 0 });
  publishExisting(f);
  stage(f);
  f.retention.activate(f.scope());
  const late = record('late-boundary', 4, '2025-01-01T04:00:00.000Z');
  f.projection.importProcessedHistoryRecord(late, f.source.id);
  f.giftDb.prepare('UPDATE gift_events SET remote_final_cursor=4 WHERE platform_id=?').run('lira-server:late-boundary');
  f.giftDb.prepare('UPDATE gift_sync_state SET final_cursor=4 WHERE source_id=?').run(f.source.id);
  f.retention.summaryPage({ ...f.scope(), page: summary({ revision: 2, baseRevision: 1, coveredThroughCursor: 4, rows: [row(3)] }) });
  f.retention.activate(f.scope());
  assert.equal(store.count(f.source.id, long, OLD, NOW), 4);
  assert.equal(store.count(f.source.id, session, OLD, '2025-01-01T02:30:00.000Z'), 1);
  assert.deepEqual(store.countMany(f.source.id, [
    { wish: long, start: OLD, end: NOW },
    { wish: session, start: OLD, end: '2025-01-01T02:30:00.000Z' },
    { wish: long, start: BEFORE, end: NOW },
  ]), [4, 1, 1]);
  // The unfinished session's trailing day must remain exact until its boundary moves.
  assert.equal(pruneLocalGiftBatch(f.giftDb, f.source.id).deleted, 0);
  store.saveSession(f.source.id, '123', { started_at: OLD, checked_at: NOW, ended_at: null });
  f.giftDb.prepare('DELETE FROM gift_retention_work WHERE source_id=?').run(f.source.id);
  f.giftDb.exec(`CREATE TRIGGER reject_wish_archive BEFORE INSERT ON gift_wish_boundary_totals
    BEGIN SELECT RAISE(ABORT,'wish archive failed'); END;`);
  assert.throws(() => pruneLocalGiftBatch(f.giftDb, f.source.id), /wish archive failed/);
  assert.equal(store.count(f.source.id, long, OLD, NOW), 4, 'archive failure cannot delete the raw contribution');
  f.giftDb.exec('DROP TRIGGER reject_wish_archive');
  pruneLocalGiftBatch(f.giftDb, f.source.id);
  assert.equal(store.count(f.source.id, long, OLD, NOW), 4);
  assert.equal(store.count(f.source.id, session, OLD, NOW), 4);
  assert.equal(store.count(f.source.id, long, BEFORE, NOW), 1, 'todayCount ignores archived start-day contributions');
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_wish_boundary_totals WHERE wish_id=?').get(long.id).n, 1);
  store.remove(f.source.id, long.id);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_wish_boundary_totals WHERE wish_id=?').get(long.id).n, 0);
  f.giftDb.exec('BEGIN IMMEDIATE');
  clearGiftScopeInTransaction(f.giftDb, f.source.id, NOW);
  f.giftDb.exec('COMMIT');
  assert.equal(store.count(f.source.id, session, OLD, NOW), 0);
  assert.equal(f.giftDb.prepare('SELECT COUNT(*) n FROM gift_wish_boundary_totals').get().n, 0);
});

test('summary wish quantities preserve guard aliases and separate box and output identities', (t) => {
  const f = fixture(t);
  const guard = row();
  Object.assign(guard.dimensions, { giftId: '10003' });
  Object.assign(guard.metrics, { guardEventCount: 2, guardValueCents: 200 });
  guard.groupKey = groupKey(guard.dimensions);
  const box = row();
  Object.assign(box.dimensions, { giftId: 'output', giftVariantId: 'output-v1', isBlindBox: true,
    blindBoxId: 'box', blindBoxVariantId: 'box-v1', blindBoxName: '盲盒' });
  Object.assign(box.metrics, { blindBoxEventCount: 2, blindBoxValueCents: 200, blindItemCount: 2,
    blindBoxUnknownCostEventCount: 2, unknownCostItemCount: 2, unknownCostValueCents: 200 });
  box.groupKey = groupKey(box.dimensions);
  const rows = [guard, box].sort((a, b) => a.groupKey.localeCompare(b.groupKey));
  stage(f, summary({ rows }), []);
  f.retention.activate(f.scope());
  const store = createGiftWishStore(f.giftDb);
  const wishes = [
    { gift_id: 'guard-3', gift_category: 'guard' },
    { gift_id: 'box', gift_category: 'blindBox', variant_id: 'box-v1' },
    { gift_id: 'output', gift_category: 'blindBoxOutput', variant_id: 'output-v1' },
    { gift_id: 'output', gift_category: 'blindBoxOutput', variant_id: 'output-v2' },
  ];
  assert.deepEqual(store.countMany(f.source.id, wishes.map(wish => ({ wish, start: DAY, end: NOW }))), [2, 2, 2, 0]);
});

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
  publishExisting(f);
  stage(f);
  f.retention.activate(f.scope());
  assert.equal(pruneLocalGiftBatch(f.giftDb,f.source.id,1).deleted, 1);
  assert.equal(pruneLocalGiftBatch(f.giftDb,f.source.id,1).deleted, 0);
  assert.deepEqual(f.context.queryStore.readSprint(sourceScope), before);
  const archived = f.context.queryStore.listBlindBoxRows({ sourceScope, from: DAY, to: '2025-01-02T16:00:00.000Z' });
  assert.equal(archived.length,1);
  assert.equal(archived[0].archived,true);
  assert.equal(archived[0].blind_profit,0.5);
  f.setActiveSource(f.source.id);
  const analysis = require('../../src/bilibili/gift/blind-box-analysis').getBlindBoxAnalysis(f.context,
    { startDate: '2025-01-01', endDate: '2025-01-01', view: 'records' });
  assert.equal(analysis.summary.totalProfit,0.5);
  assert.equal(analysis.hasArchivedDetails,true);
  assert.deepEqual(analysis.items,[]);
  assert.equal(f.giftDb.prepare('SELECT 1 FROM gift_events WHERE id=?').get(first.lastInsertRowid),undefined);
  assert.equal(f.projection.importProcessedEvent({ ...record('old-1',1,OLD), phase: 'final', cursor: 1 },f.source.id),null);
  f.giftDb.prepare("UPDATE overtime_settlements SET status='applied' WHERE gift_event_id=?").run(second.lastInsertRowid);
  f.giftDb.prepare('DELETE FROM gift_retention_work WHERE source_id=?').run(f.source.id);
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
    assert.ok(changes()-before<=3,'one candidate plus its proof move or bounded scan checkpoints');
    if (!n) break;
  }
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM gift_retention_snapshots').get().n,1);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM gift_retention_members').get().n,2,
    'the previously published progress group keeps its proof after a same-epoch rebuild');
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
