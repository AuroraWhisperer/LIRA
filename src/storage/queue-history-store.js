'use strict';

const RANDOM_SOURCES = "(source = 'random' OR source LIKE 'random:%')";
const IDENTIFIED_REQUESTER = "(TRIM(requester_uid) <> '' OR TRIM(requester_name) <> '')";
const RECENT_ORDER = 'datetime(created_at) DESC, request_id DESC';

function trimRandomHistory(songDb) {
  // Anonymous requests must not discard the last usable mention target: at most 11 rows remain.
  songDb.exec(`DELETE FROM random_request_history
    WHERE request_id NOT IN (
      SELECT request_id FROM random_request_history ORDER BY ${RECENT_ORDER} LIMIT 10
    ) AND request_id NOT IN (
      SELECT request_id FROM random_request_history
      WHERE ${IDENTIFIED_REQUESTER} ORDER BY ${RECENT_ORDER} LIMIT 1
    )`);
}

function migrateQueueHistory(songDb) {
  songDb.exec(`CREATE TABLE IF NOT EXISTS random_request_history (
    request_id INTEGER PRIMARY KEY,
    song_name TEXT NOT NULL,
    requester_uid TEXT NOT NULL DEFAULT '',
    requester_name TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  songDb.exec(`INSERT OR IGNORE INTO random_request_history
    (request_id, song_name, requester_uid, requester_name, source, created_at)
    SELECT id, song_name, requester_uid, requester_name, source, created_at FROM requests
    WHERE id IN (
      SELECT id FROM requests WHERE ${RANDOM_SOURCES}
      ORDER BY datetime(created_at) DESC, id DESC LIMIT 10
    ) OR id IN (
      SELECT id FROM requests WHERE ${RANDOM_SOURCES} AND ${IDENTIFIED_REQUESTER}
      ORDER BY datetime(created_at) DESC, id DESC LIMIT 1
    )`);
  trimRandomHistory(songDb);
  songDb.exec(`DELETE FROM requests WHERE NOT EXISTS (
    SELECT 1 FROM queue WHERE queue.id = requests.queue_id AND queue.status IN ('current', 'waiting')
  )`);
  songDb.exec("DELETE FROM queue WHERE status NOT IN ('current', 'waiting')");
}

function rememberRandomRequest(songDb, requestId, input) {
  if (!/^random(?::|$)/i.test(input.source)) return;
  songDb.prepare(`INSERT INTO random_request_history
    (request_id, song_name, requester_uid, requester_name, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    requestId, input.songName, input.requesterUid, input.requesterName, input.source, input.createdAt,
  );
  trimRandomHistory(songDb);
}

module.exports = { migrateQueueHistory, rememberRandomRequest };
