'use strict';

const { getMigrationPlan } = require('../../src/storage/database-migrations');
const { SONG_TABLE_SCHEMA, SONG_INDEX_SCHEMA, runMigrations } = require('../../src/storage/schema');

function migrateTestSongDb(db) {
  const { key, steps } = getMigrationPlan().find(plan => plan.name === 'songDb');
  db.exec(SONG_TABLE_SCHEMA);
  runMigrations(db, key, steps);
  db.exec(SONG_INDEX_SCHEMA);
}

module.exports = { migrateTestSongDb };
