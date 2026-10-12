'use strict';

// The caller owns the transaction. Keep only the create request receipt so a
// retried old request cannot silently create another draw after its data is gone.
function pruneCompletedTasks(db, { streamerId, keepLatest = false, keepId = null } = {}) {
  const rows = db.prepare(`SELECT * FROM (
    SELECT id, streamer_id, request_id, rules_json, status, updated_at_ms,
      ROW_NUMBER() OVER (PARTITION BY streamer_id ORDER BY created_at_ms DESC, id DESC) AS position
    FROM lottery_tasks ${streamerId === undefined ? '' : 'WHERE streamer_id = ?'}
  ) WHERE status IN ('completed', 'exhausted') AND id IS NOT ? ${keepLatest ? 'AND position > 1' : ''}`)
    .all(...(streamerId === undefined ? [] : [streamerId]), keepId);
  const remove = db.prepare('DELETE FROM lottery_tasks WHERE id = ? AND streamer_id = ?');
  const receipt = db.prepare(`INSERT INTO lottery_events
    (streamer_id, event_type, request_id, request_hash, created_at_ms)
    VALUES (?, 'create-retired', ?, ?, ?)`);
  for (const row of rows) {
    const signature = JSON.parse(row.rules_json).inputSignature || '';
    remove.run(row.id, row.streamer_id);
    if (row.request_id) receipt.run(row.streamer_id, row.request_id, signature, row.updated_at_ms);
  }
  return rows.length;
}

module.exports = { pruneCompletedTasks };
