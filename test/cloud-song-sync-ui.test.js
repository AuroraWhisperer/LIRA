'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

async function fixture() {
  const elements = new Map();
  const stored = new Map();
  const uploads = [];
  const dialogs = [];
  let songs = [{ name: 'before' }];
  let finishCount;
  let finishConfirmation;
  const count = new Promise((resolve) => {
    finishCount = resolve;
  });
  function element(id) {
    if (!elements.has(id))
      elements.set(id, {
        hidden: true,
        disabled: false,
        textContent: '',
        events: {},
        addEventListener(name, callback) {
          this.events[name] = callback;
        },
      });
    return elements.get(id);
  }
  const bridge = {
    getProfile: async () => ({ streamer: { accountName: 'viewer' } }),
    getCloudSongs: () => count,
    syncSongs: async (snapshot) => {
      uploads.push(snapshot);
      return { ok: true, count: snapshot.length };
    },
  };
  const { initCloudSongSync } = await loadModuleExports(
    path.resolve(__dirname, '../public/js/admin/cloud-song-sync.js'),
    {
      document: { getElementById: element },
      window: { liraLicense: bridge },
      localStorage: {
        getItem: (key) => stored.get(key),
        setItem: (key, value) => stored.set(key, value),
      },
    },
  );
  const initialized = initCloudSongSync({
    getSongs: () => songs,
    toast() {},
    showConfirmationDialog: (options) => {
      dialogs.push(options);
      return new Promise((resolve) => {
        finishConfirmation = resolve;
      });
    },
  });
  return {
    element,
    stored,
    uploads,
    dialogs,
    initialized,
    bridge,
    finishCount,
    confirm: (value) => finishConfirmation(value),
    setSongs: (value) => {
      songs = value;
    },
  };
}

test('cloud sync waits for the initial count and uploads only the post-confirmation snapshot once', async () => {
  const ui = await fixture();
  const button = ui.element('licenseSyncSongsBtn');
  assert.equal(button.disabled, true);
  assert.equal(button.events.click, undefined);
  ui.finishCount({ songs: [{}, {}] });
  await ui.initialized;
  assert.equal(button.disabled, false);
  const syncing = button.events.click();
  await button.events.click();
  assert.equal(ui.dialogs.length, 1);
  assert.match(ui.dialogs[0].description, /云端现有 2 首/);
  assert.equal(ui.uploads.length, 0);
  ui.setSongs([{ name: 'after' }, { name: 'new' }]);
  ui.confirm(true);
  await syncing;
  assert.equal(ui.uploads.length, 1);
  assert.equal(ui.uploads[0][0].name, 'after');
  assert.match(ui.element('licenseSyncResult').textContent, /已同步 2 首/);
  assert.equal(
    JSON.parse(ui.stored.get('lira:license:lastCloudSync')).count,
    2,
  );
  assert.equal(button.disabled, false);
});

test('cancelled cloud confirmation sends nothing and validation errors keep the failed song index', async () => {
  const ui = await fixture();
  ui.finishCount([]);
  await ui.initialized;
  const button = ui.element('licenseSyncSongsBtn');
  const cancelled = button.events.click();
  ui.confirm(false);
  await cancelled;
  assert.equal(ui.uploads.length, 0);
  assert.equal(ui.stored.size, 0);
  ui.bridge.syncSongs = async () => ({
    ok: false,
    error: 'INVALID_SONG',
    index: 2,
  });
  const failed = button.events.click();
  ui.confirm(true);
  await failed;
  assert.match(ui.element('licenseSyncResult').textContent, /第 3 首歌曲/);
  assert.equal(ui.stored.size, 0);
  assert.equal(button.disabled, false);
});

test('legacy import entry keeps the parser and cloud initialization APIs wired through ESM', async () => {
  const window = { AdminApp: { utils: {} } };
  await loadModuleExports(
    path.resolve(__dirname, '../public/js/admin/import.js'),
    { window },
  );
  const imports = window.AdminApp.imports;
  assert.equal(
    imports.parseTable('name\trequestPrice\n歌曲\t舰长')[0].requestPrice,
    '舰长',
  );
  assert.equal(typeof imports.parseDelimited, 'function');
  assert.equal(typeof imports.readTextFile, 'function');
  assert.equal(typeof imports.readFileAsBase64, 'function');
  assert.equal(typeof imports.initCloudSongSync, 'function');
  assert.equal(typeof imports.initCloudSongBackground, 'function');
});

for (const [code, expected] of [
  ['PAYLOAD_TOO_LARGE', /减少歌曲或缩短备注/],
  ['RESPONSE_TOO_LARGE', /缩减歌库或联系管理员/],
]) {
  test(`cloud song sync explains how to resolve ${code}`, async () => {
    const ui = await fixture();
    ui.finishCount([]);
    await ui.initialized;
    ui.bridge.syncSongs = async () => ({ ok: false, error: code });
    const button = ui.element('licenseSyncSongsBtn');
    const failed = button.events.click();
    ui.confirm(true);
    await failed;
    assert.match(ui.element('licenseSyncResult').textContent, expected);
    assert.equal(ui.stored.size, 0);
    assert.equal(button.disabled, false);
  });
}
