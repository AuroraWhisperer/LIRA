'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

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

  assert.equal(notifications.at(-1).message, '网易云音乐登录窗口已关闭');
  assert.equal(button.disabled, false);
});

async function loadModuleExports(entryPath, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  const modules = new Map();

  async function load(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
      context,
      identifier,
    });
    modules.set(identifier, module);
    await module.link((specifier, referencingModule) => {
      return load(
        fileURLToPath(new URL(specifier, referencingModule.identifier)),
      );
    });
    return module;
  }

  const module = await load(entryPath);
  await module.evaluate();
  return module.namespace;
}
