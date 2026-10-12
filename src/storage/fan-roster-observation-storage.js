'use strict';

const { createHash } = require('node:crypto');

function rosterTemplate(record) {
  const { data, original } = record;
  if (record.kind !== 'membership' || record.revision !== 1 || record.revisions.length ||
      data.type !== 'observation' || data.status !== 'observed' || data.decision !== 'adopted' || data.excluded ||
      original.source !== 'platform' || original.evidence !== 'guard-roster' ||
      data.reason !== `自动同步房间 ${original.roomId} 的大航海名单；仅确认同步时的等级，起止日期待补充。` ||
      record.occurredAt !== data.observedAt || data.observedAt !== original.observedAt ||
      record.sourceKey !== `guard-roster:${original.roomId}:${original.identity?.value}:${record.occurredAt}:${data.level}:${original.medalLevel ?? ''}` ||
      Object.keys(data).some((key) => JSON.stringify(data[key]) !== JSON.stringify(original[key]))) return null;
  const { observedAt: dataTime, ...sharedData } = data;
  const { observedAt: originalTime, ...sharedOriginal } = original;
  return { data: sharedData, original: sharedOriginal };
}

// The caller owns the transaction. Each discrete time, ID and source key stays
// in fan_records; only identical, unedited automatic evidence is shared.
function compactRosterObservation(db, scope, record) {
  const template = rosterTemplate(record);
  if (!template) return false;
  const data = JSON.stringify(template.data);
  const original = JSON.stringify(template.original);
  const id = createHash('sha256').update(JSON.stringify([scope, data, original])).digest('hex');
  db.prepare('INSERT OR IGNORE INTO fan_roster_templates (id, scope, data, original) VALUES (?, ?, ?, ?)')
    .run(id, scope, data, original);
  db.prepare("UPDATE fan_records SET data = '{}', original = '{}', roster_template_id = ? WHERE scope = ? AND id = ?")
    .run(id, scope, record.id);
  return true;
}

function pruneRosterTemplates(db, scope) {
  db.prepare(`DELETE FROM fan_roster_templates WHERE scope = ? AND NOT EXISTS (
    SELECT 1 FROM fan_records WHERE roster_template_id = fan_roster_templates.id
  )`).run(scope);
}

function rosterTransaction(db, work) {
  db.exec('SAVEPOINT fan_roster_storage');
  try {
    const result = work();
    db.exec('RELEASE fan_roster_storage');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO fan_roster_storage');
    db.exec('RELEASE fan_roster_storage');
    throw error;
  }
}

module.exports = { compactRosterObservation, pruneRosterTemplates, rosterTransaction };
