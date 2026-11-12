'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { now } = require('../shared/utils');

const CLOUD_BILIBILI_LOGOUT_PENDING_PREFIX = 'cloudBilibiliLogoutPending:';
const pendingKey = (accountKey) => CLOUD_BILIBILI_LOGOUT_PENDING_PREFIX + createHash('sha256').update(accountKey).digest('hex');

function createCloudBilibiliSyncStore(db) {
  return {
    captureLogout(accountKey) {
      const pending = { mutationId: randomUUID() };
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(pendingKey(accountKey), JSON.stringify(pending), now());
      return pending;
    },

    readLogout(accountKey) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(pendingKey(accountKey));
      return row ? JSON.parse(row.value) : null;
    },

    acknowledgeLogout(accountKey, mutationId) {
      const result = db.prepare(`DELETE FROM settings WHERE key = ? AND json_extract(value, '$.mutationId') = ?`)
        .run(pendingKey(accountKey), mutationId);
      return Number(result.changes) === 1;
    },
  };
}

module.exports = { CLOUD_BILIBILI_LOGOUT_PENDING_PREFIX, createCloudBilibiliSyncStore };
