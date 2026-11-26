'use strict';

function migrateOvertimeSettlementOrder(db) {
  if (!db.prepare('PRAGMA table_info(overtime_settlements)').all().some(column => column.name === 'settled_order')) {
    db.exec(`ALTER TABLE overtime_settlements ADD COLUMN settled_order INTEGER NOT NULL DEFAULT 0;
      WITH completed AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY updated_at, id) AS position
        FROM overtime_settlements WHERE status IN ('applied', 'ignored')
      )
      UPDATE overtime_settlements SET settled_order = (SELECT position FROM completed WHERE completed.id = overtime_settlements.id)
      WHERE status IN ('applied', 'ignored');`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_overtime_settlements_completion
    ON overtime_settlements(settled_order DESC, id DESC) WHERE status IN ('applied', 'ignored');
    CREATE TRIGGER IF NOT EXISTS overtime_settlement_completed AFTER UPDATE OF status ON overtime_settlements
    WHEN OLD.status = 'pending' AND NEW.status IN ('applied', 'ignored')
    BEGIN
      UPDATE overtime_settlements SET settled_order = (
        SELECT COALESCE(MAX(settled_order), 0) + 1 FROM overtime_settlements WHERE status IN ('applied', 'ignored')
      ) WHERE id = NEW.id;
    END;`);
}

module.exports = { migrateOvertimeSettlementOrder };
