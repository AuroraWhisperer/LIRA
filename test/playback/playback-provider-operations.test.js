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
  assert.equal((await operations.refreshSelectedMusicAuthState()).loggedIn, true);
});
