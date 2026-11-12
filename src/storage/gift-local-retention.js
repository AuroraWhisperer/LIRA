'use strict';

const { createHash } = require('node:crypto');
const { activeSnapshot, transaction } = require('./gift-retention-store');
const { archiveWishContributions, readMutableWishBoundary } = require('./gift-wish-retention');
const { localDetailStart } = require('./gift-detail-coverage');

function calendarDay(value, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function archiveQualifiedGift(db, row, timeZone, formatter) {
  if (row.gift_stats_eligible !== 1) return;
  const cents = Math.round(row.total_price * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('INVALID_GIFT_METRICS');
  if (row.counted_in_sprint === 1) {
    db.prepare(`INSERT INTO gift_sprint_carry VALUES (?,?,1) ON CONFLICT(source_id)
      DO UPDATE SET value_cents=value_cents+excluded.value_cents,event_count=event_count+1`).run(row.source_id, cents);
    const carry = db.prepare('SELECT * FROM gift_sprint_carry WHERE source_id=?').get(row.source_id);
    if (!Number.isSafeInteger(carry.value_cents) || !Number.isSafeInteger(carry.event_count)) throw new Error('INVALID_GIFT_METRICS');
  }
  if (row.is_blind_box !== 1) return;
  const dimensions = { uid: row.uid, user_name: row.user_name, gift_id: row.gift_id, gift_name: row.gift_name,
    blind_box_id: row.blind_box_id, blind_box_name: row.blind_box_name,
    gift_variant_id: row.gift_variant_id, blind_box_variant_id: row.blind_box_variant_id,
    unit_price: row.unit_price, known_cost: row.blind_box_price !== null };
  const json = JSON.stringify(dimensions);
  const key = createHash('sha256').update(JSON.stringify([dimensions, timeZone])).digest('hex');
  const day = formatter.format(new Date(row.created_at));
  const cost = row.blind_box_price === null ? null : Math.round(row.blind_box_price * 100);
  if ((cost !== null && (!Number.isSafeInteger(cost) || cost < 0)) || !Number.isSafeInteger(row.num) || row.num < 1) throw new Error('INVALID_GIFT_METRICS');
  db.prepare(`INSERT INTO gift_local_archives
    (source_id,day_start,group_key,dimensions_json,event_count,item_count,value_cents,cost_cents,last_opened_at,archive_timezone)
    VALUES (?,?,?,?,1,?,?,?,?,?)
    ON CONFLICT(source_id,day_start,group_key) DO UPDATE SET event_count=event_count+1,
      item_count=item_count+excluded.item_count,value_cents=value_cents+excluded.value_cents,
      cost_cents=cost_cents+excluded.cost_cents,last_opened_at=MAX(last_opened_at,excluded.last_opened_at)`)
    .run(row.source_id, day, key, json, row.num, cents, cost, row.created_at, timeZone);
  const saved = db.prepare('SELECT * FROM gift_local_archives WHERE source_id=? AND day_start=? AND group_key=?').get(row.source_id,day,key);
  if (!['event_count','item_count','value_cents'].every((field) => Number.isSafeInteger(saved[field])) ||
    (saved.cost_cents !== null && !Number.isSafeInteger(saved.cost_cents))) throw new Error('INVALID_GIFT_METRICS');
}

function pruneLocalGiftBatch(db, sourceId, limit = 25) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Invalid gift retention batch');
  return transaction(db, () => {
    const snapshot = activeSnapshot(db, sourceId);
    const cutoff = localDetailStart(snapshot);
    const sync = db.prepare('SELECT * FROM gift_sync_state WHERE source_id=?').get(sourceId);
    const staging = db.prepare('SELECT staging_snapshot_id FROM gift_retention_state WHERE source_id=?').get(sourceId);
    if (!cutoff || sync?.sync_epoch !== snapshot.sync_epoch || staging?.staging_snapshot_id != null) {
      return { deleted: 0, phase: 'waiting', hasMore: false };
    }
    let work = db.prepare('SELECT * FROM gift_retention_work WHERE source_id=?').get(sourceId);
    if (!work || work.sync_epoch !== snapshot.sync_epoch || work.cutoff !== cutoff) {
      const upper = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM gift_events WHERE source_id=?').get(sourceId).id;
      db.prepare(`INSERT INTO gift_retention_work
        (source_id,sync_epoch,generation,revision,cutoff,upper_id,archive_timezone) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(source_id) DO UPDATE SET sync_epoch=excluded.sync_epoch,generation=excluded.generation,
          revision=excluded.revision,cutoff=excluded.cutoff,upper_id=excluded.upper_id,after_id=0,
          phase='events',skipped=0,archive_timezone=excluded.archive_timezone`)
        .run(sourceId,snapshot.sync_epoch,sync.projection_generation,snapshot.revision,cutoff,upper,
          Intl.DateTimeFormat().resolvedOptions().timeZone);
      work = db.prepare('SELECT * FROM gift_retention_work WHERE source_id=?').get(sourceId);
      db.prepare(`UPDATE gift_retention_state SET cleanup_event_id=0,cleanup_day_rowid=0,
        cleanup_event_upper_id=NULL,cleanup_day_upper_rowid=NULL WHERE source_id=?`).run(sourceId);
    }
    if (work.phase !== 'events') return { deleted: 0, phase: work.phase, hasMore: false, skipped: work.skipped };
    // A new verified revision in the same epoch can strengthen coverage without
    // widening this cycle's fixed cutoff or scan horizon.
    if (snapshot.revision < work.revision) return { deleted: 0, phase: 'waiting', hasMore: false };
    const candidates = db.prepare(`SELECT * FROM gift_events INDEXED BY idx_gift_retention_scan
      WHERE source_id=? AND id>? AND id<=? ORDER BY id LIMIT ?`).all(sourceId,work.after_id,work.upper_id,limit);
    const pendingSettlement = db.prepare("SELECT 1 FROM overtime_settlements WHERE gift_event_id=? AND status='pending'");
    const publishedMember = db.prepare(`SELECT 1 FROM gift_retention_members m JOIN gift_retention_snapshots s ON s.id=m.snapshot_id
      WHERE m.event_id=? AND s.source_id=? AND s.sync_epoch=? AND s.phase='active' LIMIT 1`);
    const wishBoundary = readMutableWishBoundary(db, sourceId);
    let skipped = 0;
    const rows = candidates.filter(row => {
      if (row.cmd !== 'LIRA_SERVER_GIFT' || row.created_at >= cutoff) return false;
      const protectedRow = row.detection_status !== 'final' || !['active', 'retention-staged'].includes(row.status) ||
        !(row.total_price > 0) || !Number.isSafeInteger(row.num) || row.num < 1 || !Number.isFinite(Date.parse(row.created_at)) ||
        !Number.isSafeInteger(row.remote_final_cursor) || row.remote_final_cursor > snapshot.covered_cursor ||
        (row.gift_stats_eligible === 1 && row.gift_stats_delivered === 0) ||
        pendingSettlement.get(row.id) || !publishedMember.get(row.id, sourceId, snapshot.sync_epoch) ||
        (wishBoundary && row.created_at >= wishBoundary.start && row.created_at < wishBoundary.end);
      if (protectedRow) skipped++;
      return !protectedRow;
    });
    archiveWishContributions(db, sourceId, { syncEpoch: snapshot.sync_epoch, eventIds: rows.map(row => row.id) });
    const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: work.archive_timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const receipt = db.prepare('INSERT OR IGNORE INTO gift_retention_receipts VALUES (?,?)');
    const removeSettlement = db.prepare('DELETE FROM overtime_settlements WHERE gift_event_id=?');
    const removeEvent = db.prepare('DELETE FROM gift_events WHERE id=?');
    for (const row of rows) {
      archiveQualifiedGift(db, row, work.archive_timezone, formatter);
      receipt.run(sourceId,row.platform_id);
      removeSettlement.run(row.id);
      removeEvent.run(row.id);
    }
    const afterId = candidates.at(-1)?.id || work.upper_id;
    const hasMore = candidates.length === limit && afterId < work.upper_id;
    db.prepare(`UPDATE gift_retention_work SET after_id=?,phase=?,skipped=skipped+?,generation=?,revision=? WHERE source_id=?`)
      .run(afterId,hasMore ? 'events' : 'cleanup',skipped,sync.projection_generation,snapshot.revision,sourceId);
    return { deleted: rows.length, scanned: candidates.length, skipped, phase: hasMore ? 'events' : 'cleanup', hasMore };
  });
}

function readLocalBlindArchives(db, { sourceScope, from, to, boxName, includeUnknownProfit }) {
  if (sourceScope?.kind !== 'source') return [];
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return db.prepare('SELECT * FROM gift_local_archives WHERE source_id=? AND day_start>=? AND day_start<?')
    .all(sourceScope.sourceId,calendarDay(from,timeZone),calendarDay(to,timeZone)).flatMap((row) => {
      const dimensions = JSON.parse(row.dimensions_json);
      if ((!includeUnknownProfit && row.cost_cents === null) || (boxName && dimensions.blind_box_name !== boxName)) return [];
      return [{ ...dimensions, archived: true, archivedDate: row.day_start, archiveTimeZone: row.archive_timezone,
        archivedTimezoneMismatch: row.archive_timezone !== timeZone,
        id: null, num: row.item_count, total_price: row.value_cents / 100,
        blind_box_price: row.cost_cents === null ? null : row.cost_cents / 100,
        blind_profit: row.cost_cents === null ? null : (row.value_cents - row.cost_cents) / 100,
        created_at: row.last_opened_at }];
    });
}

module.exports = { pruneLocalGiftBatch, readLocalBlindArchives };
