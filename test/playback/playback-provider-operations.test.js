'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('WeSing health reads capture state without changing source preference or querying online providers', async () => {
  const selected = [];
  const { createProviderOperations } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'operations', 'provider-operations.js'),
    { document: { getElementById: () => null }, window: {} },
  );
  const playbackState = { selectedSource: 'wesing' };
  const operations = createProviderOperations({
    playbackState,
    providerManager: {
      refreshAuthState: async () => assert.fail('WeSing must not query online-provider login'),
      checkProviderHealth: async () => assert.fail('WeSing must not query online-provider health'),
      getProviderHealth: () => assert.fail('WeSing must not read online-provider health'),
    },
    weSingService: {
      setSelected: async (value) => selected.push(value),
      getAuthState: () => ({ loggedIn: true }),
      getProviderHealth: () => ({ source: 'wesing', ok: true }),
    },
    savePlaybackState: () => {},
    renderPlayback: () => {},
    getPlaybackAudio: () => null,
    toast: () => {},
    showError: () => {},
    U: { showStackedToast: () => {} },
  });

  await operations.refreshSelectedMusicProviderState();
  assert.deepEqual(selected, []);
  assert.deepEqual({ ...operations.getAuthState() }, { loggedIn: true });
  assert.equal(operations.getProviderHealth().source, 'wesing');
});

test('music login action and result remain bound to the prompted platform after source changes', async () => {
  for (const auth of [true, 'error']) {
    const notifications = [];
    const requested = [];
    const state = { selectedSource: 'qq' };
    const { createProviderOperations } = await loadModuleExports(
      path.resolve('public/js/playback/operations/provider-operations.js'),
      {
        document: { getElementById: () => null },
        window: { musicAPI: { login: async (platform) => requested.push(platform) } },
      },
    );
    const operations = createProviderOperations({
      playbackState: state,
      invalidatePlaybackRequests() {},
      stateActions: { forgetProviderStreams() {} },
      providerManager: {
        refreshAuthState: async ({ platform }) => {
          requested.push(platform);
          if (auth === 'error') throw new Error('offline');
          return { loggedIn: auth };
        },
      },
      renderPlayback() {},
      showError(error) {
        throw error;
      },
      toast() {},
      U: { showStackedToast: (notice) => notifications.push(notice) },
    });
    operations.showPlaybackLoginPrompt();
    state.selectedSource = 'netease';
    await notifications[0].onClick();
    assert.deepEqual(requested, ['qq', 'qq']);
    assert.equal(notifications[1].type, auth === true ? 'success' : 'warning');
    assert.equal(operations.getAuthState(), null, 'old prompt does not overwrite the newly selected platform');
  }
});

test('health results including thrown errors replace earlier results under one key', async () => {
  const notifications = [];
  let current;
  const { createProviderOperations } = await loadModuleExports(
    path.resolve('public/js/playback/operations/provider-operations.js'),
  );
  const operations = createProviderOperations({
    playbackState: { selectedSource: 'qq' },
    providerManager: {
      checkProviderHealth: async () => {
        if (current instanceof Error) throw current;
        return current;
      },
    },
    renderPlayback() {},
    toast() {},
    showError(error) {
      throw error;
    },
    U: { showStackedToast: (notice) => notifications.push(notice) },
  });
  for (current of [{ ok: true }, { ok: false }, { ok: true }, new Error('offline')])
    await operations.checkSelectedMusicProviderHealth();
  assert.deepEqual(
    notifications.map((notice) => notice.type),
    ['success', 'warning', 'success', 'warning'],
  );
  assert.equal(new Set(notifications.map((notice) => notice.key)).size, 1);
  assert.ok(notifications.every((notice) => notice.update));
  assert.equal(operations.getProviderHealth().message, 'offline');
});
