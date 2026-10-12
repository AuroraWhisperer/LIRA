'use strict';

const { summarizeSongs } = require('../fans/song-summary');
const { createFanRecordStore } = require('./fan-record-store');
const { pruneFanRestoreSnapshots } = require('./fan-snapshot-retention');
const { migrateQueueHistory } = require('./queue-history-store');

function compactBackupSongs(backup, at) {
  return {
    ...backup,
    version: 2,
    profiles: backup.profiles.map((profile) => ({
      ...profile,
      records: [
        ...profile.records.filter((record) => record.kind !== 'song'),
        ...summarizeSongs(profile.records.filter((record) => record.kind === 'song'), at),
      ],
    })),
  };
}

// The migration runner owns one transaction for conversion and source cleanup.
function migrateFanSongRetention(db) {
  if (!db.prepare('PRAGMA table_info(requests)').all().some((column) => column.name === 'fan_recorded')) {
    db.exec('ALTER TABLE requests ADD COLUMN fan_recorded INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`UPDATE requests SET fan_recorded = 1 WHERE EXISTS (
    SELECT 1 FROM fan_records WHERE kind = 'song' AND source_key = 'request:' || requests.stable_id
      AND scope = requests.owner_scope
  )`);
  const at = new Date().toISOString();
  const store = createFanRecordStore(db);
  const profiles = db.prepare("SELECT DISTINCT scope, profile_id FROM fan_records WHERE kind = 'song'").all();
  const remove = db.prepare("DELETE FROM fan_records WHERE scope = ? AND profile_id = ? AND kind = 'song'");
  for (const profile of profiles) {
    const songs = store.list(profile.scope, profile.profile_id).filter((record) => record.kind === 'song');
    const summaries = summarizeSongs(songs, at);
    remove.run(profile.scope, profile.profile_id);
    for (const summary of summaries) store.insert(profile.scope, profile.profile_id, summary, at);
  }
  pruneFanRestoreSnapshots(db);
  const updateSnapshot = db.prepare('UPDATE fan_restore_snapshots SET data = ? WHERE id = ?');
  for (const snapshot of db.prepare('SELECT id, data FROM fan_restore_snapshots').all()) {
    updateSnapshot.run(JSON.stringify(compactBackupSongs(JSON.parse(snapshot.data), at)), snapshot.id);
  }
  migrateQueueHistory(db);
}

module.exports = { migrateFanSongRetention };
