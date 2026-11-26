'use strict';

const { normalizeTimestampMs, timestampPrecisionMs } = require('../shared/utils');

function precedes(left, right) {
  if (left.end < right.start) return true;
  if (right.end < left.start) return false;
  let listed = false;
  for (const [index, offset] of left.offsets.entries()) {
    const other = right.offsets[index];
    if (offset == null || other == null) continue;
    if (offset >= other) return false;
    listed = true;
  }
  return listed || (left.before && right.before && left.start === left.end &&
    right.start === right.end && left.row.id < right.row.id);
}

// The queue stores normalized ISO instants. Recover precision from the original
// input when possible. For older rows, trailing zeros can be padding.
function requestWidth(row, time, entries, observed) {
  const random = row.source === 'random' || row.source?.startsWith('random:');
  const original = observed.filter(item => (random || item.source === row.source) &&
    item.message === row.request_message && normalizeTimestampMs(item.timeline) === time);
  if (original.length) return Math.max(...original.map(item => timestampPrecisionMs(item.timeline)));
  const listed = entries.filter(entry => entry && normalizeTimestampMs(entry.timeline) === time);
  if (listed.length) return Math.max(...listed.map(entry => timestampPrecisionMs(entry.timeline)));
  let width = 1;
  while (width < 1000 && time % (width * 10) === 0) width *= 10;
  return width;
}

function uniquePositions(requests) {
  const positions = new Map();
  for (const entry of requests) {
    positions.set(entry.message, positions.has(entry.message) ? null : entry);
  }
  return positions;
}

// Rows already match the requester, newest first. A repeated raw command can
// represent different queued songs (random requests), even for a named cancel.
function selectHistoricalCancellation(rows, { timeline, siblings = [], mirrorSiblings = [], observed = [] }, matchesTitle) {
  const start = normalizeTimestampMs(timeline);
  if (!start) return null;
  const end = start + timestampPrecisionMs(timeline) - 1;
  const second = start - start % 1000;
  const sameSecond = [];
  const seen = new Set();
  const orders = [siblings, mirrorSiblings].map(uniquePositions);
  let earlier;
  for (const row of rows) {
    const time = Date.parse(row.created_at);
    if (!Number.isFinite(time)) {
      if (matchesTitle(row)) return null;
      continue;
    }
    if (time < second) {
      if (!earlier && matchesTitle(row)) earlier = row;
      continue;
    }
    if (time >= second + 1000) continue;
    const message = row.request_message;
    if (seen.has(message)) {
      for (const order of orders) order.delete(message);
    }
    seen.add(message);
    if (time <= end) sameSecond.push({ row, start: time });
  }

  let earliestCancel = start;
  let latestCancel = end;
  for (const candidate of sameSecond) {
    const { row, start: time } = candidate;
    const entries = orders.map(order => order.get(row.request_message));
    candidate.offsets = entries.map(entry => {
      if (!entry) return;
      const listedTime = normalizeTimestampMs(entry.timeline);
      if (listedTime <= time && time < listedTime + timestampPrecisionMs(entry.timeline)) return entry.offset;
    });
    const offset = candidate.offsets.find(value => value != null);
    candidate.listedBefore = offset < 0;
    candidate.listedAfter = offset > 0;
    candidate.end = time + requestWidth(row, time, entries, observed) - 1;
    if (candidate.end < start) continue;
    if (candidate.listedBefore) earliestCancel = Math.max(earliestCancel, time);
    if (candidate.listedAfter) latestCancel = Math.min(latestCancel, candidate.end);
  }
  if (earliestCancel > latestCancel) return null;
  const possible = [];
  for (const candidate of sameSecond) {
    if (!matchesTitle(candidate.row) || candidate.start > latestCancel ||
        (candidate.end >= start && candidate.listedAfter)) continue;
    candidate.before = candidate.end < earliestCancel || candidate.listedBefore;
    possible.push(candidate);
  }
  if (!possible.length) return earlier || null;
  const latest = possible.reduce((a, b) => precedes(a, b) ? b : a);
  return latest.before && possible.every(item => item === latest || precedes(item, latest)) ? latest.row : null;
}

module.exports = { selectHistoricalCancellation };
