'use strict';

const { GUARD_GIFT_ALIASES } = require('../bilibili/gift/guard-gift-aliases');

function createGiftWishStore(db) {
  const list = db.prepare('SELECT * FROM gift_wishes WHERE source_id = ? ORDER BY created_at, id');
  const insert = db.prepare(`INSERT INTO gift_wishes
    (id, source_id, period, gift_id, variant_id, gift_name, gift_category, image_path, target, label, created_at, display_style, text_template)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE gift_wishes SET target = ?, label = ?,
    display_style = COALESCE(?, display_style), text_template = COALESCE(?, text_template)
    WHERE source_id = ? AND id = ?`);
  const remove = db.prepare('DELETE FROM gift_wishes WHERE source_id = ? AND id = ?');
  const session = db.prepare('SELECT * FROM gift_wish_sessions WHERE source_id = ? AND room_id = ?');
  const saveSession = db.prepare(`INSERT INTO gift_wish_sessions
    (source_id, room_id, started_at, ended_at, checked_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET room_id = excluded.room_id, started_at = excluded.started_at,
      ended_at = excluded.ended_at, checked_at = excluded.checked_at`);

  function count(sourceId, wish, start, end) {
    if (!start || !end || start > end) return 0;
    const box = wish.gift_category === 'blindBox';
    const params = [sourceId, start, end];
    let match;
    if (GUARD_GIFT_ALIASES[wish.gift_id]) {
      const ids = [wish.gift_id, ...GUARD_GIFT_ALIASES[wish.gift_id]];
      match = `gift_id IN (${ids.map(() => '?').join(',')}) AND is_blind_box = 0`;
      params.push(...ids);
    } else {
      const column = box ? 'blind_box_id' : 'gift_id';
      const variant = box ? 'blind_box_variant_id' : 'gift_variant_id';
      match = wish.variant_id ? `${variant} = ?` : `${column} = ?`;
      params.push(wish.variant_id || wish.gift_id);
      if (box || wish.gift_category === 'blindBoxOutput') match += ' AND is_blind_box = 1';
    }
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(num), 0) AS count FROM gift_events
      WHERE source_id = ? AND created_at >= ? AND created_at <= ?
        AND status = 'active' AND detection_status = 'final'
        AND num > 0 AND num = CAST(num AS INTEGER) AND ${match}`,
      )
      .get(...params);
    return Number(row.count);
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
      );
    },
    update: (sourceId, id, { target, label, displayStyle, textTemplate }) =>
      Number(update.run(target, label, displayStyle ?? null, textTemplate ?? null, sourceId, id).changes),
    remove: (sourceId, id) => Number(remove.run(sourceId, id).changes),
    count,
    readSession: (sourceId, roomId) => session.get(sourceId, roomId) || null,
    saveSession(sourceId, roomId, value) {
      saveSession.run(sourceId, roomId, value.started_at, value.ended_at, value.checked_at);
    },
  };
}

module.exports = { createGiftWishStore };
