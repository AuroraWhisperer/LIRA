'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { readAdminHtml } = require('../helpers/admin-html');

async function fixture(api) {
  const initialHtml = readAdminHtml();
  const nodes = {};
  const documentRef = {
    body: { innerHTML: initialHtml },
    getElementById(id) {
      if (!new RegExp(`\\bid=["']${id}["']`).test(this.body.innerHTML)) return null;
      return nodes[id] ||= { disabled: false, textContent: '', addEventListener() {} };
    },
  };
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
  return { nodes, documentRef, initialHtml, state, notices, operations };
}

test('a failed shutdown request preserves the page, restores controls and does not stop reconnection', async () => {
  const f = await fixture(async (state) => {
    assert.equal(state.shuttingDown, false);
    throw new Error('连接失败');
  });
  await f.operations.shutdownServer();
  assert.equal(f.state.shuttingDown, false);
  assert.equal(f.documentRef.body.innerHTML, f.initialHtml);
  assert.equal(f.nodes.shutdownBtn.disabled, false);
  assert.equal(f.notices.length, 1);
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
    assert.notEqual(f.documentRef.body.innerHTML, f.initialHtml);
    assert.deepEqual(f.notices, []);
  });
}
