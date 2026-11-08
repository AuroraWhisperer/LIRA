'use strict';

const { retentionLedgerFilter, summaryWindow, excludeSummarizedDetails, activeSnapshot } = require('./gift-retention-queries');
const { wishMatch, readWishContributionCounts } = require('./gift-wish-retention');

function createGiftWishStore(db) {
  const list = db.prepare('SELECT * FROM gift_wishes WHERE source_id = ? ORDER BY created_at, id');
  const insert = db.prepare(`INSERT INTO gift_wishes
    (id, source_id, period, gift_id, variant_id, gift_name, gift_category, image_path, target, label, created_at,
      display_style, text_template, text_image_position, text_image_format, text_pending_color, text_received_color, text_runs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE gift_wishes SET target = ?, label = ?,
    display_style = COALESCE(?, display_style), text_template = COALESCE(?, text_template),
    text_image_position = COALESCE(?, text_image_position), text_image_format = COALESCE(?, text_image_format),
    text_pending_color = COALESCE(?, text_pending_color), text_received_color = COALESCE(?, text_received_color),
    text_runs = COALESCE(?, text_runs)
    WHERE source_id = ? AND id = ?`);
  const remove = db.prepare('DELETE FROM gift_wishes WHERE source_id = ? AND id = ?');
  const session = db.prepare('SELECT * FROM gift_wish_sessions WHERE source_id = ? AND room_id = ?');
  const saveSession = db.prepare(`INSERT INTO gift_wish_sessions
    (source_id, room_id, started_at, ended_at, checked_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET room_id = excluded.room_id, started_at = excluded.started_at,
      ended_at = excluded.ended_at, checked_at = excluded.checked_at`);

  function count(sourceId, wish, start, end) {
    return countMany(sourceId, [{ wish, start, end }])[0];
  }

  function countMany(sourceId, requests) {
    const result = requests.map(() => 0);
    const entries = requests.flatMap(({ wish, start, end }, index) =>
      start && end && start <= end ? [{ wish, start, end, index }] : []);
    if (!entries.length) return result;
    const snapshot = activeSnapshot(db, sourceId);
    for (const entry of entries) entry.window = summaryWindow(snapshot, { rangeStart: entry.start, asOf: entry.end });
    const start = entries.map(entry => entry.start).sort()[0];
    const end = entries.map(entry => entry.end).sort().at(-1);
    const filter = { sql: `g.source_id=? AND g.created_at>=? AND g.created_at<=?
      AND g.status = 'active' AND g.detection_status='final'
      AND g.num>0 AND g.num=CAST(g.num AS INTEGER)`, params: [sourceId, start, end] };
    retentionLedgerFilter(db, { sourceId }, filter, { statistics: true, snapshot });
    const matches = entries.map(entry => {
      const match = wishMatch(entry.wish);
      match.sql = `(${match.sql}) AND g.created_at>=? AND g.created_at<=?`;
      match.params.push(entry.start, entry.end);
      excludeSummarizedDetails(match, snapshot, entry.window);
      return match;
    });
    if (entries.length === 1) {
      filter.sql += ` AND (${matches[0].sql})`;
      filter.params.push(...matches[0].params);
    }
    // Each CASE retains its exact window; the shared scan checks active membership once per row.
    const sums = matches.map((match, index) => `COALESCE(SUM(CASE WHEN ${match.sql} THEN g.num ELSE 0 END),0) AS c${entries[index].index}`);
    const counts = db.prepare(`SELECT ${sums.join(',')} FROM gift_events g WHERE ${filter.sql}`)
      .get(...matches.flatMap(match => match.params), ...filter.params);
    let summaries = {};
    const summarized = entries.filter(entry => entry.window);
    if (summarized.length) {
      const matches = summarized.map(({ wish, window }) => {
        const match = wishMatch(wish, true);
        return { sql: `(${match.sql}) AND s.day_start>=? AND s.day_start<?`,
          params: [...match.params, window.start, window.end] };
      });
      const sums = matches.map((match, index) => `COALESCE(SUM(CASE WHEN ${match.sql}
        THEN json_extract(s.metrics_json,'$.itemCount') ELSE 0 END),0) AS c${summarized[index].index}`);
      summaries = db.prepare(`SELECT ${sums.join(',')} FROM gift_retention_days s
        WHERE s.source_id=? AND s.sync_epoch=? AND s.day_start>=? AND s.day_start<?
        AND s.revision=(SELECT MAX(d.revision) FROM gift_retention_days d
          WHERE d.source_id=s.source_id AND d.sync_epoch=s.sync_epoch AND d.day_start=s.day_start AND d.revision<=?)`)
        .get(...matches.flatMap(match => match.params), sourceId, snapshot.sync_epoch,
          summarized.map(entry => entry.window.start).sort()[0],
          summarized.map(entry => entry.window.end).sort().at(-1), snapshot.revision);
    }
    const contributions = readWishContributionCounts(db, sourceId, entries, snapshot);
    for (const { index } of entries)
      result[index] = Number(counts[`c${index}`]) + Number(summaries[`c${index}`] || 0) + (contributions.get(index) || 0);
    return result;
  }

  return {
    list: (sourceId) => list.all(sourceId),
    insert(sourceId, wish) {
      insert.run(
        wish.id,
        sourceId,
        wish.period,
        wish.giftId,
        wish.variantId,
        wish.giftName,
        wish.giftCategory,
        wish.imagePath,
        wish.target,
        wish.label,
        wish.createdAt,
        wish.displayStyle,
        wish.textTemplate,
        wish.textImagePosition,
        wish.textImageFormat,
        wish.textPendingColor,
        wish.textReceivedColor,
        JSON.stringify(wish.textRuns || []),
      );
    },
    update: (sourceId, id, { target, label, displayStyle, textTemplate, textImagePosition, textImageFormat, textPendingColor, textReceivedColor, textRuns }) =>
      Number(
        update.run(
          target,
          label,
          displayStyle ?? null,
          textTemplate ?? null,
          textImagePosition ?? null,
          textImageFormat ?? null,
          textPendingColor ?? null,
          textReceivedColor ?? null,
          textRuns === undefined ? null : JSON.stringify(textRuns),
          sourceId,
          id,
        ).changes,
      ),
    remove: (sourceId, id) => Number(remove.run(sourceId, id).changes),
    count,
    countMany,
    readSession: (sourceId, roomId) => session.get(sourceId, roomId) || null,
    saveSession(sourceId, roomId, value) {
      saveSession.run(sourceId, roomId, value.started_at, value.ended_at, value.checked_at);
    },
  };
}

module.exports = { createGiftWishStore };
