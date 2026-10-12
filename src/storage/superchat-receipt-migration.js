'use strict';

// The migration runner owns the transaction. Deleted SCs retain only replay protection.
function migrateSuperChatReceipts(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS super_chat_receipts (
      platform_id TEXT PRIMARY KEY NOT NULL
    ) WITHOUT ROWID;

    CREATE TRIGGER IF NOT EXISTS retain_super_chat_receipt BEFORE DELETE ON super_chats
    WHEN OLD.platform_id <> ''
    BEGIN
      INSERT OR IGNORE INTO super_chat_receipts (platform_id) VALUES (OLD.platform_id);
    END;

    DELETE FROM super_chats WHERE status = 'deleted';
  `);
}

module.exports = { migrateSuperChatReceipts };
