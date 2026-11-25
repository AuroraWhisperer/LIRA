'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createBlindboxFixture, flushBlindboxTasks } = require('../helpers/frontend-blindbox-fixture');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('official catalog push wins over the shared cold-start read', async () => {
  const pending = Promise.withResolvers();
  const f = await createBlindboxFixture({ catalogResponse: pending.promise });
  const snapshot = {
    gifts: [{ id: '1', name: 'New box', giftCategory: 'blindBox' }],
    blindBoxes: [{ giftId: '1', outputGiftIds: ['2'] }],
  };
  f.eventBus.emit('gift:catalog_updated', { snapshot });
  assert.match(f.container.innerHTML, /New box/);
  pending.resolve({ ok: true, data: { gifts: [], blindBoxes: [] } });
  await flushBlindboxTasks();
  assert.deepEqual({ reads: f.fetchCalls.filter(call => call.url.endsWith('/catalog')).length,
    hasNewBox: f.container.innerHTML.includes('New box') }, { reads: 1, hasNewBox: true });
});

test('room sale arriving before the official read preserves both catalog projections', async () => {
  const pending = Promise.withResolvers();
  const f = await createBlindboxFixture({ roomId: '123', catalogResponse: pending.promise });
  const roomBox = { id: '101', variantId: 'box-a', name: 'Room box', giftCategory: 'blindBox' };
  const otherBox = { id: '102', variantId: 'box-b', name: 'Catalog box', giftCategory: 'blindBox' };
  const roomImage = '/overtime-gift-images/room-new.webp';
  const otherImage = '/overtime-gift-images/full-only.webp';
  await f.resolveRefresh({ roomId: '123', gifts: [{ ...roomBox, imagePath: roomImage }] });
  assert.equal(f.findGiftArtwork(roomBox.id, roomBox.name, roomBox.variantId), roomImage);

  pending.resolve({ ok: true, data: {
    schemaVersion: 3, roomId: '', blindBoxes: [],
    gifts: [
      { ...roomBox, imagePath: '/overtime-gift-images/room-old.webp' },
      { ...otherBox, imagePath: otherImage },
      { id: '103', variantId: 'prize', name: 'Prize' },
    ],
    variantBlindBoxes: [roomBox, otherBox].map(({ variantId }) => ({ variantId, outputVariantIds: ['prize'] })),
  } });
  await flushBlindboxTasks();
  assert.deepEqual({
    availableBoxes: f.visibleNames(),
    containsOtherBox: f.container.innerHTML.includes(otherBox.name),
    roomArtwork: f.findGiftArtwork(roomBox.id, roomBox.name, roomBox.variantId),
    otherArtwork: f.findGiftArtwork(otherBox.id, otherBox.name, otherBox.variantId),
  }, { availableBoxes: [roomBox.name], containsOtherBox: true, roomArtwork: roomImage, otherArtwork: otherImage });
  const requests = f.fetchCalls.filter(({ url }) => url.startsWith('/api/overtime/gifts/'));
  assert.deepEqual(requests.map(({ url, options }) => `${options.method || 'GET'} ${url}`).sort(), [
    'GET /api/overtime/gifts/catalog', 'POST /api/overtime/gifts/refresh',
  ]);
});

test('gift subviews skip unrelated state updates while corrections, catalogs and drafts still render', async () => {
  const recent = { isConnected: true, closest: () => null, classList: { toggle() {} }, querySelectorAll: () => [] };
  const f = await createBlindboxFixture({ recentList: recent });
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
    'giftSprintCrystalBalls', 'giftSprintStatus', 'giftDetectToggle',
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
    renderQueue() {},
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

  state.gifts.recent[0].num = 2;
  state.gifts.recent[0].total_price = 2000;
  render({ state, changedKeys: ['gifts'] });
  assert.equal(writes.recent, 1);
  assert.equal(writes.blindbox, 0);
  assert.match(recent.innerHTML, /礼物 x2/);
  assert.deepEqual(notices.at(-1), [2]);
  f.eventBus.emit('gift:catalog_updated', {
    snapshot: { gifts: [{ id: '1', name: '礼物', imagePath: '/overtime-gift-images/new.webp' }] },
  });
  assert.match(recent.innerHTML, /\/overtime-gift-images\/new.webp/);

  const beforeHiding = writes.recent;
  f.document.hidden = true;
  f.document.dispatchEvent({ type: 'visibilitychange' });
  for (const num of [3, 4]) {
    state.gifts.recent[0].num = num;
    render({ state, changedKeys: ['gifts'] });
  }
  assert.equal(writes.recent, beforeHiding);
  f.document.hidden = false;
  f.document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(writes.recent, beforeHiding + 1);
  assert.match(recent.innerHTML, /礼物 x4/);

  f.textarea.value = JSON.stringify([{ name: '未保存配置', price: 5, outputs: [] }]);
  f.textarea.dataset = { dirty: 'true' };
  render({ state, changedKeys: ['settings'] });
  assert.match(f.container.innerHTML, /未保存配置/);
  assert.equal(f.textarea.dataset.dirty, 'true');
  const beforeMapping = { ...writes };
  const previousStatus = f.status.textContent;
  f.stateService.getAppState().blindBoxMapping.customCount = 3;
  render({ state, changedKeys: ['blindBoxMapping'] });
  assert.notEqual(f.status.textContent, previousStatus);
  assert.deepEqual(writes, beforeMapping);
});
