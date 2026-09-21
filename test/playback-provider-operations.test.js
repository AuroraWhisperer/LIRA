'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '..');

test('NetEase login closure names the selected music provider', async () => {
  const notifications = [];
  const button = { disabled: false };
  const { createProviderOperations } = await loadModuleExports(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'operations',
      'provider-operations.js',
    ),
    {
      document: { getElementById: () => button },
      window: { musicAPI: { login: async () => {} } },
    },
  );
  const operations = createProviderOperations({
    playbackState: { selectedSource: 'netease' },
    providerManager: {
      refreshAuthState: async () => ({ platform: 'netease', loggedIn: false }),
      checkProviderHealth: async () => ({ source: 'netease', ok: true }),
      getProviderHealth: () => ({ source: 'netease', ok: true }),
    },
    weSingService: { setSelected: async () => {} },
    savePlaybackState: () => {},
    renderPlayback: () => {},
    getPlaybackAudio: () => null,
    toast: () => {},
    showError: () => {},
    U: { showStackedToast: (notification) => notifications.push(notification) },
  });

  await operations.loginSelectedMusicProvider();

  assert.equal(notifications.at(-1).title, '尚未完成网易云音乐登录');
  assert.equal(notifications.at(-1).type, 'warning');
  assert.equal(button.disabled, false);
});
