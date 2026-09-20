'use strict';

const { randomUUID } = require('node:crypto');
const { createFanRecordStore } = require('./fan-record-store');

function decodeProfile(row) {
  return row
    ? {
        ...JSON.parse(row.data),
        id: row.id,
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : null;
}

function createFanProfileStore(db) {
  const records = createFanRecordStore(db);

  function transaction(work) {
    db.exec('SAVEPOINT fan_operation');
    try {
      const result = work();
      db.exec('RELEASE fan_operation');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO fan_operation');
      db.exec('RELEASE fan_operation');
      throw error;
    }
  }

  function get(scope, id) {
    return decodeProfile(
      db
        .prepare('SELECT * FROM fan_profiles WHERE scope = ? AND id = ?')
        .get(scope, id),
    );
  }

  function list(scope) {
    return db
      .prepare(
        'SELECT * FROM fan_profiles WHERE scope = ? ORDER BY updated_at DESC, id',
      )
      .all(scope)
      .map(decodeProfile);
  }

  function byIdentity(scope, key) {
    return decodeProfile(
      db
        .prepare(
          'SELECT * FROM fan_profiles WHERE scope = ? AND identity_key = ?',
        )
        .get(scope, key),
    );
  }

  function save(scope, profile, key, now) {
    const duplicate = key ? byIdentity(scope, key) : null;
    if (duplicate && duplicate.id !== profile.id) {
      const error = new Error('该身份已有档案，请打开已有档案或明确合并。');
      error.existingId = duplicate.id;
      throw error;
    }
    if (profile.id) {
      const result = db
        .prepare(
          `UPDATE fan_profiles SET identity_key = ?, data = ?, revision = revision + 1,
        updated_at = ? WHERE scope = ? AND id = ? AND revision = ?`,
        )
        .run(
          key,
          JSON.stringify(profile),
          now,
          scope,
          profile.id,
          profile.revision,
        );
      if (result.changes !== 1)
        throw new Error('档案已更新，请重新加载后核对；未保存的输入仍保留。');
      return get(scope, profile.id);
    }
    const id = randomUUID();
    db.prepare(
      'INSERT INTO fan_profiles (id, scope, identity_key, data, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, scope, key, JSON.stringify(profile), now);
    return get(scope, id);
  }

  function getScope(scope) {
    const row = db
      .prepare('SELECT data FROM fan_scopes WHERE scope = ?')
      .get(scope);
    return row
      ? JSON.parse(row.data)
      : {
          initialized: false,
          autoUpdate: true,
          autoCreate: true,
          cursor: 0,
          epoch: null,
        };
  }

  function saveScope(scope, data) {
    db.prepare(
      'INSERT INTO fan_scopes (scope, data) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET data = excluded.data',
    ).run(scope, JSON.stringify(data));
  }

  function states(scope, profileId) {
    return db
      .prepare(
        'SELECT item_key, data FROM fan_reminder_states WHERE scope = ? AND profile_id = ?',
      )
      .all(scope, profileId)
      .map((row) => ({ key: row.item_key, ...JSON.parse(row.data) }));
  }

  function saveState(scope, profileId, key, data) {
    if (!get(scope, profileId)) throw new Error('档案不存在。');
    db.prepare(
      `INSERT INTO fan_reminder_states (scope, profile_id, item_key, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(scope, profile_id, item_key) DO UPDATE SET data = excluded.data`,
    ).run(scope, profileId, key, JSON.stringify(data));
  }

  function statesForProfiles(scope, profileIds) {
    const grouped = new Map();
    for (let offset = 0; offset < profileIds.length; offset += 500) {
      const batch = profileIds.slice(offset, offset + 500);
      const rows = db.prepare(`
        SELECT profile_id, item_key, data FROM fan_reminder_states WHERE scope = ?
          AND profile_id IN (${batch.map(() => '?').join(', ')})
        ORDER BY profile_id, item_key
      `).all(scope, ...batch);
      for (const row of rows) {
        if (!grouped.has(row.profile_id)) grouped.set(row.profile_id, []);
        grouped.get(row.profile_id).push({ key: row.item_key, ...JSON.parse(row.data) });
      }
    }
    return grouped;
  }

  function remove(scope, id, suppress) {
    const row = db
      .prepare(
        'SELECT identity_key FROM fan_profiles WHERE scope = ? AND id = ?',
      )
      .get(scope, id);
    if (!row) throw new Error('档案不存在。');
    if (suppress && row.identity_key) {
      db.prepare('INSERT OR IGNORE INTO fan_suppressions VALUES (?, ?)').run(
        scope,
        row.identity_key,
      );
    }
    db.prepare('DELETE FROM fan_profiles WHERE scope = ? AND id = ?').run(
      scope,
      id,
    );
  }

  function removeAll(scope) {
    const result = db
      .prepare('DELETE FROM fan_profiles WHERE scope = ?')
      .run(scope);
    return Number(result.changes) || 0;
  }

  function exportScope(scope) {
    return {
      profiles: list(scope).map((profile) => ({
        ...profile,
        records: records.list(scope, profile.id),
        reminders: states(scope, profile.id),
      })),
      settings: getScope(scope),
      suppressions: db
        .prepare('SELECT identity_key FROM fan_suppressions WHERE scope = ?')
        .all(scope)
        .map((row) => row.identity_key),
    };
  }

  function snapshot(scope, data, now) {
    const id = randomUUID();
    db.prepare('INSERT INTO fan_restore_snapshots VALUES (?, ?, ?, ?)').run(
      id,
      scope,
      now,
      JSON.stringify(data),
    );
    return id;
  }

  function restoreProfile(scope, profile, key, now) {
    db.prepare(
      'INSERT INTO fan_profiles (id, scope, identity_key, data, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      profile.id,
      scope,
      key,
      JSON.stringify(profile),
      profile.revision || 1,
      now,
    );
    return get(scope, profile.id);
  }

  function moveRecords(scope, from, to) {
    if (!get(scope, from) || !get(scope, to))
      throw new Error('待合并档案不存在。');
    db.prepare(
      'UPDATE fan_records SET profile_id = ? WHERE scope = ? AND profile_id = ?',
    ).run(to, scope, from);
  }

  function snapshots(scope) {
    return db
      .prepare(
        'SELECT id, created_at, data FROM fan_restore_snapshots WHERE scope = ? ORDER BY created_at DESC, rowid DESC',
      )
      .all(scope)
      .map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        reason: JSON.parse(row.data).reason || '恢复完整备份之前',
      }));
  }

  function getSnapshot(scope, id) {
    const row = db
      .prepare(
        'SELECT data FROM fan_restore_snapshots WHERE scope = ? AND id = ?',
      )
      .get(scope, id);
    if (!row) throw new Error('恢复点不存在或不属于当前账号。');
    return JSON.parse(row.data);
  }

  function legacy(scope, identityValue, from, to) {
    return db
      .prepare(
        `SELECT * FROM requests WHERE requester_uid = ? AND (owner_scope IS NULL OR owner_scope = ?)
      AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?) ORDER BY created_at, id`,
      )
      .all(identityValue, scope, from, to)
      .map((row) => ({
        id: row.id,
        stableId: row.stable_id,
        scope: row.owner_scope,
        identityType: row.identity_type,
        queueId: row.queue_id,
        songName: row.song_name,
        artist: row.artist,
        category: row.category_name,
        occurredAt: row.created_at,
        userName: row.requester_name,
        source: row.source,
      }));
  }

  function claimRequest(id, scope) {
    const row = db
      .prepare('SELECT stable_id, owner_scope FROM requests WHERE id = ?')
      .get(id);
    if (!row || (row.owner_scope && row.owner_scope !== scope))
      throw new Error('点歌归属已变化，请重新预览。');
    const stableId = row.stable_id || randomUUID();
    db.prepare(
      'UPDATE requests SET stable_id = ?, owner_scope = ?, identity_type = ? WHERE id = ?',
    ).run(stableId, scope, 'uid', id);
    return stableId;
  }

  return {
    transaction,
    get,
    list,
    byIdentity,
    save,
    records,
    getScope,
    saveScope,
    states,
    statesForProfiles,
    saveState,
    remove,
    removeAll,
    exportScope,
    snapshot,
    restoreProfile,
    legacy,
    claimRequest,
    moveRecords,
    snapshots,
    getSnapshot,
    suppressed: (scope, key) =>
      Boolean(
        db
          .prepare(
            'SELECT 1 FROM fan_suppressions WHERE scope = ? AND identity_key = ?',
          )
          .get(scope, key),
      ),
    suppress: (scope, key) =>
      db
        .prepare('INSERT OR IGNORE INTO fan_suppressions VALUES (?, ?)')
        .run(scope, key),
    unsuppress: (scope, key) =>
      db
        .prepare(
          'DELETE FROM fan_suppressions WHERE scope = ? AND identity_key = ?',
        )
        .run(scope, key),
  };
}

module.exports = { createFanProfileStore };
