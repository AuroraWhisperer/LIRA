'use strict';

const { createDatabases } = require('../../src/storage/database');
const schema = require('../../src/storage/schema');

// Build the historical schema instead of relabeling a fully migrated database.
function createLegacyDatabases(t, options, songVersion) {
  const migrate = schema.runMigrations;
  const legacy = t.mock.method(schema, 'runMigrations', (db, key, steps) =>
    migrate(db, key, key === 'song_db' ? steps.slice(0, songVersion) : steps));
  try {
    return createDatabases(options);
  } finally {
    legacy.mock.restore();
  }
}

module.exports = { createLegacyDatabases };
