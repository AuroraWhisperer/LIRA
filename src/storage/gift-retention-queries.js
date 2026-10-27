'use strict';

const { DAY_MS, dayStart, METRIC_KEYS } = require('../shared/gift-summary-contract');
const { activeSnapshot } = require('./gift-retention-store');

function retentionLedgerFilter(db, options, filter, { statistics = false, snapshot = activeSnapshot(db, options.sourceId) } = {}) {
  if (!snapshot) return filter;
  filter.sql = filter.sql.replace("g.status = 'active'", "g.status IN ('active','retention-staged')");
  filter.sql += ' AND EXISTS (SELECT 1 FROM gift_retention_members m WHERE m.snapshot_id=? AND m.event_id=g.id)';
  filter.params.push(snapshot.member_snapshot_id);
  if (!statistics && snapshot.detail_start) {
    filter.sql += ' AND g.created_at>=?';
    filter.params.push(snapshot.detail_start);
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

function statisticsFilter(db, options, filter, snapshot = activeSnapshot(db, options.sourceId)) {
  const window = summaryWindow(snapshot, options);
  retentionLedgerFilter(db, options, filter, { statistics: true, snapshot });
  if (window) {
    filter.sql += ` AND NOT (g.remote_final_cursor IS NOT NULL AND g.remote_final_cursor<=?
      AND g.created_at<?${window.start ? ' AND g.created_at>=?' : ''})`;
    filter.params.push(snapshot.covered_cursor, window.end);
    if (window.start) filter.params.push(window.start);
  }
  return { snapshot, window };
}

function mergeSummaryStatistics(db, options, plan, raw) {
  const { snapshot, window } = plan;
  if (!window) return raw;
  const params = [options.sourceId, snapshot.sync_epoch, snapshot.revision, window.end];
  let condition = `s.source_id=? AND s.sync_epoch=? AND s.revision<=? AND s.day_start<?`;
  if (window.start) { condition += ' AND s.day_start>=?'; params.push(window.start); }
  if (options.query) {
    condition += ` AND (instr(json_extract(s.dimensions_json,'$.giftName'),?)>0 OR
      instr(json_extract(s.dimensions_json,'$.blindBoxName'),?)>0)`;
    params.push(options.query, options.query);
  }
  condition += ` AND s.revision=(SELECT MAX(d.revision) FROM gift_retention_days d
    WHERE d.source_id=s.source_id AND d.sync_epoch=s.sync_epoch AND d.day_start=s.day_start AND d.revision<=?)`;
  params.push(snapshot.revision);
  const sums = METRIC_KEYS.map((key) => `COALESCE(SUM(json_extract(s.metrics_json,'$.${key}')),0) AS ${key}`).join(',');
  function merge(target, row) {
    for (const key of METRIC_KEYS) {
      const next = (target[key] || 0) + (row[key] || 0);
      if (!Number.isSafeInteger(next)) throw new Error('INVALID_GIFT_METRICS');
      target[key] = next;
    }
    return target;
  }
  merge(raw.summaryRow, db.prepare(`SELECT ${sums} FROM gift_retention_days s WHERE ${condition}`).get(...params));
  const top = new Map(raw.topRows.map((row) => [JSON.stringify([row.giftId,row.giftName]), row]));
  const topRows = db.prepare(`SELECT json_extract(s.dimensions_json,'$.giftId') AS giftId,
    json_extract(s.dimensions_json,'$.giftName') AS giftName,${sums} FROM gift_retention_days s
    WHERE ${condition} GROUP BY giftId,giftName`).all(...params);
  for (const row of topRows) {
    const key = JSON.stringify([row.giftId,row.giftName]);
    top.set(key, merge(top.get(key) || { giftId: row.giftId, giftName: row.giftName }, row));
  }
  const bucket = options.range === 'all' ? "strftime('%Y-%m',s.day_start,'+8 hours')" : "strftime('%Y-%m-%d',s.day_start,'+8 hours')";
  const buckets = new Map(raw.bucketRows.map((row) => [row.bucketStart,row]));
  for (const { bucketKey, ...row } of db.prepare(`SELECT ${bucket} AS bucketKey,${sums}
    FROM gift_retention_days s WHERE ${condition} GROUP BY bucketKey`).all(...params)) {
    const bucketStart = new Date(`${bucketKey.length === 7 ? `${bucketKey}-01` : bucketKey}T00:00:00+08:00`).toISOString();
    buckets.set(bucketStart, merge(buckets.get(bucketStart) || { bucketStart }, row));
  }
  return { summaryRow: raw.summaryRow, topRows: [...top.values()], bucketRows: [...buckets.values()].sort((a,b) => a.bucketStart.localeCompare(b.bucketStart)) };
}

module.exports = { retentionLedgerFilter, statisticsFilter, mergeSummaryStatistics, activeSnapshot };
