'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  prepareSettingsBootstrap,
} = require('../src/server/settings-bootstrap');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const settingsStoreModule = require('../src/storage/settings-store');
const settingsRoutes = require('../src/server/routes/settings-routes');
const {
  normalizeGiftBlindBoxConfig,
} = require('../src/bilibili/gift/blind-box-config');
const defaultBlindBoxConfig = require('../src/storage/default-blind-box-config.json');
const { DEFAULT_SETTINGS, migrateBlindBoxConfig } = settingsStoreModule;

const ROOT_DIR = path.join(__dirname, '..');

const qixiOutputs = [
  ['宸星定情', 1200],
  ['星河相拥', 500],
  ['云桥缘续', 66],
  ['鹊语相思', 26],
  ['锦书传意', 19],
  ['月下牵丝', 5],
];

const bondOutputs = [
  ['暖心陪伴', 5],
  ['星光点点', 20],
  ['甜蜜契约', 35],
  ['守护之翼', 100],
  ['心电共鸣', 200],
  ['时光羁绊', 800],
  ['命运交响', 2888],
];

test('default blind-box config keeps 七夕鹊匣 fourth and adds 羁绊宝盒 fifth', () => {
  const config = JSON.parse(DEFAULT_SETTINGS.giftBlindBoxConfig);
  assert.deepEqual(config, defaultBlindBoxConfig);
  assert.equal(config.length, 5);
  assert.equal(config[3].name, '七夕鹊匣');
  assert.equal(config[3].price, 25);
  assert.deepEqual(
    config[3].outputs.map((output) => [output.name, output.price]),
    qixiOutputs,
  );
  assert.equal(config[4].name, '羁绊宝盒');
  assert.equal(config[4].price, 33);
  assert.deepEqual(
    config[4].outputs.map((output) => [output.name, output.price]),
    bondOutputs,
  );
});

