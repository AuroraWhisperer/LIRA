'use strict';

const { getMigrationPlan } = require('../../src/storage/database-migrations');
const schema = require('../../src/storage/schema');

function migrateTestSongDb(db) {
  const { key, steps } = getMigrationPlan().find(plan => plan.name === 'songDb');
  db.exec(schema.SONG_TABLE_SCHEMA);
  // Historical fixtures replace this runner while building a pre-upgrade database.
  schema.runMigrations(db, key, steps);
  db.exec(schema.SONG_INDEX_SCHEMA);
}

module.exports = { migrateTestSongDb };
