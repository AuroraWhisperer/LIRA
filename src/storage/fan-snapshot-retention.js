'use strict';

function pruneFanRestoreSnapshots(db, scope) {
  return Number(db.prepare(`
    DELETE FROM fan_restore_snapshots WHERE rowid IN (
      SELECT rowid FROM (
        SELECT rowid, ROW_NUMBER() OVER (
          PARTITION BY scope ORDER BY created_at DESC, rowid DESC
        ) AS position FROM fan_restore_snapshots ${scope === undefined ? '' : 'WHERE scope = ?'}
      ) WHERE position > 2
    )
  `).run(...(scope === undefined ? [] : [scope])).changes);
}

module.exports = { pruneFanRestoreSnapshots };
