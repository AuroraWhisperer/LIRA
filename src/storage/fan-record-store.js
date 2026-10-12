'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { songIdentity, summarizeSongs, recentSongCounts } = require('../fans/song-summary');
const { compactRosterObservation, pruneRosterTemplates, rosterTransaction } = require('./fan-roster-observation-storage');

function decodeRecord(row) {
  if (row?.roster_template_id && (!row.roster_data || !row.roster_original))
    throw new Error('大航海名单原始依据缺失。');
  return row
    ? {
        id: row.id,
        profileId: row.profile_id,
        kind: row.kind,
        sourceKey: row.source_key,
        occurredAt: row.occurred_at,
        data: row.roster_template_id ? { ...JSON.parse(row.roster_data), observedAt: row.occurred_at } : JSON.parse(row.data),
        original: row.roster_template_id ? { ...JSON.parse(row.roster_original), observedAt: row.occurred_at } : JSON.parse(row.original),
        revisions: JSON.parse(row.revisions),
        revision: row.revision,
      }
    : null;
}

function createFanRecordStore(db) {
  // v13's song migration also uses this store before the v14 template table exists.
  const hasRosterTemplates = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fan_roster_templates'").get());
  const selectRecords = hasRosterTemplates
    ? `SELECT r.*, t.data AS roster_data, t.original AS roster_original FROM fan_records r
        LEFT JOIN fan_roster_templates t ON t.id = r.roster_template_id AND t.scope = r.scope`
    : 'SELECT r.* FROM fan_records r';
  function list(scope, profileId) {
    return db
      .prepare(`${selectRecords} WHERE r.scope = ? AND r.profile_id = ? ORDER BY r.occurred_at DESC, r.id`)
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
        ${selectRecords} WHERE r.scope = ?
          AND r.profile_id IN (${batch.map(() => '?').join(', ')})
        ORDER BY r.profile_id, r.occurred_at DESC, r.id
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

  function insert(scope, profileId, record, at = new Date().toISOString()) {
    if (record.kind === 'song') return addSong(scope, profileId, record, at);
    if (record.sourceKey) {
      const existing = db
        .prepare(`${selectRecords} WHERE r.scope = ? AND r.source_key = ?`)
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
    const write = () => {
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
      if (hasRosterTemplates) compactRosterObservation(db, scope, {
        ...record, id, original, revisions: record.revisions || [], revision: record.revision || 1,
      });
      return decodeRecord(db.prepare(`${selectRecords} WHERE r.scope = ? AND r.id = ?`).get(scope, id));
    };
    return hasRosterTemplates ? rosterTransaction(db, write) : write();
  }

  function addSong(scope, profileId, record, at) {
    const sourceKey = `song:${profileId}:${createHash('sha256').update(songIdentity(record.data)).digest('hex')}`;
    const previous = decodeRecord(db.prepare('SELECT * FROM fan_records WHERE scope = ? AND source_key = ?').get(scope, sourceKey));
    const summary = summarizeSongs(previous ? [previous, record] : [record], at)[0];
    const id = previous?.id || record.id || randomUUID();
    db.prepare(`INSERT INTO fan_records
      (id, scope, profile_id, kind, source_key, occurred_at, data, original, revisions, revision)
      VALUES (?, ?, ?, 'song', ?, ?, ?, '{}', '[]', 1)
      ON CONFLICT(scope, source_key) DO UPDATE SET occurred_at=excluded.occurred_at,
        data=excluded.data, original='{}', revisions='[]', revision=fan_records.revision+1`)
      .run(id, scope, profileId, sourceKey, summary.occurredAt, JSON.stringify(summary.data));
    return decodeRecord(db.prepare('SELECT * FROM fan_records WHERE scope = ? AND id = ?').get(scope, id));
  }

  function pruneSongCounts(at, scope, profileId) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fan_records'").get()) return;
    const rows = db.prepare(`SELECT id, data FROM fan_records WHERE kind = 'song'
      ${scope === undefined ? '' : 'AND scope = ?'} ${profileId === undefined ? '' : 'AND profile_id = ?'}`)
      .all(...[scope, profileId].filter((value) => value !== undefined));
    const update = db.prepare('UPDATE fan_records SET data = ? WHERE id = ?');
    for (const row of rows) {
      const data = JSON.parse(row.data);
      const counts = recentSongCounts(data.dailyCounts, at, true);
      if (counts.length !== data.dailyCounts.length) update.run(JSON.stringify({ ...data, dailyCounts: counts }), row.id);
    }
  }

  function update(scope, profileId, record, changedAt, source = 'manual') {
    if (record.kind === 'song') throw new Error('点歌已合并为汇总，不再保存或编辑逐次记录。');
    const previous = decodeRecord(
      db
        .prepare(`${selectRecords} WHERE r.scope = ? AND r.profile_id = ? AND r.id = ?`)
        .get(scope, profileId, record.id),
    );
    if (!previous) throw new Error('记录不存在。');
    if (previous.revision !== record.revision) throw new Error('记录已更新，请重新打开后核对修改。');
    if (previous.occurredAt === record.occurredAt && isDeepStrictEqual(previous.data, record.data)) return previous;
    const revisions = [
      ...previous.revisions,
      {
        changedAt,
        source,
        before: { data: previous.data, occurredAt: previous.occurredAt },
        after: { data: record.data, occurredAt: record.occurredAt },
      },
    ];
    const write = () => {
      db.prepare(
        `UPDATE fan_records SET data = ?, occurred_at = ?, revisions = ?, revision = revision + 1
        ${hasRosterTemplates ? ', original = ?, roster_template_id = NULL' : ''}
        WHERE scope = ? AND profile_id = ? AND id = ?`,
      ).run(JSON.stringify(record.data), record.occurredAt, JSON.stringify(revisions),
        ...(hasRosterTemplates ? [JSON.stringify(previous.original)] : []), scope, profileId, record.id);
      if (hasRosterTemplates) pruneRosterTemplates(db, scope);
    };
    if (hasRosterTemplates) rosterTransaction(db, write);
    else write();
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
    pruneSongCounts,
    pruneRosterTemplates: (scope) => { if (hasRosterTemplates) pruneRosterTemplates(db, scope); },
    decodeRecord,
    bySource: (scope, key) =>
      decodeRecord(db.prepare(`${selectRecords} WHERE r.scope = ? AND r.source_key = ?`).get(scope, key)),
  };
}

module.exports = { createFanRecordStore };
