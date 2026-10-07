'use strict';

const { DatabaseSync } = require('node:sqlite');
const { runDynamicLotteryMigrations } = require('../../src/storage/dynamic-lottery-migrations');

// A migrated lottery database with enforced foreign keys, as the runtime opens it.
function openLotteryDatabase(filePath = ':memory:') {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON');
  runDynamicLotteryMigrations(db);
  return db;
}

// One top-level comment record in the provider page shape.
function commentRecord(recordId, uid, overrides = {}) {
  return { source: 'comment', recordId, uid, occurredAtMs: 900, text: '参加抽奖', parentId: null, level: null, ...overrides };
}

module.exports = { commentRecord, openLotteryDatabase };
