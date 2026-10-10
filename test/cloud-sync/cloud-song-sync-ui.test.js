'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

function tagById(html, id) {
  const tags = html.match(new RegExp(`<[^>]+\\sid\\s*=\\s*["']${id}["'][^>]*>`, 'g')) || [];
  assert.equal(tags.length, 1, `${id} should exist once`);
  return tags[0];
}

test('import page exposes the cloud song sync action, cloud count, result and last sync record once', () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../public/pages/admin/song/import-export.html'),
    'utf8',
  );
  for (const id of ['licenseSongSync', 'licenseLastCloudSync', 'licenseCloudCount', 'licenseSyncResult']) {
    tagById(html, id);
  }
  const button = tagById(html, 'licenseSyncSongsBtn');
  assert.match(button, /^<button\b/);
  assert.match(button, /\stype=["']button["']/);
});

async function fixture() {
  const elements = new Map();
  const stored = new Map();
  const uploads = [];
  const dialogs = [];
  const notices = [];
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
    getState: async () => ({ streamer: { accountName: 'viewer' } }),
    getCloudSongCount: () => count,
    getLocalSongCount: async () => ({ ok: true, count: songs.length, generation: 7 }),
    syncCurrentSongs: async (...args) => {
      assert.deepEqual(args, [7], 'the renderer sends only the confirmation generation, never filtered rows');
      uploads.push([...songs]);
      return { ok: true, count: songs.length };
    },
  };
  const { initCloudSongSync } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/cloud-song-sync.js'),
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
    getSongs: () => { throw new Error('Filtered UI state is not a full library'); },
    toast: (message, options) => notices.push({ message, ...options }),
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
    notices,
    initialized,
    bridge,
    finishCount,
    confirm: async (value) => {
      await new Promise(setImmediate);
      finishConfirmation(value);
    },
    setSongs: (value) => {
      songs = value;
    },
  };
}

test('cloud sync reports a readable failure and the next successful result', async () => {
  const ui = await fixture();
  ui.finishCount({ ok: true, count: 0 });
  await ui.initialized;
  const button = ui.element('licenseSyncSongsBtn');
  ui.bridge.syncCurrentSongs = async () => ({ ok: false, error: 'NETWORK_UNAVAILABLE' });
  const failed = button.events.click();
  await ui.confirm(true);
  await failed;
  assert.equal(ui.notices.length, 1);
  assert.equal(ui.notices[0].type, 'error');
  assert.match(ui.notices[0].message, /歌单没同步成功.*检查网络/);
  ui.bridge.syncCurrentSongs = async () => ({ ok: true, count: 1 });
  const saved = button.events.click();
  await ui.confirm(true);
  await saved;
  assert.equal(ui.notices.length, 2);
  assert.equal(ui.notices[1].key, ui.notices[0].key);
  assert.match(ui.notices[1].message, /云端歌单已更新，共 1 首/);
});

test('cloud sync waits for the initial count and uploads only the post-confirmation snapshot once', async () => {
  const ui = await fixture();
  const button = ui.element('licenseSyncSongsBtn');
  assert.equal(button.disabled, true);
  assert.equal(button.events.click, undefined);
  ui.finishCount({ ok: true, count: 2 });
  await ui.initialized;
  assert.equal(button.disabled, false);
  const syncing = button.events.click();
  await button.events.click();
  assert.equal(ui.dialogs.length, 1);
  assert.match(ui.dialogs[0].description, /云端现有 2 首/);
  assert.equal(ui.uploads.length, 0);
  ui.setSongs([{ name: 'after' }, { name: 'new' }]);
  await ui.confirm(true);
  await syncing;
  assert.equal(ui.uploads.length, 1);
  assert.equal(ui.uploads[0][0].name, 'after');
  assert.match(ui.element('licenseSyncResult').textContent, /已同步 2 首/);
  assert.equal(JSON.parse(ui.stored.get('lira:license:lastCloudSync')).count, 2);
  assert.equal(button.disabled, false);
});

test('cancelled cloud confirmation sends nothing and validation errors keep the failed song index', async () => {
  const ui = await fixture();
  ui.finishCount({ ok: true, count: 0 });
  await ui.initialized;
  const button = ui.element('licenseSyncSongsBtn');
  const cancelled = button.events.click();
  await ui.confirm(false);
  await cancelled;
  assert.equal(ui.uploads.length, 0);
  assert.equal(ui.stored.size, 0);
  ui.bridge.syncCurrentSongs = async () => ({
    ok: false,
    error: 'INVALID_SONG',
    index: 2,
  });
  const failed = button.events.click();
  await ui.confirm(true);
  await failed;
  assert.match(ui.element('licenseSyncResult').textContent, /第 3 首歌曲/);
  assert.equal(ui.stored.size, 0);
  assert.equal(button.disabled, false);
});

test('cloud sync rejects invalid response counts instead of inventing a filtered fallback', async () => {
  for (const [count, expected] of [
    [undefined, null],
    [-1, null],
    [1.5, null],
    [Number.MAX_SAFE_INTEGER + 1, null],
    [Infinity, null],
    ['invalid', null],
    [0, 0],
    [3, 3],
  ]) {
    const ui = await fixture();
    ui.finishCount({ ok: true, count: 0 });
    await ui.initialized;
    ui.setSongs([{ name: 'first' }, { name: 'second' }]);
    ui.bridge.syncCurrentSongs = async () => ({ ok: true, count });
    const button = ui.element('licenseSyncSongsBtn');
    const syncing = button.events.click();
    await ui.confirm(true);
    await syncing;
    if (expected === null) {
      assert.equal(ui.stored.size, 0);
      assert.match(ui.element('licenseSyncResult').textContent, /同步失败/);
      assert.equal(button.disabled, false);
      continue;
    }
    assert.equal(JSON.parse(ui.stored.get('lira:license:lastCloudSync')).count, expected, `response count ${count}`);
    assert.equal(ui.element('licenseCloudCount').textContent, `${expected} 首`);
    assert.match(ui.element('licenseSyncResult').textContent, new RegExp(`已同步 ${expected} 首`));
    assert.equal(button.disabled, false);
  }
});

test('legacy import entry keeps the parser and cloud initialization APIs wired through ESM', async () => {
  const window = { AdminApp: { utils: {} } };
  const { songImports: imports } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/song-import.js'),
    { window },
  );
  assert.equal(imports.parseTable('name\trequestPrice\n歌曲\t舰长')[0].requestPrice, '舰长');
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
    ui.finishCount({ ok: true, count: 0 });
    await ui.initialized;
    ui.bridge.syncCurrentSongs = async () => ({ ok: false, error: code });
    const button = ui.element('licenseSyncSongsBtn');
    const failed = button.events.click();
    await ui.confirm(true);
    await failed;
    assert.match(ui.element('licenseSyncResult').textContent, expected);
    assert.equal(ui.stored.size, 0);
    assert.equal(button.disabled, false);
  });
}
