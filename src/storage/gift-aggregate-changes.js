'use strict';

const { randomUUID } = require('node:crypto');

const trackers = new WeakMap();
const eligibilityFields = ['status', 'detection_status', 'gift_stats_eligible'];
const eligible = (row) => `${row}.status = 'active' AND ${row}.detection_status = 'final'
  AND ${row}.gift_stats_eligible = 1`;
const inputs = [
  {
    table: 'gift_events', domain: 'sprint',
    eligible: (row) => `${eligible(row)} AND ${row}.counted_in_sprint = 1`,
    fields: [...eligibilityFields, 'counted_in_sprint', 'source_id', 'total_price'],
  },
  {
    table: 'gift_events', domain: 'blindBox',
    eligible: (row) => `${row}.detection_status = 'final' AND ${row}.is_blind_box = 1 AND (
      (${row}.source_id IS NULL AND ${row}.status = 'active' AND ${row}.gift_stats_eligible = 1)
      OR (${row}.source_id IS NOT NULL AND ${row}.status IN ('active','retention-staged')))`,
    fields: [...eligibilityFields, 'is_blind_box', 'source_id', 'id', 'gift_id', 'gift_name',
      'user_name', 'uid', 'blind_box_id', 'blind_box_name', 'blind_box_price',
      'total_price', 'blind_profit', 'num', 'created_at'],
  },
  { table: 'gift_sprint_carry', domain: 'sprint' },
  { table: 'gift_local_archives', domain: 'blindBox' },
  { table: 'gift_retention_state', domain: 'blindBox', fields: ['active_snapshot_id'] },
];

function createGiftAggregateChanges(db) {
  if (trackers.has(db)) return trackers.get(db);
  const instance = randomUUID();
  let initialized = false;

  function initialize() {
    if (initialized) return;
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS lira_gift_aggregate_revision (
        sprint INTEGER NOT NULL, blindBox INTEGER NOT NULL);
      INSERT INTO lira_gift_aggregate_revision SELECT 0, 0
        WHERE NOT EXISTS (SELECT 1 FROM lira_gift_aggregate_revision);`);
    for (const input of inputs) {
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        const before = input.eligible?.('OLD') || '1';
        const after = input.eligible?.('NEW') || '1';
        const changed = input.fields?.map((field) => `OLD.${field} IS NOT NEW.${field}`).join(' OR ') || '1';
        const condition = operation === 'UPDATE' ? `((${before}) OR (${after})) AND (${changed})`
          : operation === 'INSERT' ? after : before;
        db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS lira_${input.table}_${input.domain}_${operation}
          AFTER ${operation} ON main.${input.table} WHEN ${condition} BEGIN
            UPDATE lira_gift_aggregate_revision SET ${input.domain} = ${input.domain} + 1;
          END`);
      }
    }
    initialized = true;
  }

  function read(domain) {
    // Installing or caching inside a transaction could outlive its rollback.
    if (db.isTransaction) return null;
    initialize();
    const revision = db.prepare('SELECT sprint, blindBox FROM temp.lira_gift_aggregate_revision').get();
    // TEMP triggers observe this connection; other connections do not run them.
    const version = db.prepare('PRAGMA data_version').get().data_version;
    const value = domain ? revision[domain] : `${revision.sprint}:${revision.blindBox}`;
    return `${instance}:${value}:${version}`;
  }

  const tracker = { read };
  trackers.set(db, tracker);
  return tracker;
}

module.exports = { createGiftAggregateChanges };
