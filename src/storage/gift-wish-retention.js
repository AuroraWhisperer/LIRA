'use strict';

const { GUARD_GIFT_ALIASES } = require('../bilibili/gift/guard-gift-aliases');
const { DAY_MS, dayStart } = require('../shared/gift-summary-contract');

function wishMatch(wish, summary = false) {
  const column = (raw, dimension) => summary ? `json_extract(s.dimensions_json,'$.${dimension}')` : `g.${raw}`;
  const blind = column('is_blind_box', 'isBlindBox');
  if (GUARD_GIFT_ALIASES[wish.gift_id]) {
    const ids = [wish.gift_id, ...GUARD_GIFT_ALIASES[wish.gift_id]];
    return { sql: `${column('gift_id', 'giftId')} IN (${ids.map(() => '?').join(',')}) AND ${blind}=0`, params: ids };
  }
  const box = wish.gift_category === 'blindBox';
  const identity = wish.variant_id
    ? column(box ? 'blind_box_variant_id' : 'gift_variant_id', box ? 'blindBoxVariantId' : 'giftVariantId')
    : column(box ? 'blind_box_id' : 'gift_id', box ? 'blindBoxId' : 'giftId');
  return { sql: `${identity}=?${box || wish.gift_category === 'blindBoxOutput' ? ` AND ${blind}=1` : ''}`,
    params: [wish.variant_id || wish.gift_id] };
}

// Only partial-day windows need exact events once the shared ledger is replaced or pruned.
// The caller owns the same transaction that removes their visibility.
function archiveWishContributions(db, sourceId, { syncEpoch, memberSnapshotId, excludedMemberSnapshotId, eventIds }) {
  const session = db.prepare('SELECT * FROM gift_wish_sessions WHERE source_id=?').get(sourceId);
  for (const wish of db.prepare("SELECT * FROM gift_wishes WHERE source_id=? AND period IN ('long','session')").all(sourceId)) {
    const start = wish.period === 'long' ? wish.created_at : !session?.ended_at && session?.started_at;
    if (!start) continue;
    const windows = [];
    const bounds = [];
    if (Date.parse(start) !== dayStart(start)) {
      windows.push('(g.created_at>=? AND g.created_at<?)');
      bounds.push(start, new Date(dayStart(start) + DAY_MS).toISOString());
    }
    if (wish.period === 'session' && session.checked_at) {
      windows.push('(g.created_at>=? AND g.created_at<=?)');
      bounds.push(new Date(dayStart(session.checked_at)).toISOString(), session.checked_at);
    }
    if (!windows.length) continue;
    const match = wishMatch(wish);
    const params = [wish.id, sourceId, syncEpoch, sourceId, ...bounds, ...match.params];
    let sql = `g.source_id=? AND (${windows.join(' OR ')}) AND ${match.sql}
      AND g.detection_status='final' AND g.num>0 AND g.num=CAST(g.num AS INTEGER)`;
    if (memberSnapshotId == null) sql += " AND g.status='active'";
    else {
      sql += " AND g.status IN ('active','retention-staged') AND EXISTS (SELECT 1 FROM gift_retention_members m WHERE m.snapshot_id=? AND m.event_id=g.id)";
      params.push(memberSnapshotId);
    }
    if (excludedMemberSnapshotId != null) {
      sql += ' AND NOT EXISTS (SELECT 1 FROM gift_retention_members m WHERE m.snapshot_id=? AND m.event_id=g.id)';
      params.push(excludedMemberSnapshotId);
    }
    if (eventIds) {
      if (!eventIds.length) continue;
      sql += ` AND g.id IN (${eventIds.map(() => '?').join(',')})`;
      params.push(...eventIds);
    }
    db.prepare(`INSERT OR IGNORE INTO gift_wish_contributions
      (wish_id,source_id,sync_epoch,platform_id,created_at,num)
      SELECT ?,?,?,g.platform_id,g.created_at,g.num FROM gift_events g WHERE ${sql}`).run(...params);
  }
}

function readWishContributions(db, sourceId, wishId, start, end, { snapshot, window }) {
  if (!snapshot || !wishId) return 0;
  const params = [sourceId, wishId, snapshot.sync_epoch, start, end, snapshot.member_snapshot_id];
  let sql = `c.source_id=? AND c.wish_id=? AND c.sync_epoch=? AND c.created_at>=? AND c.created_at<=?
    AND NOT EXISTS (SELECT 1 FROM gift_events g JOIN gift_retention_members m ON m.event_id=g.id
      WHERE g.source_id=c.source_id AND g.platform_id=c.platform_id AND m.snapshot_id=?)`;
  if (window) {
    sql += ' AND NOT (c.created_at>=? AND c.created_at<?)';
    params.push(window.start, window.end);
  }
  return Number(db.prepare(`SELECT COALESCE(SUM(num),0) AS count FROM gift_wish_contributions c WHERE ${sql}`).get(...params).count);
}

module.exports = { wishMatch, archiveWishContributions, readWishContributions };
