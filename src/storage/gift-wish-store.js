'use strict';

const { statisticsFilter, activeSnapshot } = require('./gift-retention-queries');
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
    const groups = new Map();
    requests.forEach(({ wish, start, end }, index) => {
      if (!start || !end || start > end) return;
      const key = JSON.stringify([start, end]);
      if (!groups.has(key)) groups.set(key, { start, end, entries: [] });
      groups.get(key).entries.push({ wish, index });
    });
    if (!groups.size) return result;
    const snapshot = activeSnapshot(db, sourceId);
    for (const { start, end, entries } of groups.values()) {
      const filter = { sql: `g.source_id=? AND g.created_at>=? AND g.created_at<=?
        AND g.status = 'active' AND g.detection_status='final'
        AND g.num>0 AND g.num=CAST(g.num AS INTEGER)`, params: [sourceId, start, end] };
      const plan = statisticsFilter(db, { sourceId, rangeStart: start, asOf: end }, filter, snapshot);
      const matches = entries.map(({ wish }) => wishMatch(wish));
      if (matches.length === 1) {
        filter.sql += ` AND (${matches[0].sql})`;
        filter.params.push(...matches[0].params);
      }
      const sums = matches.map((match, index) => `COALESCE(SUM(CASE WHEN ${match.sql} THEN g.num ELSE 0 END),0) AS c${index}`);
      const counts = db.prepare(`SELECT ${sums.join(',')} FROM gift_events g WHERE ${filter.sql}`)
        .get(...matches.flatMap((match) => match.params), ...filter.params);
      let summaries = {};
      if (plan.window) {
        const { window } = plan;
        const matches = entries.map(({ wish }) => wishMatch(wish, true));
        const sums = matches.map((match, index) => `COALESCE(SUM(CASE WHEN ${match.sql}
          THEN json_extract(s.metrics_json,'$.itemCount') ELSE 0 END),0) AS c${index}`);
        summaries = db.prepare(`SELECT ${sums.join(',')} FROM gift_retention_days s
          WHERE s.source_id=? AND s.sync_epoch=? AND s.day_start>=? AND s.day_start<?
          AND s.revision=(SELECT MAX(d.revision) FROM gift_retention_days d
            WHERE d.source_id=s.source_id AND d.sync_epoch=s.sync_epoch AND d.day_start=s.day_start AND d.revision<=?)`)
          .get(...matches.flatMap((match) => match.params), sourceId, snapshot.sync_epoch, window.start, window.end, snapshot.revision);
      }
      const contributions = readWishContributionCounts(db, sourceId, entries.map(({ wish }) => wish.id), start, end, plan);
      entries.forEach(({ wish, index }, position) => {
        result[index] = Number(counts[`c${position}`]) + Number(summaries[`c${position}`] || 0) + (contributions.get(wish.id) || 0);
      });
    }
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
