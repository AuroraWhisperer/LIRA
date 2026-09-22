'use strict';

const { randomUUID } = require('node:crypto');

function decodeRecord(row) {
  return row
    ? {
        id: row.id,
        profileId: row.profile_id,
        kind: row.kind,
        sourceKey: row.source_key,
        occurredAt: row.occurred_at,
        data: JSON.parse(row.data),
        original: JSON.parse(row.original),
        revisions: JSON.parse(row.revisions),
        revision: row.revision,
      }
    : null;
}

function createFanRecordStore(db) {
  function list(scope, profileId) {
    return db
      .prepare('SELECT * FROM fan_records WHERE scope = ? AND profile_id = ? ORDER BY occurred_at DESC, id')
      .all(scope, profileId)
      .map(decodeRecord);
  }

  function listForProfiles(scope, profileIds) {
    const grouped = new Map();
    for (let offset = 0; offset < profileIds.length; offset += 500) {
      const batch = profileIds.slice(offset, offset + 500);
      const rows = db
        .prepare(
          `
        SELECT * FROM fan_records WHERE scope = ?
          AND profile_id IN (${batch.map(() => '?').join(', ')})
        ORDER BY profile_id, occurred_at DESC, id
      `,
        )
        .all(scope, ...batch);
      for (const row of rows) {
        if (!grouped.has(row.profile_id)) grouped.set(row.profile_id, []);
        grouped.get(row.profile_id).push(decodeRecord(row));
      }
    }
    return grouped;
  }

  function insert(scope, profileId, record) {
    if (record.sourceKey) {
      const existing = db
        .prepare('SELECT * FROM fan_records WHERE scope = ? AND source_key = ?')
        .get(scope, record.sourceKey);
      if (existing) {
        if (existing.profile_id !== profileId) throw new Error('相同来源记录已关联另一份档案，请先核对。');
        return decodeRecord(existing);
      }
    }
    const id = record.id || randomUUID();
    const original = record.original || {
      ...record.data,
      occurredAt: record.occurredAt,
      source: record.source || 'manual',
    };
    db.prepare(
      `INSERT INTO fan_records (id, scope, profile_id, kind, source_key, occurred_at, data, original, revisions, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      scope,
      profileId,
      record.kind,
      record.sourceKey || null,
      record.occurredAt,
      JSON.stringify(record.data),
      JSON.stringify(original),
      JSON.stringify(record.revisions || []),
      record.revision || 1,
    );
    return decodeRecord(db.prepare('SELECT * FROM fan_records WHERE scope = ? AND id = ?').get(scope, id));
  }

  function update(scope, profileId, record, changedAt, source = 'manual') {
    const previous = decodeRecord(
      db
        .prepare('SELECT * FROM fan_records WHERE scope = ? AND profile_id = ? AND id = ?')
        .get(scope, profileId, record.id),
    );
    if (!previous) throw new Error('记录不存在。');
    if (previous.revision !== record.revision) throw new Error('记录已更新，请重新打开后核对修改。');
    const revisions = [
      ...previous.revisions,
      {
        changedAt,
        source,
        before: { data: previous.data, occurredAt: previous.occurredAt },
        after: { data: record.data, occurredAt: record.occurredAt },
      },
    ];
    db.prepare(
      `UPDATE fan_records SET data = ?, occurred_at = ?, revisions = ?, revision = revision + 1
      WHERE scope = ? AND profile_id = ? AND id = ?`,
    ).run(JSON.stringify(record.data), record.occurredAt, JSON.stringify(revisions), scope, profileId, record.id);
    return {
      ...previous,
      data: record.data,
      occurredAt: record.occurredAt,
      revisions,
      revision: previous.revision + 1,
    };
  }

  return {
    list,
    listForProfiles,
    insert,
    update,
    decodeRecord,
    bySource: (scope, key) =>
      decodeRecord(db.prepare('SELECT * FROM fan_records WHERE scope = ? AND source_key = ?').get(scope, key)),
  };
}

module.exports = { createFanRecordStore };
