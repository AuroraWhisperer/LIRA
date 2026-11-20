'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { songIdentity, summarizeSongs, SONG_STATS_DAYS } = require('../fans/song-summary');
const { dayOf, addDays } = require('../fans/dates');
const { compactRosterObservation, pruneRosterTemplates, rosterTransaction } = require('./fan-roster-observation-storage');

function decodeData(row) {
  if (row.roster_template_id) return { ...JSON.parse(row.roster_data), observedAt: row.occurred_at };
  const data = JSON.parse(row.data);
  // SQLite 3.54 could persist the aggregate as JSON text on the old retention path.
  if (row.kind === 'song' && typeof data.dailyCounts === 'string') data.dailyCounts = JSON.parse(data.dailyCounts);
  return data;
}

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
        data: decodeData(row),
        original: row.roster_template_id ? { ...JSON.parse(row.roster_original), observedAt: row.occurred_at } : JSON.parse(row.original),
        revisions: JSON.parse(row.revisions),
        revision: row.revision,
      }
    : null;
}

function decodeProjectionInput(row) {
  if (row.roster_template_id && (!row.roster_data || !row.roster_original))
    throw new Error('大航海名单原始依据缺失。');
  return {
    id: row.id,
    profileId: row.profile_id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    data: decodeData(row),
    original: row.roster_template_id ? { ...JSON.parse(row.roster_original), observedAt: row.occurred_at } : JSON.parse(row.original),
  };
}

function createFanRecordStore(db) {
  // v13's song migration also uses this store before the v14 template table exists.
  const hasRosterTemplates = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fan_roster_templates'").get());
  const selectRecords = hasRosterTemplates
    ? `SELECT r.*, t.data AS roster_data, t.original AS roster_original FROM fan_records r
        LEFT JOIN fan_roster_templates t ON t.id = r.roster_template_id AND t.scope = r.scope`
    : 'SELECT r.* FROM fan_records r';
  // Projection consumers need interaction dates and reminder/roster evidence,
  // not note bodies, song-count buckets or the full edit history.
  const selectProjectionInputs = `SELECT r.id, r.profile_id, r.kind, r.occurred_at,
    CASE WHEN r.kind IN ('membership', 'anniversary', 'followup', 'caution') THEN r.data ELSE '{}' END AS data,
    json_remove(r.original, '$.body') AS original
    ${hasRosterTemplates ? ', r.roster_template_id, t.data AS roster_data, t.original AS roster_original' : ''}
    FROM fan_records r
    ${hasRosterTemplates ? 'LEFT JOIN fan_roster_templates t ON t.id = r.roster_template_id AND t.scope = r.scope' : ''}`;
  function list(scope, profileId) {
    return db
      .prepare(`${selectRecords} WHERE r.scope = ? AND r.profile_id = ? ORDER BY r.occurred_at DESC, r.id`)
      .all(scope, profileId)
      .map(decodeRecord);
  }

  function readForProfiles(scope, profileIds, select, decode, beforeByProfile) {
    const grouped = new Map();
    for (let offset = 0; offset < profileIds.length; offset += 500) {
      const batch = profileIds.slice(offset, offset + 500);
      let filter = `r.profile_id IN (${batch.map(() => '?').join(', ')})`;
      let params = batch;
      if (hasRosterTemplates && beforeByProfile) {
        // Only pristine automatic observations share a template. Before the earliest
        // time the projection can ask about, its latest sample covers the earlier ones.
        // Read all rows tied at a retained time in the original order. Legacy timestamps
        // that do not round-trip as UTC remain individual samples. CROSS JOIN drives
        // the (scope, profile_id) index from the selected profiles.
        filter += ` AND (r.roster_template_id IS NULL OR (r.profile_id, r.occurred_at) IN (
          WITH bounds(profile_id, cutoff) AS (VALUES ${batch.map(() => '(?, ?)').join(', ')})
          SELECT f.profile_id, MAX(f.occurred_at) FROM bounds b
          CROSS JOIN fan_records f ON f.scope = ? AND f.profile_id = b.profile_id
          WHERE f.roster_template_id IS NOT NULL
          GROUP BY f.profile_id, f.roster_template_id, CASE WHEN f.occurred_at < b.cutoff
            AND f.occurred_at = strftime('%Y-%m-%dT%H:%M:%fZ', f.occurred_at, '+0 seconds')
            THEN NULL ELSE f.rowid END))`;
        params = [...batch, ...batch.flatMap(id => [id, beforeByProfile.get(id)]), scope];
      }
      const rows = db.prepare(`${select} WHERE r.scope = ? AND ${filter}
        ORDER BY r.profile_id, r.occurred_at DESC, r.id`).all(scope, ...params);
      for (const row of rows) {
        if (!grouped.has(row.profile_id)) grouped.set(row.profile_id, []);
        grouped.get(row.profile_id).push(decode(row));
      }
    }
    return grouped;
  }

  // Also constructed by maintenance on databases without fan tables. Prepare on first write.
  let insertRecord;
  let recordById;
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
      insertRecord ??= db.prepare(`INSERT INTO fan_records
        (id, scope, profile_id, kind, source_key, occurred_at, data, original, revisions, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insertRecord.run(
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
      recordById ??= db.prepare(`${selectRecords} WHERE r.scope = ? AND r.id = ?`);
      return decodeRecord(recordById.get(scope, id));
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
    const start = addDays(dayOf(at), 1 - SONG_STATS_DAYS);
    db.prepare(`UPDATE fan_records SET data = json_set(data, '$.dailyCounts', json((
        SELECT json_group_array(json(bucket.value) ORDER BY bucket.key) FROM json_each(data ->> '$.dailyCounts') bucket
        WHERE bucket.value ->> '$.date' >= ?
      ))) WHERE kind = 'song'
      ${scope === undefined ? '' : 'AND scope = ?'} ${profileId === undefined ? '' : 'AND profile_id = ?'}
      AND CASE json_type(data, '$.dailyCounts')
        WHEN 'array' THEN EXISTS (SELECT 1 FROM json_each(data, '$.dailyCounts') bucket WHERE bucket.value ->> '$.date' < ?)
        WHEN 'text' THEN CASE WHEN json_valid(data ->> '$.dailyCounts') THEN json_type(data ->> '$.dailyCounts') = 'array' END
      END`)
      .run(start, ...[scope, profileId].filter((value) => value !== undefined), start);
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
    listForProfiles: (scope, ids) => readForProfiles(scope, ids, selectRecords, decodeRecord),
    listProjectionInputs: (scope, ids, beforeByProfile) =>
      readForProfiles(scope, ids, selectProjectionInputs, decodeProjectionInput, beforeByProfile),
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
