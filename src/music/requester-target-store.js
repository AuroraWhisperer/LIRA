'use strict';

const { cleanText } = require('../shared/utils');

function createRequesterTargetStore(songDb) {
  return {
    getLatestRandomRequester() {
      const row = songDb.prepare(`
        SELECT requester_uid, requester_name, source, created_at
        FROM requests
        WHERE (source = 'random' OR source LIKE 'random:%')
          AND (TRIM(requester_uid) <> '' OR TRIM(requester_name) <> '')
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
      `).get();
      if (!row) return null;
      return {
        uid: cleanText(row.requester_uid),
        name: cleanText(row.requester_name),
        source: cleanText(row.source),
        createdAt: cleanText(row.created_at)
      };
    }
  };
}

module.exports = { createRequesterTargetStore };
