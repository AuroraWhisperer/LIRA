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
  const panel = f.gifts;
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
  f.stateService.getAppState().blindBoxMapping.customCount = 3;
  render({ state, changedKeys: ['blindBoxMapping'] });
  assert.match(f.status.textContent, /自定义 3 项/);
  assert.deepEqual(writes, beforeMapping);
});

test('gift panel renders through imported modules after the legacy registry is replaced', async () => {
  const nodes = new Map(
    [
      'giftSprintTarget',
      'giftSprintReceived',
      'giftSprintRemaining',
      'giftSprintCrystalBalls',
      'enableGiftNotification',
    ].map((id) => [id, {}]),
  );
  nodes.set('giftSprintTextPreview', { classList: { toggle() {} } });
  nodes.set('giftSprintOverlayStatus', {});
  const window = { addEventListener() {} };
  const { renderGiftPanel } = await loadModuleExports(path.resolve('public/js/admin/gifts/index.js'), {
    window,
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: (id) => nodes.get(id) || null,
      querySelectorAll: () => [],
    },
    fetch: async () => ({ ok: true, text: async () => JSON.stringify({ ok: true, data: [] }) }),
  });
  window.AdminApp.gifts = {};
  renderGiftPanel(
    { recent: [] },
    {
      targetRmb: 100,
      receivedRmb: 40,
      remainingRmb: 60,
      remainingCrystalBalls: 1,
    },
    {},
    {},
    { enableGiftNotification: 'false' },
  );
  assert.equal(nodes.get('giftSprintReceived').textContent, '¥40.00');
  assert.equal(nodes.get('giftSprintCrystalBalls').textContent, '1 个');
  assert.equal(nodes.get('giftSprintTextPreview').textContent, '还差 1 个水晶球');
  assert.equal(nodes.get('enableGiftNotification').checked, false);
});

test('gift detection updates its switch without a redundant state label and keeps connection errors visible', async () => {
  const toggle = { checked: true };
  const status = {};
  const { giftDetection } = await loadModuleExports(path.join(__dirname, '../../public/js/admin/gifts/detection.js'), {
    document: {
      getElementById: (id) => ({ giftDetectToggle: toggle, giftSprintStatus: status })[id] || null,
    },
  });

  giftDetection.renderDetectionStatus({ enabled: false }, {});
  assert.equal(toggle.checked, false);
  assert.equal(status.textContent, '未开启');

  giftDetection.renderDetectionStatus({ enabled: true }, { connected: true, message: '未开播，历史消息监听中' });
  assert.equal(toggle.checked, true);
  assert.equal(status.textContent, '待开播');
  assert.equal(status.title, '未开播，历史消息监听中');

  giftDetection.renderDetectionStatus({ enabled: true }, { connected: false, message: '连接失败，请重试' });
  assert.equal(status.textContent, '连接失败，请重试');
});

test('gift panel renders empty and populated recent gifts without legacy history registration', async (t) => {
  const list = {
    innerHTML: '',
    classList: { toggle: t.mock.fn() },
    querySelectorAll: () => [],
  };
  const gifts = {};
  const sprintNodes = new Map(
    ['giftSprintTarget', 'giftSprintReceived', 'giftSprintRemaining', 'giftSprintCrystalBalls'].map((id) => [id, {}]),
  );
  const globals = {
    console: { error: t.mock.fn() },
    window: {
      addEventListener() {},
      AdminApp: {
        gifts,
        utils: {
          escapeHtml: (value) => String(value),
          formatTime: (value) => String(value),
          formatMoney: (value) => String(value),
        },
      },
      getComputedStyle: () => ({ gridTemplateColumns: '270px 270px' }),
    },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: (id) => (id === 'giftRecentList' ? list : sprintNodes.get(id) || null),
    },
    fetch: async () => ({ ok: true, text: async () => JSON.stringify({ ok: true, data: { gifts: [] } }) }),
  };
  const { renderGiftPanel, giftNotification } = await loadModuleExports(
    path.join(__dirname, '../helpers/gift-admin-graph.js'),
    globals,
  );
  t.mock.method(giftNotification, 'notifyNewGift');

  assert.equal(gifts.history, undefined);
  renderGiftPanel({ recent: [] }, {}, {}, {});

  assert.match(list.innerHTML, /class="empty gift-recent-empty"/);
  assert.deepEqual([...list.classList.toggle.mock.calls.at(-1).arguments], ['is-empty', true]);

  const items = [
    {
      gift_name: 'Example gift',
      user_name: 'Test viewer',
      num: 2,
      total_price: 10,
      created_at: '2026-09-05T12:00:00.000Z',
    },
  ];
  renderGiftPanel({ recent: items }, {}, {}, {});

  assert.match(list.innerHTML, /class="gift-card-content"/);
  assert.match(list.innerHTML, /Example gift x2/);
  assert.match(list.innerHTML, /Test viewer/);
  assert.doesNotMatch(list.innerHTML, /gift-recent-empty/);
  assert.deepEqual([...list.classList.toggle.mock.calls.at(-1).arguments], ['is-empty', false]);
  assert.equal(giftNotification.notifyNewGift.mock.callCount(), 2);
  assert.equal(giftNotification.notifyNewGift.mock.calls.at(-1).arguments[0], items);
  assert.equal(globals.console.error.mock.callCount(), 0);
});
