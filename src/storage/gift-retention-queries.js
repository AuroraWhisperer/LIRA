'use strict';

const { DAY_MS, dayStart, METRIC_KEYS } = require('../shared/gift-summary-contract');
const { activeSnapshot } = require('./gift-retention-store');
const { localDetailStart } = require('./gift-detail-coverage');

function retentionLedgerFilter(db, options, filter, { statistics = false, snapshot = activeSnapshot(db, options.sourceId) } = {}) {
  if (!snapshot) return filter;
  filter.sql = filter.sql.replace("g.status = 'active'", "g.status IN ('active','retention-staged')");
  filter.sql += ` AND EXISTS (SELECT 1 FROM gift_retention_members m JOIN gift_retention_snapshots s ON s.id=m.snapshot_id
    WHERE m.event_id=g.id AND s.source_id=g.source_id AND s.sync_epoch=? AND s.phase='active')`;
  filter.params.push(snapshot.sync_epoch);
  const cutoff = localDetailStart(snapshot);
  if (!statistics && cutoff) {
    filter.sql += ' AND g.created_at>=?';
    filter.params.push(cutoff);
  }
  return filter;
}

function summaryWindow(snapshot, { rangeStart, asOf }) {
  if (!snapshot?.summarized_before) return null;
  const start = rangeStart ? dayStart(rangeStart) + (Date.parse(rangeStart) === dayStart(rangeStart) ? 0 : DAY_MS) : null;
  const end = Math.min(Date.parse(snapshot.summarized_before), dayStart(asOf));
  if (start !== null && start >= end) return null;
  return { start: start === null ? null : new Date(start).toISOString(), end: new Date(end).toISOString() };
}

function excludeSummarizedDetails(filter, snapshot, window) {
  if (window) {
    filter.sql += ` AND NOT (g.remote_final_cursor IS NOT NULL AND g.remote_final_cursor<=?
      AND g.created_at<?${window.start ? ' AND g.created_at>=?' : ''})`;
    filter.params.push(snapshot.covered_cursor, window.end);
    if (window.start) filter.params.push(window.start);
  }
}

function statisticsFilter(db, options, filter, snapshot = activeSnapshot(db, options.sourceId)) {
  const window = summaryWindow(snapshot, options);
  retentionLedgerFilter(db, options, filter, { statistics: true, snapshot });
  excludeSummarizedDetails(filter, snapshot, window);
  return { snapshot, window };
}

function mergeSummaryStatistics(db, options, plan, raw) {
  const { snapshot, window } = plan;
  if (!window) return raw;
  const params = [options.sourceId, snapshot.sync_epoch, snapshot.revision, window.end];
  if (window.start) params.push(window.start);
  if (options.query) params.push(options.query, options.query);
  const bucketFormat = options.range === 'all' ? '%Y-%m' : '%Y-%m-%d';
  const sums = METRIC_KEYS.map((key) => `SUM(json_extract(s.metrics_json,'$.${key}')) AS ${key}`).join(',');
  // A revision replaces the entire day. Select it before filtering individual gifts.
  const groups = db.prepare(`WITH latest_days AS (
      SELECT source_id, sync_epoch, day_start, MAX(revision) AS revision FROM gift_retention_days
      WHERE source_id=? AND sync_epoch=? AND revision<=? AND day_start<? ${window.start ? 'AND day_start>=?' : ''}
      GROUP BY day_start
    ) SELECT strftime('${bucketFormat}',s.day_start,'+8 hours') AS bucketKey,
      json_extract(s.dimensions_json,'$.giftId') AS giftId, json_extract(s.dimensions_json,'$.giftName') AS giftName,
      ${sums} FROM latest_days JOIN gift_retention_days s USING (source_id,sync_epoch,day_start,revision)
      ${options.query ? `WHERE instr(json_extract(s.dimensions_json,'$.giftName'),?)>0 OR
        instr(json_extract(s.dimensions_json,'$.blindBoxName'),?)>0` : ''}
      GROUP BY bucketKey,giftId,giftName`).iterate(...params);
  function merge(target, row) {
    for (const key of METRIC_KEYS) {
      const next = (target[key] || 0) + (row[key] || 0);
      if (!Number.isSafeInteger(next)) throw new Error('INVALID_GIFT_METRICS');
      target[key] = next;
    }
    return target;
  }
  const totals = {};
  const top = new Map(raw.topRows.map((row) => [JSON.stringify([row.giftId,row.giftName]), row]));
  const buckets = new Map(raw.bucketRows.map((row) => [row.bucketStart,row]));
  for (const row of groups) {
    merge(totals, row);
    const key = JSON.stringify([row.giftId,row.giftName]);
    top.set(key, merge(top.get(key) || { giftId: row.giftId, giftName: row.giftName }, row));
    const date = row.bucketKey.length === 7 ? `${row.bucketKey}-01` : row.bucketKey;
    const bucketStart = new Date(`${date}T00:00:00+08:00`).toISOString();
    buckets.set(bucketStart, merge(buckets.get(bucketStart) || { bucketStart }, row));
  }
  merge(raw.summaryRow, totals);
  return { summaryRow: raw.summaryRow, topRows: [...top.values()], bucketRows: [...buckets.values()].sort((a,b) => a.bucketStart.localeCompare(b.bucketStart)) };
}

module.exports = { retentionLedgerFilter, statisticsFilter, summaryWindow, excludeSummarizedDetails, mergeSummaryStatistics, activeSnapshot };
