'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { now } = require('../shared/utils');
const { CLOUD_SYNC_KEYS } = require('../shared/cloud-settings');

const CLOUD_SETTINGS_SYNC_PENDING_PREFIX = 'cloudSettingsSyncPending:';
const CLOUD_SETTINGS_ACCOUNT_KEY = 'cloudSettingsAccountKey';
const pendingKey = (accountKey) => CLOUD_SETTINGS_SYNC_PENDING_PREFIX + createHash('sha256').update(accountKey).digest('hex');

function createCloudSettingsSyncStore(db) {
  function assertAccount(accountKey) {
    const owner = db.prepare('SELECT value FROM settings WHERE key = ?').get(CLOUD_SETTINGS_ACCOUNT_KEY)?.value;
    if (owner !== undefined && owner !== accountKey) {
      throw Object.assign(new Error('当前账号的设置尚未恢复，请联网后稍候重试。'), {
        code: 'CLOUD_SETTINGS_NOT_READY', statusCode: 503,
      });
    }
  }

  return {
    assertAccount,

    initializeAccount(accountKey) {
      db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run(CLOUD_SETTINGS_ACCOUNT_KEY, accountKey, now());
    },

    acceptAccount(accountKey) {
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(CLOUD_SETTINGS_ACCOUNT_KEY, accountKey, now());
    },

    // Called inside the settings mutation's transaction; the owner is already authenticated.
    capturePending(settings) {
      const accountKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('cloudRoomAccountKey')?.value;
      if (!accountKey) return;
      assertAccount(accountKey);
      const values = Object.fromEntries(CLOUD_SYNC_KEYS.map((key) => [key, settings[key]]));
      db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(pendingKey(accountKey), JSON.stringify({ mutationId: randomUUID(), values }), now());
    },

    readPending(accountKey) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(pendingKey(accountKey));
      return row ? JSON.parse(row.value) : null;
    },

    acknowledge(accountKey, mutationId) {
      const result = db.prepare(`
        DELETE FROM settings WHERE key = ? AND json_extract(value, '$.mutationId') = ?
      `).run(pendingKey(accountKey), mutationId);
      return Number(result.changes) === 1;
    },
  };
}

module.exports = { CLOUD_SETTINGS_ACCOUNT_KEY, CLOUD_SETTINGS_SYNC_PENDING_PREFIX, createCloudSettingsSyncStore };
