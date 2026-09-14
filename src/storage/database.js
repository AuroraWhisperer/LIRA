// 编写人：Aurora
// 数据库创建、迁移注册、清空操作。
// 通过 createDatabases({ dataDir }) 显式初始化，不自动创建连接。
// DDL 在 schema.js，各表读写在同目录的 *-store.js。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const schema = require('./schema');
const databaseMigrations = require('./database-migrations');
const dynamicLotteryMigrations = require('./dynamic-lottery-migrations');
const databaseMaintenance = require('./database-maintenance');

const DB_FILE_NAMES = {
  songDb: 'song-request-data.db',
  superChatDb: 'super-chat-data.db',
  giftDb: 'gift-data.db',
  musicDb: 'music-data.db',
  checkinDb: 'checkin-data.db',
  lotteryDb: 'lottery-data.db',
};

// ── 工厂函数：创建并初始化所有数据库 ──

function createDatabases(options = {}) {
  const dataDir = String(options.dataDir || '');
  if (!dataDir) throw new Error('dataDir is required to create databases.');

  fs.mkdirSync(dataDir, { recursive: true });
  const databases = {};

  try {
    databases.songDb = openSqliteDatabase(
      path.join(dataDir, DB_FILE_NAMES.songDb),
      { foreignKeys: true },
    );
    databases.superChatDb = openSqliteDatabase(
      path.join(dataDir, DB_FILE_NAMES.superChatDb),
    );
    databases.giftDb = openSqliteDatabase(
      path.join(dataDir, DB_FILE_NAMES.giftDb),
      { foreignKeys: true },
    );
    databases.musicDb = openSqliteDatabase(
      path.join(dataDir, DB_FILE_NAMES.musicDb),
      { foreignKeys: true },
    );
    databases.checkinDb = openSqliteDatabase(
      path.join(dataDir, DB_FILE_NAMES.checkinDb),
    );

    // 依赖迁移列的索引必须在不可变迁移完成后创建。
    databases.songDb.exec(schema.SONG_TABLE_SCHEMA);
    databases.superChatDb.exec(schema.SUPER_CHAT_SCHEMA);
    databases.giftDb.exec(schema.GIFT_TABLE_SCHEMA);
    databases.musicDb.exec(schema.MUSIC_SCHEMA);
    databases.checkinDb.exec(schema.CHECKIN_SCHEMA);

    databaseMigrations.runAllMigrations(databases, options);
    databases.songDb.exec(schema.SONG_INDEX_SCHEMA);
    databases.giftDb.exec(schema.GIFT_INDEX_SCHEMA);
    databaseMigrations.migrateLegacySuperChatsToDedicatedDatabase(
      databases.songDb,
      databases.superChatDb,
    );

    databases.lotteryDb = createLotteryDatabase(dataDir);

    return databases;
  } catch (error) {
    databaseMaintenance.closeDatabases(databases);
    throw error;
  }
}

function createLotteryDatabase(dataDir) {
  let lotteryDb = null;
  try {
    lotteryDb = openSqliteDatabase(
      path.join(dataDir, DB_FILE_NAMES.lotteryDb),
      { foreignKeys: true },
    );
    dynamicLotteryMigrations.runDynamicLotteryMigrations(lotteryDb);
    return lotteryDb;
  } catch (error) {
    if (lotteryDb) databaseMaintenance.closeDatabases(lotteryDb);
    const reason =
      typeof error?.code === 'string' && error.code
        ? error.code
        : error?.name || 'initialization failed';
    console.warn(`[Startup] dynamic lottery database unavailable: ${reason}`);
    return null;
  }
}

function getSchemaVersions(databases) {
  const versions = databaseMigrations.getSchemaVersions(databases);
  if (databases.lotteryDb) {
    versions.lotteryDb =
      dynamicLotteryMigrations.getDynamicLotterySchemaVersion(
        databases.lotteryDb,
      );
  }
  return versions;
}

// ── 底层：打开单个数据库 ──

function openSqliteDatabase(filePath, options = {}) {
  const database = new DatabaseSync(filePath);
  const pragmas = [
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = NORMAL',
    'PRAGMA cache_size = -8000',
    'PRAGMA temp_store = MEMORY',
  ];
  if (options.foreignKeys === true) {
    pragmas.push('PRAGMA foreign_keys = ON');
  }
  try {
    database.exec(pragmas.map((p) => `${p};`).join('\n'));
    return database;
  } catch (error) {
    databaseMaintenance.closeDatabases(database);
    throw error;
  }
}

module.exports = {
  DB_FILE_NAMES,
  createDatabases,
  createLotteryDatabase,
  openSqliteDatabase,
  ...databaseMigrations,
  ...dynamicLotteryMigrations,
  getSchemaVersions,
  ...databaseMaintenance,
};
