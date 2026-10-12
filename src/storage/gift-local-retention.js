'use strict';

const { createHash } = require('node:crypto');
const { dayStart } = require('../shared/gift-summary-contract');
const { activeSnapshot, transaction } = require('./gift-retention-store');

function archiveQualifiedGift(db, row) {
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
  const key = createHash('sha256').update(json).digest('hex');
  const day = new Date(dayStart(row.created_at)).toISOString();
  const cost = row.blind_box_price === null ? null : Math.round(row.blind_box_price * 100);
  if ((cost !== null && (!Number.isSafeInteger(cost) || cost < 0)) || !Number.isSafeInteger(row.num) || row.num < 1) throw new Error('INVALID_GIFT_METRICS');
  db.prepare(`INSERT INTO gift_local_archives VALUES (?,?,?,?,1,?,?,?,?)
    ON CONFLICT(source_id,day_start,group_key) DO UPDATE SET event_count=event_count+1,
      item_count=item_count+excluded.item_count,value_cents=value_cents+excluded.value_cents,
      cost_cents=cost_cents+excluded.cost_cents,last_opened_at=MAX(last_opened_at,excluded.last_opened_at)`)
    .run(row.source_id, day, key, json, row.num, cents, cost, row.created_at);
  const saved = db.prepare('SELECT * FROM gift_local_archives WHERE source_id=? AND day_start=? AND group_key=?').get(row.source_id,day,key);
  if (!['event_count','item_count','value_cents'].every((field) => Number.isSafeInteger(saved[field])) ||
    (saved.cost_cents !== null && !Number.isSafeInteger(saved.cost_cents))) throw new Error('INVALID_GIFT_METRICS');
}

function pruneLocalGiftBatch(db, sourceId, limit = 500) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Invalid gift retention batch');
  return transaction(db, () => {
    const snapshot = activeSnapshot(db, sourceId);
    if (!snapshot?.detail_start || !snapshot.summarized_before) return { deleted: 0 };
    const rows = db.prepare(`SELECT g.* FROM gift_events g WHERE g.source_id=? AND g.cmd='LIRA_SERVER_GIFT'
      AND g.detection_status='final' AND g.created_at<? AND g.created_at<?
      AND (g.remote_final_cursor IS NULL OR g.remote_final_cursor<=?)
      AND NOT EXISTS (SELECT 1 FROM overtime_settlements o WHERE o.gift_event_id=g.id AND o.status='pending')
      AND NOT (g.gift_stats_eligible=1 AND g.gift_stats_delivered=0)
      ORDER BY g.id LIMIT ?`).all(sourceId,snapshot.detail_start,snapshot.summarized_before,snapshot.covered_cursor,limit);
    for (const row of rows) {
      archiveQualifiedGift(db, row);
      db.prepare('INSERT OR IGNORE INTO gift_retention_receipts VALUES (?,?)').run(sourceId,row.platform_id);
      db.prepare('DELETE FROM overtime_settlements WHERE gift_event_id=?').run(row.id);
      db.prepare('DELETE FROM gift_events WHERE id=?').run(row.id);
    }
    return { deleted: rows.length };
  });
}

function readLocalBlindArchives(db, { sourceScope, from, to, boxName, includeUnknownProfit }) {
  if (sourceScope?.kind !== 'source') return [];
  return db.prepare('SELECT * FROM gift_local_archives WHERE source_id=? AND day_start>=? AND day_start<?')
    .all(sourceScope.sourceId,from,to).flatMap((row) => {
      const dimensions = JSON.parse(row.dimensions_json);
      if ((!includeUnknownProfit && row.cost_cents === null) || (boxName && dimensions.blind_box_name !== boxName)) return [];
      return [{ ...dimensions, archived: true, id: null, num: row.item_count, total_price: row.value_cents / 100,
        blind_box_price: row.cost_cents === null ? null : row.cost_cents / 100,
        blind_profit: row.cost_cents === null ? null : (row.value_cents - row.cost_cents) / 100,
        created_at: row.last_opened_at }];
    });
}

module.exports = { pruneLocalGiftBatch, readLocalBlindArchives };
