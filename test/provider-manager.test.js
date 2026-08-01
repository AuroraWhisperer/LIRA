// 编写人：Aurora
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

test('provider state stays scoped to its source when checks finish out of order', async () => {
  const authRequests = new Map();
  const healthRequests = new Map();
  const state = { selectedSource: 'qq' };
  const window = {
    musicAPI: {
      getAuthState(platform) {
        return new Promise((resolve) => authRequests.set(platform, resolve));
      },
      providerHealth(platform) {
        return new Promise((resolve) => healthRequests.set(platform, resolve));
      }
    }
  };
  const ProviderManager = await loadProviderManager({ window });
  const manager = new ProviderManager({ state });

  const qqRefresh = Promise.all([
    manager.refreshAuthState({ platform: 'qq', notify: false }),
    manager.checkProviderHealth({ platform: 'qq', silent: true, notify: false })
  ]);
  state.selectedSource = 'netease';
  const neteaseRefresh = Promise.all([
    manager.refreshAuthState({ platform: 'netease', notify: false }),
    manager.checkProviderHealth({ platform: 'netease', silent: true, notify: false })
  ]);

  authRequests.get('netease')({ platform: 'netease', loggedIn: true });
  healthRequests.get('netease')({ source: 'netease', ok: true, message: '网易云可用' });
  await neteaseRefresh;
  authRequests.get('qq')({ platform: 'qq', loggedIn: false });
  healthRequests.get('qq')({ source: 'qq', ok: true, message: 'QQ 可用' });
  await qqRefresh;

  assert.equal(manager.getAuthState('qq').platform, 'qq');
  assert.equal(manager.getProviderHealth('qq').message, 'QQ 可用');
  assert.equal(manager.getAuthState('netease').platform, 'netease');
  assert.equal(manager.getProviderHealth('netease').message, '网易云可用');
  assert.equal(manager.authState.platform, 'netease');
  assert.equal(manager.providerHealth.source, 'netease');
});

async function loadProviderManager(sandbox) {
  const context = vm.createContext({ console, encodeURIComponent, ...sandbox });
  const filePath = path.join(__dirname, '..', 'public', 'js', 'playback', 'provider', 'manager.js');
  const identifier = pathToFileURL(filePath).href;
  const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
    context,
    identifier
  });
  await module.link(() => {
    throw new Error('ProviderManager should not import dependencies.');
  });
  await module.evaluate();
  return module.namespace.ProviderManager;
}
