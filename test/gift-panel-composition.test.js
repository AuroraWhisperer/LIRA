'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

test('gift panel renders through imported modules after the legacy registry is replaced', async () => {
  const nodes = new Map(['giftSprintTarget', 'giftSprintReceived',
    'giftSprintRemaining', 'giftSprintCrystalBalls', 'enableGiftNotification']
    .map((id) => [id, {}]));
  const window = { addEventListener() {} };
  const { renderGiftPanel } = await loadModuleExports(
    path.resolve('public/js/admin/gifts/index.js'), {
      window,
      document: { readyState: 'loading', addEventListener() {},
        getElementById: (id) => nodes.get(id) || null, querySelectorAll: () => [] },
      fetch: async () => ({ ok: true, text: async () => JSON.stringify({ ok: true, data: [] }) }),
    },
  );
  assert.equal(window.AdminApp.gifts.renderGiftPanel, renderGiftPanel);
  assert.equal(typeof window.AdminApp.gifts.initGiftHistoryDrawer, 'function');
  window.AdminApp.gifts = {};
  renderGiftPanel({ recent: [] }, {
    targetRmb: 100, receivedRmb: 40, remainingRmb: 60, remainingCrystalBalls: 1,
  }, {}, {}, { enableGiftNotification: 'false' });
  assert.equal(nodes.get('giftSprintReceived').textContent, '¥40.00');
  assert.equal(nodes.get('giftSprintCrystalBalls').textContent, '1 个');
  assert.equal(nodes.get('enableGiftNotification').checked, false);
});
