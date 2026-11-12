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
  if (box && !wish.variant_id && wish.legacy_box_name) {
    return { sql: `(${identity}=? OR (COALESCE(${identity},'')='' AND ${column('blind_box_name', 'blindBoxName')}=?)) AND ${blind}=1`,
      params: [wish.gift_id, wish.legacy_box_name] };
  }
  return { sql: `${identity}=?${box || wish.gift_category === 'blindBoxOutput' ? ` AND ${blind}=1` : ''}`,
    params: [wish.variant_id || wish.gift_id] };
}

// Only partial-day windows need exact events once the shared ledger is replaced or pruned.
// The caller owns the same transaction that removes their visibility.
function archiveWishContributions(db, sourceId, { syncEpoch, eventIds }) {
  if (!eventIds?.length) return;
  const session = db.prepare('SELECT * FROM gift_wish_sessions WHERE source_id=?').get(sourceId);
  for (const wish of db.prepare("SELECT * FROM gift_wishes WHERE source_id=? AND period IN ('long','session')").all(sourceId)) {
    const start = wish.period === 'long' ? wish.created_at : !session?.ended_at && session?.started_at;
    if (!start || Date.parse(start) === dayStart(start)) continue;
    const end = new Date(dayStart(start) + DAY_MS).toISOString();
    if (wish.period === 'session' && session.checked_at < end) continue;
    const match = wishMatch(wish);
    db.prepare(`INSERT INTO gift_wish_boundary_totals
      (wish_id,source_id,sync_epoch,boundary_start,boundary_end,num)
      SELECT ?,?,?,?,?,SUM(g.num) FROM gift_events g WHERE g.source_id=? AND g.created_at>=? AND g.created_at<?
        AND (${match.sql}) AND g.id IN (${eventIds.map(() => '?').join(',')}) HAVING COUNT(*)>0
      ON CONFLICT(wish_id,source_id,sync_epoch,boundary_start,boundary_end) DO UPDATE SET num=num+excluded.num`)
      .run(wish.id,sourceId,syncEpoch,start,end,sourceId,start,end,...match.params,...eventIds);
    const total = db.prepare(`SELECT num FROM gift_wish_boundary_totals
      WHERE wish_id=? AND source_id=? AND sync_epoch=? AND boundary_start=? AND boundary_end=?`)
      .get(wish.id,sourceId,syncEpoch,start,end);
    if (total && !Number.isSafeInteger(total.num)) throw new Error('INVALID_GIFT_METRICS');
  }
}

function readMutableWishBoundary(db, sourceId) {
  const session = db.prepare(`SELECT s.* FROM gift_wish_sessions s WHERE source_id=? AND ended_at IS NULL
    AND EXISTS (SELECT 1 FROM gift_wishes w WHERE w.source_id=s.source_id AND w.period='session')`).get(sourceId);
  return session ? { start: new Date(dayStart(session.checked_at)).toISOString(),
    end: new Date(dayStart(session.checked_at) + DAY_MS).toISOString() } : null;
}

function readWishContributionCounts(db, sourceId, requests, snapshot) {
  const entries = requests.filter(({ wish }) => wish.id);
  if (!snapshot || !entries.length) return new Map();
  const sums = entries.map(({ index }) => `COALESCE(SUM(CASE WHEN wish_id=? AND boundary_start>=?
    AND boundary_end<=? THEN num ELSE 0 END),0) AS c${index}`);
  const ids = [...new Set(entries.map(({ wish }) => wish.id))];
  const counts = db.prepare(`SELECT ${sums.join(',')} FROM gift_wish_boundary_totals c
    WHERE source_id=? AND sync_epoch=? AND wish_id IN (${ids.map(() => '?').join(',')})`)
    .get(...entries.flatMap(({ wish, start, end }) => [wish.id,start,end]),sourceId,snapshot.sync_epoch,...ids);
  return new Map(entries.map(({ index }) => [index, counts[`c${index}`]]));
}

module.exports = { wishMatch, archiveWishContributions, readWishContributionCounts, readMutableWishBoundary };
