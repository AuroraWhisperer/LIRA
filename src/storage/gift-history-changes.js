'use strict';

const { createHash, randomUUID } = require('node:crypto');

const MAX_CHANGES = 1000;
const MAX_REVISIONS = 64;

// Connection-local, transactional history of changed row identities. Missing
// history is always a reason to read the ordinary complete result again.
function createGiftHistoryChanges(db) {
  const instance = randomUUID();
  const snapshots = new Map();
  let initialized = false;

  function initialize() {
    if (initialized || db.isTransaction) return;
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS lira_gift_history_revision (
        revision INTEGER NOT NULL, reset_revision INTEGER NOT NULL);
      INSERT INTO lira_gift_history_revision SELECT 0, 0
        WHERE NOT EXISTS (SELECT 1 FROM lira_gift_history_revision);
      CREATE TEMP TABLE IF NOT EXISTS lira_gift_history_changes (
        row_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS temp.lira_gift_history_changes_revision
        ON lira_gift_history_changes(revision);`);
    const record = (row) => `
      UPDATE lira_gift_history_revision SET revision = revision + 1;
      INSERT INTO lira_gift_history_changes(row_id, revision)
        SELECT ${row}, revision FROM lira_gift_history_revision WHERE true
        ON CONFLICT(row_id) DO UPDATE SET revision = excluded.revision;
      DELETE FROM lira_gift_history_changes WHERE revision <=
        (SELECT revision - ${MAX_CHANGES} FROM lira_gift_history_revision);`;
    for (const operation of ['INSERT', 'UPDATE']) {
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS lira_gift_history_${operation}
        AFTER ${operation} ON main.gift_events BEGIN
          ${record('NEW.id')}
          ${operation === 'UPDATE' ? `UPDATE lira_gift_history_revision SET reset_revision = revision
            WHERE OLD.id IS NOT NEW.id OR OLD.source_id IS NOT NEW.source_id
              OR OLD.platform_id IS NOT NEW.platform_id;` : ''}
        END`);
    }
    db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS lira_gift_history_DELETE
      AFTER DELETE ON main.gift_events BEGIN
        UPDATE lira_gift_history_revision SET revision = revision + 1, reset_revision = revision + 1;
      END`);
    for (const operation of ['INSERT', 'DELETE']) {
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS lira_gift_history_member_${operation}
        AFTER ${operation} ON main.gift_retention_members BEGIN
          ${record(`${operation === 'INSERT' ? 'NEW' : 'OLD'}.event_id`)}
        END`);
    }
    db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS lira_gift_history_member_UPDATE
      AFTER UPDATE ON main.gift_retention_members BEGIN
        UPDATE lira_gift_history_revision SET revision = revision + 1, reset_revision = revision + 1;
      END`);
    initialized = true;
  }

  function read(options, { dataVersion, schemaVersion, retention, boundary }) {
    const { revision, reset_revision: resetRevision } = db.prepare('SELECT * FROM temp.lira_gift_history_revision').get();
    const upper = options.rangeEnd && options.rangeEnd < options.asOf ? options.rangeEnd : options.asOf;
    const scope = JSON.stringify([
      dataVersion, schemaVersion, options.sourceId, options.viewRevision,
      // rangeEnd is clipped to asOf by the query owner. Bind the requested end
      // date instead; advancing time is handled by boundary/upper separately.
      options.query, options.rangeStart, options.endDate,
      options.userQuery, options.giftQuery, options.amountAbove, options.sortField, options.sortDirection,
      retention?.id, retention?.member_snapshot_id, retention?.detail_start,
    ]);
    const contentRevision = createHash('sha256').update(JSON.stringify([instance, scope, revision, boundary])).digest('hex');
    return { contentRevision, scope, revision, resetRevision, upper };
  }

  function base(contentRevision, current) {
    const previous = snapshots.get(contentRevision);
    if (!previous || previous.scope !== current.scope || previous.upper > current.upper ||
        previous.revision < current.resetRevision || previous.revision > current.revision ||
        current.revision - previous.revision > MAX_CHANGES) return null;
    return previous;
  }

  function changedIds(previous, limit) {
    return db.prepare('SELECT row_id FROM temp.lira_gift_history_changes WHERE revision > ? LIMIT ?')
      .all(previous.revision, limit).map((row) => row.row_id);
  }

  function remember(current) {
    snapshots.delete(current.contentRevision);
    snapshots.set(current.contentRevision, current);
    if (snapshots.size > MAX_REVISIONS) snapshots.delete(snapshots.keys().next().value);
  }

  return { initialize, read, base, changedIds, remember };
}

module.exports = { createGiftHistoryChanges };
