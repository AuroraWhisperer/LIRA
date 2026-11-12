'use strict';

const { DAY_MS, dayStart } = require('../shared/gift-summary-contract');
const LOCAL_DETAIL_DAYS = 365;

function localDetailStart(snapshot) {
  return snapshot?.summarized_before
    ? new Date(dayStart(snapshot.summarized_before) - LOCAL_DETAIL_DAYS * DAY_MS).toISOString() : null;
}

// Called only by the activation transaction. A full history snapshot can jump
// over delivery cursors; their event dates need not lie inside the outage.
function publishDetailCoverage(db, sourceId, state, active, staging, cursor) {
  const full = staging.member_snapshot_id === staging.id;
  const continuous = active?.sync_epoch === staging.sync_epoch && state.sync_epoch === staging.sync_epoch &&
    (!full || (state.final_cursor !== null && state.final_cursor >= cursor));
  if (!continuous) db.prepare('DELETE FROM gift_local_detail_coverage WHERE source_id=?').run(sourceId);
  const start = continuous && !full ? active.summarized_before : staging.detail_start;
  const end = staging.summarized_before;
  if (!start || !end || start >= end) return;
  const cutoff = localDetailStart(staging);
  const ranges = db.prepare('SELECT start_at,end_at FROM gift_local_detail_coverage WHERE source_id=? AND sync_epoch=? ORDER BY start_at')
    .all(sourceId, staging.sync_epoch);
  ranges.push({ start_at: start, end_at: end });
  ranges.sort((a, b) => a.start_at.localeCompare(b.start_at));
  const merged = [];
  for (const range of ranges) {
    if (range.end_at <= cutoff) continue;
    range.start_at = range.start_at < cutoff ? cutoff : range.start_at;
    const previous = merged.at(-1);
    if (previous && range.start_at <= previous.end_at) previous.end_at = previous.end_at > range.end_at ? previous.end_at : range.end_at;
    else merged.push(range);
  }
  db.prepare('DELETE FROM gift_local_detail_coverage WHERE source_id=?').run(sourceId);
  const insert = db.prepare('INSERT INTO gift_local_detail_coverage VALUES (?,?,?,?)');
  for (const range of merged) insert.run(sourceId, staging.sync_epoch, range.start_at, range.end_at);
}

function readDetailAvailability(db, sourceId, snapshot, { rangeStart, rangeEnd, asOf, complete = false } = {}) {
  if (!snapshot) return null;
  const detailStart = localDetailStart(snapshot);
  const coverage = db.prepare(`SELECT start_at AS start,end_at AS end FROM gift_local_detail_coverage
    WHERE source_id=? AND sync_epoch=? ORDER BY start_at`).all(sourceId, snapshot.sync_epoch);
  const start = rangeStart || detailStart;
  const end = rangeEnd || asOf || snapshot.summarized_before;
  let availability = 'partial';
  if (detailStart && end && end <= detailStart) availability = 'expired';
  else if (start && end && start >= detailStart) {
    // Closed days have durable proofs; the current partial day additionally
    // requires the existing live/validated synchronization state.
    const before = snapshot.summarized_before;
    const currentDay = end > before && Date.parse(end) <= Date.parse(before) + DAY_MS;
    const target = currentDay && complete ? before : end;
    let through = start;
    for (const range of coverage) {
      if (range.end <= through) continue;
      if (range.start > through) break;
      through = range.end;
    }
    if (through >= target && (end <= before || (currentDay && complete))) availability = 'retained';
  }
  return { detailStart, serverDetailStart: snapshot.detail_start, summaryRevision: snapshot.revision,
    availability, coverage, retentionDays: LOCAL_DETAIL_DAYS };
}

module.exports = { localDetailStart, publishDetailCoverage, readDetailAvailability };
