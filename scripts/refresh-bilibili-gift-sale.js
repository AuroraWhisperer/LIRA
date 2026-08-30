'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  createGiftSaleCatalogService,
} = require('../src/bilibili/gift/sale-catalog');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');

const ROOT_DIR = path.resolve(__dirname, '..');

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const dataDir = path.resolve(options.dataDir || path.join(ROOT_DIR, 'data'));
  const roomId = options.roomId || readConfiguredRoomId(dataDir);
  const blindBoxConfig = readConfiguredBlindBoxConfig(dataDir);
  const service = createGiftSaleCatalogService({
    dataDir,
    publicDir: path.join(ROOT_DIR, 'public'),
    getRoomId: () => roomId,
    getBlindBoxConfig: () => blindBoxConfig,
    minRefreshMs: 0,
  });
  const snapshot = await service.refresh();
  console.log(
    `已刷新直播间 ${snapshot.roomId}：当前在售 ${snapshot.count} 个礼物。`,
  );
}

function readConfiguredBlindBoxConfig(dataDir) {
  const databasePath = path.join(dataDir, 'song-request-data.db');
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    return String(
      database
        .prepare("SELECT value FROM settings WHERE key = 'giftBlindBoxConfig'")
        .get()?.value || DEFAULT_SETTINGS.giftBlindBoxConfig,
    );
  } catch (_) {
    return DEFAULT_SETTINGS.giftBlindBoxConfig;
  } finally {
    database?.close();
  }
}

function parseArguments(args) {
  const result = { roomId: '', dataDir: '' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--room-id') {
      result.roomId = String(args[++index] || '').trim();
      continue;
    }
    if (argument === '--data-dir') {
      result.dataDir = String(args[++index] || '').trim();
      continue;
    }
    throw new Error(`不支持的参数：${argument}`);
  }
  return result;
}

function readConfiguredRoomId(dataDir) {
  const databasePath = path.join(dataDir, 'song-request-data.db');
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    return String(
      database.prepare("SELECT value FROM settings WHERE key = 'roomId'").get()
        ?.value || '',
    ).trim();
  } catch (error) {
    throw new Error(`无法读取已配置的直播间号：${error.message || error}`);
  } finally {
    database?.close();
  }
}

main().catch((error) => {
  console.error(`刷新在售礼物失败：${error.message || error}`);
  process.exitCode = 1;
});
