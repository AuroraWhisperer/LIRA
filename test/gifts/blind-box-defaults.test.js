'use strict';

const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { DEFAULT_SETTINGS, bootstrapSettingsStore, migrateBlindBoxConfig } = require('../../src/storage/settings-store');
const settingsRoutes = require('../../src/server/routes/settings-routes');
const { normalizeGiftBlindBoxConfig } = require('../../src/bilibili/gift/blind-box-config');
const defaultBlindBoxConfig = require('../../src/storage/default-blind-box-config.json');

function createSettingsDb(t, storedValue) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  db.prepare("INSERT INTO settings VALUES ('giftBlindBoxConfig', ?, 'before')").run(storedValue);
  return db;
}

function assertMigrationSkipsWrite(db) {
  const changes = db.prepare('SELECT total_changes() AS count');
  const before = changes.get().count;
  migrateBlindBoxConfig(db);
  assert.equal(changes.get().count, before);
}

test('settings bootstrap appends missing blind boxes once and preserves user entries', (t) => {
  const existing = [
    {
      name: '心动盲盒',
      price: 12,
      outputs: [{ name: '用户修改礼物', price: 99 }],
    },
    { name: '幸运盲盒', price: 5, outputs: [] },
    {
      name: '用户自定义盲盒',
      price: 88,
      outputs: [{ name: '自定义礼物', price: 188 }],
    },
  ];

  const db = createSettingsDb(t, JSON.stringify(existing));
  const migrated = JSON.parse(bootstrapSettingsStore(db).getSettings().giftBlindBoxConfig);

  const missing = defaultBlindBoxConfig.filter((box) => !existing.some((entry) => entry.name === box.name));
  assert.deepEqual(migrated, [...existing, ...missing]);
  assertMigrationSkipsWrite(db);
});

test('settings bootstrap preserves both legacy and explicitly cleared blind-box configurations', (t) => {
  const legacy = createSettingsDb(t, '');
  assert.equal(bootstrapSettingsStore(legacy).getSettings().giftBlindBoxConfig, '[]');

  const current = createSettingsDb(t, DEFAULT_SETTINGS.giftBlindBoxConfig);
  bootstrapSettingsStore(current).setSetting('giftBlindBoxConfig', '[]');
  assertMigrationSkipsWrite(current);
  assert.equal(bootstrapSettingsStore(current).getSettings().giftBlindBoxConfig, '[]');
});

test('settings route rejects malformed blind-box values and stores normalized JSON', async () => {
  const writes = [];
  const context = {
    settings: {
      defaults: DEFAULT_SETTINGS,
      setMany(values) {
        writes.push(...Object.entries(values));
        return Object.keys(values);
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

  assert.throws(() => normalizeGiftBlindBoxConfig(config(0.001)), /INVALID_GIFT_BLIND_BOX_CONFIG/);
  assert.throws(() => normalizeGiftBlindBoxConfig(config(0.01, 0.001)), /INVALID_GIFT_BLIND_BOX_CONFIG/);
  assert.deepEqual(normalizeGiftBlindBoxConfig(config(0.01)), config(0.01));
});

test('blind-box migration upgrades legacy string outputs by known price and is stable on rerun', (t) => {
  const db = createSettingsDb(t, JSON.stringify([
    { name: '心动盲盒', price: 15, outputs: ['电影票', '未知礼物', { name: '已有对象', price: 3 }] },
    { name: '用户盲盒', price: 6, outputs: ['棉花糖'] },
  ]));
  const read = db.prepare("SELECT value FROM settings WHERE key = 'giftBlindBoxConfig'");

  migrateBlindBoxConfig(db);
  const firstValue = read.get().value;
  const migrated = JSON.parse(firstValue);
  assert.deepEqual(migrated[0].outputs, [{ name: '电影票', price: 2 }, '未知礼物', { name: '已有对象', price: 3 }]);
  assert.deepEqual(migrated[1], { name: '用户盲盒', price: 6, outputs: ['棉花糖'] });
  migrateBlindBoxConfig(db);
  assert.equal(read.get().value, firstValue);
});

test('custom V2 blind-box settings are normalized and invalid configurations are rejected before saving', () => {
  const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
  const save = (value) => normalizeSettingsPatch({ giftBlindBoxCustomConfigV2: value }, DEFAULT_SETTINGS);
  const box = (overrides = {}) => ({
    giftId: '32251',
    name: '自定义盒',
    price: 10,
    outputs: [{ giftId: '100', name: '产物' }],
    ...overrides,
  });

  assert.deepEqual(save(null), { values: { giftBlindBoxCustomConfigV2: 'null' } });
  assert.deepEqual(
    save([
      box({
        customId: 'A1B2C3D4-0000-4000-8000-000000000000',
        giftId: 32251,
        name: ' Café 盒 ',
        price: 1.234,
        outputs: [
          { giftId: '100', name: ' 产物 ', price: 2.345 },
          { giftId: 101, name: '无价产物' },
        ],
      }),
      box({ giftId: null, name: '未绑定礼物盒' }),
    ]),
    {
      values: {
        giftBlindBoxCustomConfigV2: JSON.stringify([
          {
            customId: 'a1b2c3d4-0000-4000-8000-000000000000',
            giftId: '32251',
            name: 'Café 盒',
            price: 1.23,
            outputs: [
              { giftId: '100', name: '产物', price: 2.35 },
              { giftId: '101', name: '无价产物' },
            ],
          },
          { giftId: null, name: '未绑定礼物盒', price: 10, outputs: [{ giftId: '100', name: '产物' }] },
        ]),
      },
    },
  );

  const longName = '名'.repeat(100);
  const oversized = Array.from({ length: 3 }, (_, boxIndex) =>
    box({
      giftId: String(1000 + boxIndex),
      name: `大盒${boxIndex}`,
      outputs: Array.from({ length: 200 }, (_, index) => ({ giftId: String(index + 1), name: longName })),
    }),
  );
  for (const [label, value] of [
    ['not an array', { boxes: [] }],
    ['malformed JSON', '[{'],
    [
      'too many boxes',
      Array.from({ length: 101 }, (_, index) => box({ giftId: String(index + 1), name: `盒${index}` })),
    ],
    ['duplicate name', [box(), box({ giftId: '32252' })]],
    ['duplicate gift id', [box(), box({ name: '另一盒' })]],
    [
      'duplicate custom id',
      [
        box({ customId: 'a1b2c3d4-0000-4000-8000-000000000000', giftId: null }),
        box({ customId: 'A1B2C3D4-0000-4000-8000-000000000000', giftId: null, name: '另一盒' }),
      ],
    ],
    ['invalid custom id', [box({ customId: 'not-a-uuid' })]],
    ['invalid gift id', [box({ giftId: '0' })]],
    ['empty outputs', [box({ outputs: [] })]],
    ['duplicate output gift id', [box({ outputs: [{ giftId: '100', name: 'A' }, { giftId: '100', name: 'B' }] })]],
    ['missing output gift id', [box({ outputs: [{ name: '产物' }] })]],
    ['control character in name', [box({ name: '盒\u0001' })]],
    ['name over 100 characters', [box({ name: `${longName}长` })]],
    ['non-positive price', [box({ price: 0 })]],
    ['serialized size over 64 KiB', oversized],
  ]) {
    assert.ok(save(value).error, label);
  }
});
