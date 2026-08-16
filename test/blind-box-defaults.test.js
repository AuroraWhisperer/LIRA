'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareSettingsBootstrap } = require('../src/server/settings-bootstrap');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const settingsStoreModule = require('../src/storage/settings-store');
const {
  DEFAULT_SETTINGS,
  migrateBlindBoxConfig
} = settingsStoreModule;

const ROOT_DIR = path.join(__dirname, '..');

const qixiOutputs = [
  ['宸星定情', 1200],
  ['星河相拥', 500],
  ['云桥缘续', 66],
  ['鹊语相思', 26],
  ['锦书传意', 19],
  ['月下牵丝', 5]
];

test('default blind-box config keeps 七夕鹊匣 as the fourth box', () => {
  const config = JSON.parse(DEFAULT_SETTINGS.giftBlindBoxConfig);
  assert.equal(config.length, 4);
  assert.equal(config[3].name, '七夕鹊匣');
  assert.equal(config[3].price, 25);
  assert.deepEqual(
    config[3].outputs.map(output => [output.name, output.price]),
    qixiOutputs
  );
});

test('blind-box migration appends missing defaults without replacing user entries', () => {
  const existing = [
    { name: '心动盲盒', price: 15, outputs: [] },
    { name: '幸运盲盒', price: 5, outputs: [] },
    { name: '小熊虫盲盒', price: 9, outputs: [] },
    { name: '用户自定义盲盒', price: 88, outputs: [{ name: '自定义礼物', price: 188 }] }
  ];
  const updates = [];
  const db = {
    prepare(sql) {
      if (sql.includes('SELECT value FROM settings')) {
        return { get: () => ({ value: JSON.stringify(existing) }) };
      }
      if (sql.includes('UPDATE settings SET value')) {
        return { run: (value, updatedAt) => updates.push({ value, updatedAt }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };

  migrateBlindBoxConfig(db);

  assert.equal(updates.length, 1);
  const migrated = JSON.parse(updates[0].value);
  assert.deepEqual(migrated.slice(0, existing.length), existing);
  assert.equal(migrated.filter(box => box.name === '七夕鹊匣').length, 1);
  assert.equal(migrated[existing.length].price, 25);
});

test('settings bootstrap merges new blind-box defaults before the first settings read', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-blind-box-bootstrap-'));
  const databases = createDatabases({ dataDir, defaultSettings: DEFAULT_SETTINGS });
  const existing = [
    { name: '心动盲盒', price: 12, outputs: [{ name: '用户修改礼物', price: 99 }] },
    { name: '用户自定义盲盒', price: 88, outputs: [{ name: '自定义礼物', price: 188 }] }
  ];

  try {
    databases.songDb.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('giftBlindBoxConfig', ?, ?)
    `).run(JSON.stringify(existing), new Date().toISOString());

    const { settingsStore } = prepareSettingsBootstrap(databases.songDb, settingsStoreModule);
    const migrated = JSON.parse(settingsStore.getSettings().giftBlindBoxConfig);

    assert.deepEqual(migrated.slice(0, existing.length), existing);
    assert.deepEqual(
      migrated.slice(existing.length).map(box => box.name),
      ['幸运盲盒', '小熊虫盲盒', '七夕鹊匣']
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('blind-box migration does not duplicate an existing 七夕鹊匣 entry', () => {
  const existing = JSON.parse(DEFAULT_SETTINGS.giftBlindBoxConfig);
  const updates = [];
  const db = {
    prepare(sql) {
      if (sql.includes('SELECT value FROM settings')) {
        return { get: () => ({ value: JSON.stringify(existing) }) };
      }
      if (sql.includes('UPDATE settings SET value')) {
        return { run: () => updates.push(true) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };

  migrateBlindBoxConfig(db);

  assert.equal(updates.length, 0);
});

test('七夕鹊匣 artwork uses RMB value folders', () => {
  const expectedPaths = new Map([
    [35786, ['blind-box/35786.webp', 25]],
    [35787, ['0000-under-0100/35787.webp', 5]],
    [35788, ['0000-under-0100/35788.webp', 19]],
    [35789, ['0000-under-0100/35789.webp', 26]],
    [35790, ['0000-under-0100/35790.webp', 66]],
    [35791, ['0500-0600/35791.webp', 500]],
    [35792, ['1200-1300/35792.webp', 1200]]
  ]);
  const giftRoot = path.join(ROOT_DIR, 'public', 'img', 'bilibili-gifts');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'img', 'bilibili-gifts.json'), 'utf8'));

  assert.equal(fs.existsSync(path.join(giftRoot, 'qixi-que-box')), false);
  for (const [id, [relativePath, rmb]] of expectedPaths) {
    assert.equal(fs.existsSync(path.join(giftRoot, relativePath)), true, `${id} artwork should exist`);
    const gift = manifest.gifts.find(item => item.id === id);
    assert.equal(gift?.image, `bilibili-gifts/${relativePath}`);
    assert.equal(gift?.rmb, rmb);
  }
});
