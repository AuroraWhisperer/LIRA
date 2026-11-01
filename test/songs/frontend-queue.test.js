'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readQueueOverlayBundle: readJsModuleBundle } = require('../helpers/queue-overlay-bundle');

const ROOT_DIR = path.join(__dirname, '../..');
const settingsStoreModule = require('../../src/storage/settings-store');

test('queue reconnect renders new requests and visible identity changes once', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  let renders = 0;
  const sandbox = { window: {}, location: { search: '' }, URLSearchParams,
    document: { addEventListener() {} }, recordRender: () => renders++ };
  vm.runInNewContext(source, sandbox);
  vm.runInNewContext('render = recordRender;', sandbox);
  const item = { id: 1, song_name: '相同歌曲', requester_name: '相同观众', requester_guard_level: 0,
    requester_medal_level: 0, requester_medal_name: '' };
  const apply = (current, style = 'identity') => sandbox.applyState({ queue: { current, waiting: [] }, settings: { overlayQueueStyle: style } });
  apply(item); apply(structuredClone(item));
  assert.equal(renders, 1, 'identical snapshots preserve playback');
  apply({ ...item, id: 2, requester_guard_level: 3, requester_medal_level: 21, requester_medal_name: '粉丝牌' });
  assert.equal(renders, 2, 'a missed remove/add redraws the same names with their latest identity');
  apply(item, 'classic');
  const before = renders;
  apply({ ...item, requester_medal_level: 30 }, 'classic');
  assert.equal(renders, before, 'classic ignores identity fields it does not display');
  apply({ ...item, is_live: true }, 'classic');
  assert.equal(renders, before + 1, 'LIVE updates even when the queue order stays the same');
  apply(item, 'classic');
  assert.equal(renders, before + 2, 'removing LIVE also updates the overlay');
});

test('queue opacity percentages survive form refresh and preset sync without changing the saved scale', async () => {
  const fields = new Map(
    ['themeOpacity', 'themeOpacityNumber'].map((id) => [
      id,
      {
        _value: '0.48',
        get value() {
          return this._value;
        },
        set value(next) {
          this._value = String(next);
        },
        dataset: {},
        closest() {
          return null;
        },
      },
    ]),
  );
  const document = {
    getElementById: (id) => fields.get(id) || null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const window = { AdminApp: {} };
  const { FormsService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/forms.js'), {
    document,
    window,
  });
  const service = new FormsService();
  for (const [stored, displayed] of [
    ['0.57', 57],
    ['0', 0],
  ]) {
    service.fillForm({ themeOpacity: stored });
    assert.equal(fields.get('themeOpacity').value, stored);
    assert.equal(Number(fields.get('themeOpacityNumber').value), displayed);
  }

  const { theme } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/theme.js'), { document, window });
  window.AdminApp = {};
  fields.get('themeOpacity').value = '0.85';
  theme.syncAllRangeInputs({ themeOpacity: 0 });
  assert.equal(fields.get('themeOpacityNumber').value, '0');
  theme.syncAllRangeInputs();
  assert.equal(fields.get('themeOpacityNumber').value, '85');
  assert.equal(theme.collectTheme().themeOpacity, '0.85');
});

test('queue theme payloads persist only the selected style', async () => {
  const { OVERLAY_THEME_KEYS } = require('../../src/storage/theme-store');
  const { collectQueueTheme, queueSettingsPayload } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/queue-theme-config.js'),
  );

  const values = {
    overlayQueueStyle: 'neon-vinyl',
    identityQueueFontSize: '41',
    illustratedQueueFontFamily: 'KaiTi',
    illustratedQueueFontWeight: '700',
    illustratedQueueUseCustomTextColor: 'true',
    illustratedQueueTextColor: '#123456',
    identityQueueScrollMode: 'loop',
    identityQueueScrollSpeed: '64',
  };
  const payload = collectQueueTheme({ getElementById: (id) => ({ value: values[id] ?? '' }) });
  const styleKeys = Object.keys(payload).filter((key) => key !== 'overlayQueueStyle');
  assert.equal(payload.overlayQueueStyle, 'neon-vinyl');
  assert.equal(payload.neonVinylQueueFontFamily, 'KaiTi');
  assert.equal(payload.neonVinylQueueScrollSpeed, '64');
  assert.ok(styleKeys.length > 0 && styleKeys.every((key) => key.startsWith('neonVinylQueue')), styleKeys.join(', '));
  for (const key of styleKeys) assert.ok(OVERLAY_THEME_KEYS.includes(key), `${key} must be a persisted theme key`);

  assert.deepEqual(
    { ...queueSettingsPayload({ overlayQueueStyle: 'golden-lily' }, { goldenLilyQueueFontSize: '30', unrelated: 'x' }) },
    { goldenLilyQueueFontSize: '30', overlayQueueStyle: 'golden-lily' },
  );

  for (const style of ['classic', 'identity']) {
    const font = '"Custom Local"';
    values.overlayQueueStyle = style;
    values.overlayFontFamily = font;
    const collected = collectQueueTheme({ getElementById: (id) => ({ value: values[id] ?? '' }) });
    const key = style === 'identity' ? 'identityQueueFontFamily' : 'overlayFontFamily';
    const otherKey = style === 'identity' ? 'overlayFontFamily' : 'identityQueueFontFamily';
    assert.equal(collected[key], font, `${style} saves its selected font`);
    assert.equal(collected[otherKey], undefined, 'editing one style must not change the other font');
    assert.ok(OVERLAY_THEME_KEYS.includes(key));
    assert.equal(collected.illustratedQueueFontFamily, undefined, 'illustrated fonts remain independent');
  }
});

test('queue styles migrate shared typography and scrolling into independent persisted values', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const insert = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
  const legacyValues = {
    identityQueueFontSize: '37',
    illustratedQueueFontFamily: 'KaiTi, serif',
    illustratedQueueFontWeight: '700',
    illustratedQueueUseCustomTextColor: 'true',
    illustratedQueueTextColor: '#123456',
    queueScrollMode: 'loop',
    identityQueueScrollSpeed: '63',
  };
  for (const [key, value] of Object.entries(legacyValues)) {
    insert.run(key, value, '2026-08-23 00:00:00');
  }

  try {
    const store = settingsStoreModule.createSettingsStore(db);
    settingsStoreModule.migrateQueueStyleSettings(db, '');
    const settings = store.getSettings();

    assert.equal(settings.identityQueueScrollMode, 'loop');
    for (const prefix of ['storybook', 'neonVinyl', 'cherryRibbon', 'goldenLily']) {
      assert.equal(settings[`${prefix}QueueFontSize`], '37');
      assert.equal(settings[`${prefix}QueueFontFamily`], 'KaiTi, serif');
      assert.equal(settings[`${prefix}QueueFontWeight`], '700');
      assert.equal(settings[`${prefix}QueueUseCustomTextColor`], 'true');
      assert.equal(settings[`${prefix}QueueTextColor`], '#123456');
      assert.equal(settings[`${prefix}QueueScrollMode`], 'loop');
      assert.equal(settings[`${prefix}QueueScrollSpeed`], '63');
    }
    assert.equal(settings.queueStyleSettingsVersion, '1');
  } finally {
    db.close();
  }
});
