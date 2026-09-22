'use strict';

const schema = require('./schema');
const { DYNAMIC_LOTTERY_SCHEMA } = require('./dynamic-lottery-schema');

function runDynamicLotteryMigrations(lotteryDb) {
  const result = schema.runMigrations(lotteryDb, 'lottery_db', [
    (db) => db.exec(DYNAMIC_LOTTERY_SCHEMA),
    (db) => db.exec('ALTER TABLE lottery_evidence ADD COLUMN display_name TEXT'),
  ]);
  if (result.applied > 0) {
    console.log(`[Schema] ${result.key}: v${result.from} → v${result.to} (${result.applied} step(s))`);
  }
  return result;
}

function getDynamicLotterySchemaVersion(lotteryDb) {
  return schema.getSchemaVersion(lotteryDb, 'lottery_db');
}

module.exports = {
  getDynamicLotterySchemaVersion,
  runDynamicLotteryMigrations,
};
