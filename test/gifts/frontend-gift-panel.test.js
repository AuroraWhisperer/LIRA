'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createBlindboxFixture } = require('../helpers/frontend-blindbox-fixture');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('gift subviews skip unrelated state updates while corrections, catalogs and drafts still render', async () => {
  const f = await createBlindboxFixture({ includePanel: true });
  const recent = { classList: { toggle() {} }, querySelectorAll: () => [] };
  const writes = { recent: 0, blindbox: 0 };
  for (const [name, node] of [['recent', recent], ['blindbox', f.container]]) {
    let html = node.innerHTML || '';
    Object.defineProperty(node, 'innerHTML', {
      get: () => html,
      set(value) { writes[name] += 1; html = value; },
    });
  }
  const nodes = Object.fromEntries([
    'enableGiftNotification', 'giftSprintTarget', 'giftSprintReceived', 'giftSprintRemaining',
    'giftSprintCrystalBalls', 'giftStatusLine', 'giftSprintStatus', 'giftDetectToggle',
  ].map((id) => [id, {}]));
  nodes.giftRecentList = recent;
  const get = f.document.getElementById;
  f.document.getElementById = (id) => nodes[id] || get(id);
  f.window.getComputedStyle = () => ({ gridTemplateColumns: '100px' });
  const panel = f.window.AdminApp.gifts;
  const notices = [];
  const notify = panel.notification.notifyNewGift;
  panel.notification.notifyNewGift = (items) => { notices.push(items.map((item) => item.num)); notify(items); };
  const { createAdminStateRenderer } = await loadModuleExports(path.resolve('public/js/admin/state-renderer.js'), {
    document: {},
  });
  const order = [];
  const render = createAdminStateRenderer({
    renderLive() {},
    renderSettings() { order.push('settings'); },
    renderQueueStyle() {},
    renderGifts(state, changedKeys) {
      order.push('gifts');
      panel.renderGiftPanel(state.gifts, state.giftSprint, state.liveStatus, state.bilibiliDiagnostics, state.settings, changedKeys);
    },
  });
  const state = {
    gifts: { recent: [{ id: 1, gift_id: '1', gift_name: '礼物', unit_price: 1000, total_price: 1000, num: 1 }] },
    giftSprint: {}, liveStatus: {}, bilibiliDiagnostics: {},
    settings: { enableGiftNotification: 'false' },
  };
  render({ state });
  assert.deepEqual(order, ['settings', 'gifts']);
  writes.recent = writes.blindbox = 0;
  for (let index = 0; index < 20; index += 1) {
    state.bilibiliDiagnostics.parsedGiftCount = index;
    render({ state, changedKeys: ['bilibiliDiagnostics'] });
    state.liveStatus.message = `连接状态 ${index}`;
    render({ state, changedKeys: ['liveStatus'] });
  }
  assert.deepEqual(writes, { recent: 0, blindbox: 0 });
  assert.match(nodes.giftStatusLine.textContent, /19/);

  state.gifts.recent[0].num = 2;
  state.gifts.recent[0].total_price = 2000;
  render({ state, changedKeys: ['gifts'] });
  assert.equal(writes.recent, 1);
  assert.equal(writes.blindbox, 0);
  assert.match(recent.innerHTML, /礼物 x2/);
  assert.deepEqual(notices.at(-1), [2]);
  f.window.AdminApp.eventBus.emit('gift:catalog_updated', {
    snapshot: { gifts: [{ id: '1', name: '礼物', imagePath: '/overtime-gift-images/new.webp' }] },
  });
  assert.match(recent.innerHTML, /\/overtime-gift-images\/new.webp/);

  f.textarea.value = JSON.stringify([{ name: '未保存配置', price: 5, outputs: [] }]);
  f.textarea.dataset = { dirty: 'true' };
  render({ state, changedKeys: ['settings'] });
  assert.match(f.container.innerHTML, /未保存配置/);
  assert.equal(f.textarea.dataset.dirty, 'true');
  const beforeMapping = { ...writes };
  f.window.AdminApp.state.getAppState().blindBoxMapping.customCount = 3;
  render({ state, changedKeys: ['blindBoxMapping'] });
  assert.match(f.status.textContent, /自定义 3 项/);
  assert.deepEqual(writes, beforeMapping);
});
