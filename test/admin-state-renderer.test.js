'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

test('Admin routes changed fields only to views that consume them', async () => {
  const { createAdminStateRenderer } = await loadModuleExports(
    path.resolve('public/js/admin/state-renderer.js'),
    { document: {} },
  );
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
  assert.deepEqual(calls, [
    'renderSettings',
    'renderQueueStyle',
    'renderQueue',
    'renderGifts',
  ]);
  calls.length = 0;
  render({ state: {}, changedKeys: [] });
  assert.deepEqual(calls, []);
});
