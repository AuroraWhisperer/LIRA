'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('Admin connection status renders disconnect, reconnect and shutdown in the view', async () => {
  const status = { hidden: true, textContent: '', className: '' };
  let statusNode = status;
  const { renderConnectionStatus } = await loadModuleExports(path.resolve('public/js/admin/state-renderer.js'), {
    document: { getElementById: () => statusNode },
  });
  renderConnectionStatus('disconnected');
  assert.deepEqual(status, { hidden: false, textContent: '前端连接断开，重连中', className: 'pill warn' });
  renderConnectionStatus('connected');
  assert.equal(status.hidden, true);
  renderConnectionStatus('shutdown');
  assert.deepEqual(status, { hidden: false, textContent: '程序已退出', className: 'pill warn' });
  statusNode = null;
  assert.doesNotThrow(() => renderConnectionStatus('shutdown'));
});

test('Admin routes changed fields only to views that consume them', async () => {
  const { createAdminStateRenderer } = await loadModuleExports(path.resolve('public/js/admin/state-renderer.js'), {
    document: {},
  });
  const calls = [];
  const render = createAdminStateRenderer(
    Object.fromEntries(
      [
        'renderQueue',
        'renderSuperChats',
        'renderSettings',
        'renderQueueStyle',
        'renderGifts',
        'renderLive',
        'renderCategories',
        'renderSongCount',
      ].map((name) => [name, () => calls.push(name)]),
    ),
  );
  render({
    state: { gifts: { recent: [{ id: 1 }] } },
    changedKeys: ['gifts'],
  });
  assert.deepEqual(calls, ['renderGifts']);
  calls.length = 0;
  render({ state: {}, changedKeys: ['settings', 'queue'] });
  assert.deepEqual(calls, ['renderSettings', 'renderQueueStyle', 'renderQueue', 'renderGifts']);
  calls.length = 0;
  render({ state: {}, changedKeys: [] });
  assert.deepEqual(calls, []);
});
