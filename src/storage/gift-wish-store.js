'use strict';

const { statisticsFilter } = require('./gift-retention-queries');
const { wishMatch, readWishContributions } = require('./gift-wish-retention');

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
    if (!start || !end || start > end) return 0;
    const match = wishMatch(wish);
    const filter = { sql: `g.source_id=? AND g.created_at>=? AND g.created_at<=?
      AND g.status = 'active' AND g.detection_status='final'
      AND g.num>0 AND g.num=CAST(g.num AS INTEGER) AND ${match.sql}`, params: [sourceId, start, end, ...match.params] };
    const plan = statisticsFilter(db, { sourceId, rangeStart: start, asOf: end }, filter);
    let count = Number(db.prepare(`SELECT COALESCE(SUM(g.num),0) AS count FROM gift_events g WHERE ${filter.sql}`).get(...filter.params).count);
    if (plan.window) {
      const { snapshot, window } = plan;
      const summaryMatch = wishMatch(wish, true);
      count += Number(db.prepare(`SELECT COALESCE(SUM(json_extract(s.metrics_json,'$.itemCount')),0) AS count
        FROM gift_retention_days s WHERE s.source_id=? AND s.sync_epoch=? AND s.day_start>=? AND s.day_start<?
        AND s.revision=(SELECT MAX(d.revision) FROM gift_retention_days d
          WHERE d.source_id=s.source_id AND d.sync_epoch=s.sync_epoch AND d.day_start=s.day_start AND d.revision<=?)
        AND ${summaryMatch.sql}`).get(sourceId, snapshot.sync_epoch, window.start, window.end,
        snapshot.revision, ...summaryMatch.params).count);
    }
    return count + readWishContributions(db, sourceId, wish.id, start, end, plan);
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
    readSession: (sourceId, roomId) => session.get(sourceId, roomId) || null,
    saveSession(sourceId, roomId, value) {
      saveSession.run(sourceId, roomId, value.started_at, value.ended_at, value.checked_at);
    },
  };
}

module.exports = { createGiftWishStore };