test('blind-box migration appends missing defaults without replacing user entries', () => {
  const existing = [
    { name: '心动盲盒', price: 15, outputs: [] },
    { name: '幸运盲盒', price: 5, outputs: [] },
    { name: '小熊虫盲盒', price: 9, outputs: [] },
    {
      name: '用户自定义盲盒',
      price: 88,
      outputs: [{ name: '自定义礼物', price: 188 }],
    },
  ];
  const updates = [];
  const db = {
    prepare(sql) {
      if (sql.includes('SELECT value FROM settings')) {
        return { get: () => ({ value: JSON.stringify(existing) }) };
      }
      if (sql.includes('UPDATE settings SET value')) {
        return {
          run: (value, updatedAt) => updates.push({ value, updatedAt }),
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  migrateBlindBoxConfig(db);

  assert.equal(updates.length, 1);
  const migrated = JSON.parse(updates[0].value);
  assert.deepEqual(migrated.slice(0, existing.length), existing);
  assert.equal(migrated.filter((box) => box.name === '七夕鹊匣').length, 1);
  assert.equal(migrated[existing.length].price, 25);
  assert.equal(migrated.filter((box) => box.name === '羁绊宝盒').length, 1);
  assert.equal(migrated[existing.length + 1].price, 33);
});

test('settings bootstrap merges new blind-box defaults before the first settings read', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-blind-box-bootstrap-'),
  );
  const databases = createDatabases({
    dataDir,
    defaultSettings: DEFAULT_SETTINGS,
  });
  const existing = [
    {
      name: '心动盲盒',
      price: 12,
      outputs: [{ name: '用户修改礼物', price: 99 }],
    },
    {
      name: '用户自定义盲盒',
      price: 88,
      outputs: [{ name: '自定义礼物', price: 188 }],
    },
  ];

  try {
    databases.songDb
      .prepare(
        `
      INSERT INTO settings (key, value, updated_at)
      VALUES ('giftBlindBoxConfig', ?, ?)
    `,
      )
      .run(JSON.stringify(existing), new Date().toISOString());

    const { settingsStore } = prepareSettingsBootstrap(
      databases.songDb,
      settingsStoreModule,
    );
    const migrated = JSON.parse(settingsStore.getSettings().giftBlindBoxConfig);

    assert.deepEqual(migrated.slice(0, existing.length), existing);
    assert.deepEqual(
      migrated.slice(existing.length).map((box) => box.name),
      ['幸运盲盒', '小熊虫盲盒', '七夕鹊匣', '羁绊宝盒'],
    );
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('blind-box migration does not duplicate existing default entries', () => {
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
    },
  };

  migrateBlindBoxConfig(db);

  assert.equal(updates.length, 0);
});

test('blind-box migration preserves an explicit empty configuration', () => {
  for (const [storedValue, expectedUpdates] of [
    ['', ['[]']],
    ['[]', []],
  ]) {
    const updates = [];
    const db = {
      prepare(sql) {
        if (sql.includes('SELECT value FROM settings')) {
          return { get: () => ({ value: storedValue }) };
        }
        if (sql.includes('UPDATE settings SET value')) {
          return {
            run: (value) => updates.push(value),
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    migrateBlindBoxConfig(db);
    assert.deepEqual(updates, expectedUpdates);
  }
});

test('an empty blind-box configuration survives repeated settings bootstrap', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-empty-blind-box-bootstrap-'),
  );
  const databases = createDatabases({
    dataDir,
    defaultSettings: DEFAULT_SETTINGS,
  });

  try {
    const first = prepareSettingsBootstrap(
      databases.songDb,
      settingsStoreModule,
    );
    first.settingsStore.setSetting('giftBlindBoxConfig', '[]');

    const second = prepareSettingsBootstrap(
      databases.songDb,
      settingsStoreModule,
    );
    assert.equal(second.settingsStore.getSettings().giftBlindBoxConfig, '[]');

    const third = prepareSettingsBootstrap(
      databases.songDb,
      settingsStoreModule,
    );
    assert.equal(third.settingsStore.getSettings().giftBlindBoxConfig, '[]');
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('settings route rejects malformed blind-box values and stores normalized JSON', async () => {
  const writes = [];
  const context = {
    settings: {
      defaults: DEFAULT_SETTINGS,
      set(key, value) {
        writes.push([key, value]);
      },
    },
    bilibili: { configure() {} },
    broadcastSnapshot() {},
    cloudSync: { request() {} },
    system: { getState: () => ({ settings: {} }) },
  };

  async function post(value) {
    const response = {
      writeHead(status) {
        this.status = status;
      },
      end(payload) {
        this.payload = JSON.parse(payload);
      },
    };
    await settingsRoutes.routes['POST /api/settings'](
      context,
      { body: async () => ({ giftBlindBoxConfig: value }) },
      response,
    );
    return response;
  }

  for (const invalid of [
    '',
    '{invalid',
    [{ name: '空奖池', price: 1, outputs: [] }],
    [{ name: '错误奖池', price: 1, outputs: [{ price: 2 }] }],
  ]) {
    const response = await post(invalid);
    assert.equal(response.status, 400);
  }
  assert.deepEqual(writes, []);

  const response = await post([
    {
      name: ' 测试盲盒 ',
      price: 1.234,
      outputs: [{ name: ' 测试礼物 ', price: 2.345 }],
    },
  ]);
  assert.equal(response.status, 200);
  assert.deepEqual(writes, [
    [
      'giftBlindBoxConfig',
      JSON.stringify([
        {
          name: '测试盲盒',
          price: 1.23,
          outputs: [{ name: '测试礼物', price: 2.35 }],
        },
      ]),
    ],
  ]);
});

test('blind-box prices must remain positive after two-decimal normalization', () => {
  const config = (price, outputPrice = 0.01) => [
    {
      name: '测试盲盒',
      price,
      outputs: [{ name: '测试礼物', price: outputPrice }],
    },
  ];

  assert.throws(
    () => normalizeGiftBlindBoxConfig(config(0.001)),
    /INVALID_GIFT_BLIND_BOX_CONFIG/,
  );
  assert.throws(
    () => normalizeGiftBlindBoxConfig(config(0.01, 0.001)),
    /INVALID_GIFT_BLIND_BOX_CONFIG/,
  );
  assert.deepEqual(normalizeGiftBlindBoxConfig(config(0.01)), config(0.01));
});

test('event blind-box artwork uses RMB value folders', () => {
  const expectedPaths = new Map([
    [35461, ['blind-box/35461.webp', 33]],
    [35462, ['0000-under-0100/35462.webp', 5]],
    [35463, ['0000-under-0100/35463.webp', 20]],
    [35464, ['0000-under-0100/35464.webp', 35]],
    [35465, ['0100-0200/35465.webp', 100]],
    [35466, ['0200-0300/35466.webp', 200]],
    [35467, ['0800-0900/35467.webp', 800]],
    [35468, ['2500-2999/35468.webp', 2888]],
    [35786, ['blind-box/35786.webp', 25]],
    [35787, ['0000-under-0100/35787.webp', 5]],
    [35788, ['0000-under-0100/35788.webp', 19]],
    [35789, ['0000-under-0100/35789.webp', 26]],
    [35790, ['0000-under-0100/35790.webp', 66]],
    [35791, ['0500-0600/35791.webp', 500]],
    [35792, ['1200-1300/35792.webp', 1200]],
  ]);
  const giftRoot = path.join(ROOT_DIR, 'public', 'img', 'bilibili-gifts');
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(ROOT_DIR, 'public', 'img', 'bilibili-gifts.json'),
      'utf8',
    ),
  );
  const paidMapping = fs.readFileSync(
    path.join(giftRoot, 'gift-mapping-100-above.md'),
    'utf8',
  );

  assert.equal(fs.existsSync(path.join(giftRoot, 'qixi-que-box')), false);
  for (const [id, [relativePath, rmb]] of expectedPaths) {
    assert.equal(
      fs.existsSync(path.join(giftRoot, relativePath)),
      true,
      `${id} artwork should exist`,
    );
    const gift = manifest.gifts.find((item) => item.id === id);
    assert.equal(gift?.image, `bilibili-gifts/${relativePath}`);
    assert.equal(gift?.rmb, rmb);
  }
  assert.match(
    paidMapping,
    /\|\s*31134\s*\|[^\n]+\|\s*守护之翼\s*\|\s*2000\s*\|\s*¥200\.00\s*\|[^\n]+非目前在售\s*\|/,
  );
  assert.match(
    paidMapping,
    /\|\s*35465\s*\|[^\n]+\|\s*守护之翼\s*\|\s*1000\s*\|\s*¥100\.00\s*\|[^\n]+在售\s*\|/,
  );
});
