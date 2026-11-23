'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

function createLegacyPlaybackStorage() {
  const saved = JSON.stringify({ current: { id: 'old-song', name: '旧歌曲', source: 'qq' }, mode: 'sequence', volume: 0.75, selectedSource: 'qq' });
  const values = new Map([
    ['playbackState:v2', saved],
    ['songAssistantPlaybackState:v1', saved],
    ['playbackCache:v2:qq:recent', 'cached'],
    ['unrelated-preference', 'kept'],
  ]);
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index],
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

async function restorePlayback(storage) {
  const { StorageManager } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/playback/state/storage.js'), {
    localStorage: storage,
    fetch: async () => ({ ok: true, json: async () => ({ data: { payload: null } }) }),
  });
  return new StorageManager().restoreState();
}

test('successful clear-all reloads the player after clearing music browser caches', async () => {
  const { createSettingsOperations } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/settings-operations.js'), {
    document: { getElementById: () => null },
    clearTimeout,
  });
  let cacheCleared = false;
  let reloads = 0;
  const localStorageRef = createLegacyPlaybackStorage();
  const operations = createSettingsOperations({
    documentRef: { getElementById: () => null },
    windowRef: { musicAPI: { async clearCache() { cacheCleared = true; } } },
    locationRef: { reload() { assert.equal(cacheCleared, true); reloads++; } },
    localStorageRef,
    dangerConfirm: async () => true,
    api: async () => ({ ok: true, data: { deletedCounts: {}, totalDeleted: 0 } }),
    toast(message, options) { assert.notEqual(options.type, 'error', message); },
    getState: () => null,
  });
  await operations.clearAll();
  assert.equal(reloads, 1);
  assert.equal(await restorePlayback(localStorageRef), null);
  assert.equal(localStorageRef.getItem('playbackCache:v2:qq:recent'), null);
  assert.equal(localStorageRef.getItem('unrelated-preference'), 'kept');
});

for (const partial of [false, true]) {
  test(`a ${partial ? 'partially' : 'fully'} committed clear reports stale local playback without reloading`, async () => {
    const { createSettingsOperations } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/settings-operations.js'), {
      document: { getElementById: () => null },
      clearTimeout,
    });
    const alerts = [];
    const fail = () => { throw new Error('cleanup unavailable'); };
    const operations = createSettingsOperations({
      documentRef: {}, windowRef: { musicAPI: { clearCache: fail } },
      localStorageRef: { removeItem: fail }, locationRef: { reload: assert.fail },
      alertRef: message => alerts.push(message), toast: assert.fail, dangerConfirm: async () => true,
      async api() {
        if (partial) throw Object.assign(new Error(), { payload: { partial: true, data: { committed: ['musicDb'] } } });
        return { ok: true, data: { deletedCounts: {} } };
      },
    });
    await operations.clearAll();
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /音乐缓存/);
    assert.match(alerts[0], /本机播放状态/);
  });
}

test('shared api preserves the parsed error payload and HTTP status', async () => {
  const payload = {
    ok: false,
    partial: true,
    error: 'Commit failed at superChatDb',
    data: { committed: ['songDb'], failed: ['superChatDb'] },
  };
  const utils = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'), {
    document: {
      getElementById() {
        return null;
      },
    },
    fetch: async () => ({
      ok: false,
      status: 500,
      async text() {
        return JSON.stringify(payload);
      },
    }),
  });

  let caught;
  try {
    await utils.api('/api/database/clear-all', { confirm: true });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.message, payload.error);
  assert.equal(caught.status, 500);
  assert.deepEqual(JSON.parse(JSON.stringify(caught.payload)), payload);
});

test('Admin clear-all alerts and reloads for a structured partial failure', async () => {
  const { createSettingsOperations } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-operations.js'),
  );
  const payload = {
    ok: false,
    partial: true,
    error: 'Commit failed at superChatDb',
    data: { committed: ['songDb'], failed: ['superChatDb'], rollbackFailed: ['giftDb'] },
  };
  const error = new Error(payload.error);
  error.payload = payload;
  const alerts = [];
  const toasts = [];
  let reloadCount = 0;
  const localStorageRef = createLegacyPlaybackStorage();
  const operations = createSettingsOperations({
    documentRef: {},
    windowRef: {},
    locationRef: {
      reload() {
        reloadCount += 1;
      },
    },
    localStorageRef,
    fetchRef: async () => ({}),
    alertRef(message) {
      alerts.push(message);
    },
    async api() {
      throw error;
    },
    async readJsonResponse() {
      return {};
    },
    toast(message) {
      toasts.push(message);
    },
    showStackedToast() {},
    async dangerConfirm() {
      return true;
    },
    async showConfirmationDialog() {
      return true;
    },
    getState() {
      return null;
    },
    getQueue() {
      return null;
    },
  });

  await operations.clearAll();

  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /已清空：[^\n]*歌库/);
  assert.match(alerts[0], /清空失败：醒目留言/);
  assert.match(alerts[0], /待核对：礼物与加班机记录/);
  assert.doesNotMatch(alerts[0], /Commit failed|(?:song|superChat|gift)Db/);
  assert.match(alerts[0], /仍暂停.*刷新页面不会恢复/);
  assert.match(alerts[0], /日志目录.*再次完整清空/);
  assert.equal(reloadCount, 1);
  assert.deepEqual(toasts, []);
  assert.equal((await restorePlayback(localStorageRef)).current.id, 'old-song', 'uncommitted music data keeps its local fallback');
});

for (const [phase, expected] of [['runtime-reset', /数据已清空[^。]*运行状态[^。]*刷新/], ['resume', /数据已清空[^。]*写入[^。]*恢复/]]) {
  test(`Admin clear-all describes ${phase} without an empty failed-database row`, async () => {
    const { createSettingsOperations } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/settings-operations.js'));
    const alerts = [];
    let reloads = 0;
    const localStorageRef = createLegacyPlaybackStorage();
    const operations = createSettingsOperations({
      documentRef: {}, windowRef: {}, locationRef: { reload() { reloads++; } }, localStorageRef,
      alertRef: value => alerts.push(value), dangerConfirm: async () => true,
      api: async () => {
        const error = new Error('fixture failure');
        error.payload = { partial: true, error: error.message, data: { phase, committed: ['songDb', 'giftDb', 'musicDb'], failed: [] } };
        throw error;
      },
      toast() { assert.fail('partial failure must use a blocking explanation'); },
    });
    await operations.clearAll();
    assert.equal(reloads, 1);
    assert.match(alerts[0], expected);
    assert.match(alerts[0], /已清空：[^\n]*播放记录/);
    assert.doesNotMatch(alerts[0], /清空失败：/);
    assert.match(alerts[0], /仍暂停.*刷新页面不会恢复/);
    assert.equal(await restorePlayback(localStorageRef), null, 'committed music clear must not restore legacy local state');
  });
}
