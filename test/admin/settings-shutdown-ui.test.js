'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function fixture(api) {
  const nodes = {
    shutdownBtn: { disabled: false, textContent: '退出 LIRA' },
    wsStatus: { hidden: true, textContent: '已连接', className: 'pill' },
    closeWindowBtn: { addEventListener() {} },
  };
  const documentRef = { getElementById: (id) => nodes[id], body: { innerHTML: '管理页面' } };
  const state = { shuttingDown: false, setShuttingDown(value) { this.shuttingDown = value; } };
  const notices = [];
  const { createSettingsOperations } = await loadModuleExports(
    path.join(__dirname, '../../public/js/admin/settings-operations.js'),
  );
  const operations = createSettingsOperations({
    documentRef, windowRef: {}, getState: () => state,
    showConfirmationDialog: async () => true,
    api: (...args) => api(state, ...args),
    toast: (message) => notices.push(message),
  });
  return { nodes, documentRef, state, notices, operations };
}

test('a failed shutdown request preserves the page, restores controls and does not stop reconnection', async () => {
  const f = await fixture(async (state) => {
    assert.equal(state.shuttingDown, false);
    throw new Error('连接失败');
  });
  await f.operations.shutdownServer();
  assert.equal(f.state.shuttingDown, false);
  assert.equal(f.documentRef.body.innerHTML, '管理页面');
  assert.deepEqual(f.nodes.shutdownBtn, { disabled: false, textContent: '退出 LIRA' });
  assert.deepEqual(f.nodes.wsStatus, { hidden: true, textContent: '已连接', className: 'pill' });
  assert.deepEqual(f.notices, ['退出请求失败：连接失败']);
});

for (const broadcast of [false, true]) {
  test(`shutdown completes after ${broadcast ? 'a confirmed broadcast despite a lost HTTP response' : 'HTTP acceptance'}`, async () => {
    const f = await fixture(async (state) => {
      if (broadcast) {
        state.shuttingDown = true;
        throw new Error('响应中断');
      }
      return { ok: true };
    });
    await f.operations.shutdownServer();
    assert.equal(f.state.shuttingDown, true);
    assert.match(f.documentRef.body.innerHTML, /本地服务已安全关闭/);
    assert.deepEqual(f.notices, []);
  });
}
