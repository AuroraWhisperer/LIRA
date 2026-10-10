const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { FakeNode, allNodes } = require('../helpers/fake-dom');
const { createSceneDanmakuDisplay } = require('../../public/js/overlays/scene-danmaku-display.js');
const { createCloudDisplayBuffer } = require('../../src/scenes/cloud-display-buffer');

test('entry events cross the display buffer only within the active session and opt in per component', () => {
  const buffer = createCloudDisplayBuffer({ getOwner: () => ({ scope: 'tenant', epoch: 1 }) });
  const envelope = { ownerScope: 'tenant', authorizationEpoch: 1, connectionEpoch: 'connection', status: 'connected' };
  buffer.receive({ ...envelope, status: 'connecting' });
  buffer.receive({ ...envelope, event: { type: 'overlay-state', style: 'signal', liveStatus: 1, state: 'running',
    liveSessionId: 'session', confirmationMessage: '开始' } });
  const cursor = buffer.getSnapshot();
  const event = { type: 'entry', name: '新观众', guardLevel: 3, liveSessionId: 'session', timestamp: new Date().toISOString(), uid: 'private' };
  assert.equal(buffer.receive({ ...envelope, event: { ...event, liveSessionId: 'old' } }), false);
  assert.equal(buffer.receive({ ...envelope, event }), true);
  const snapshot = buffer.getSnapshot({ epoch: cursor.epoch, cursor: cursor.nextCursor });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].uid, undefined);
  for (const style of ['signal', 'glow', 'floating']) {
    for (const enabled of [false, true]) {
      const items = [];
      const display = createSceneDanmakuDisplay({ clear: () => { items.length = 0; }, append: item => items.push(item),
        status() {}, getStyle: () => style, showEntryMessages: () => enabled });
      display.update(snapshot);
      assert.equal(items.filter(item => item.kind === 'entry').length, Number(enabled));
      if (enabled) assert.equal(items.at(-1).message, '进入了直播间');
    }
  }
  assert.deepEqual(buffer.getSnapshot().events, [], 'new viewers do not replay buffered entrances');
});

test('scene display retains session boundaries and filters gifts/SC without simulating messages', () => {
  const items = [];
  const display = createSceneDanmakuDisplay({ clear: () => { items.length = 0; }, append: (item) => items.push(item),
    status: () => {}, getStyle: () => 'signal' });
  const state = { status: 'connected', epoch: 'one', state: { liveStatus: 1, liveSessionId: 'live', confirmationMessage: '开播' }, events: [] };
  display.update(state);
  assert.equal(items.length, 1);
  display.update({ ...state, events: [{ type: 'gift', liveSessionId: 'live', giftName: '花', giftCount: 2 },
    { type: 'danmaku', liveSessionId: 'other', message: 'Wrong owner' }] });
  assert.equal(items.length, 2);
  assert.equal(items[1].message, '送出 花 × 2');
  display.update({ ...state, status: 'offline' });
  assert.equal(items.length, 0);
});

test('scene SC deletion targets only current-session SC without replaying confirmation or entries', () => {
  let items = [];
  let clears = 0;
  const messageId = 'a'.repeat(64);
  const display = createSceneDanmakuDisplay({
    clear() { items = []; clears += 1; },
    append(item) { items.push(item); },
    remove(ids) { items = items.filter(item => item.kind !== 'superchat' || !ids.includes(item.messageId)); },
    status() {}, getStyle: () => 'signal', showEntryMessages: () => true,
  });
  const snapshot = { status: 'connected', epoch: 'one', state: { liveStatus: 1, liveSessionId: 'live', confirmationMessage: '开播' } };
  display.update({ ...snapshot, events: [
    { type: 'danmaku', liveSessionId: 'live', message: '聊天' },
    { type: 'entry', liveSessionId: 'live', name: '新观众' },
    { type: 'superchat', liveSessionId: 'live', message: '撤下', messageId },
    { type: 'superchat', liveSessionId: 'live', message: '旧服务端没有 ID' },
  ] });
  const retained = items.filter(item => item.messageId !== messageId);
  const deletion = { type: 'superchat-delete', liveSessionId: 'live', messageIds: [messageId] };
  display.update({ ...snapshot, events: [{ ...deletion, liveSessionId: 'other' }] });
  assert.equal(items.length, 5);
  display.update({ ...snapshot, events: [deletion, deletion] });
  assert.deepEqual(items, retained);
  assert.equal(clears, 1);
});

test('both imported CSS chat engines remove only matching SC DOM nodes', async () => {
  for (const engine of ['blc', 'blivechat']) {
    const createNode = (tag) => {
      const node = new FakeNode(tag);
      Object.defineProperty(node, 'parentElement', { get: () => node.parent });
      node.classList = { add() {}, remove() {}, toggle() {} };
      return node;
    };
    const host = createNode('div');
    const listeners = new Map();
    const window = { parent: { postMessage() {} }, addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name), dispatchEvent() {}, Event: class {} };
    await loadModuleExports(path.resolve(__dirname, '../../public/js/overlays/imported-danmaku.js'), {
      document: { defaultView: window, getElementById: () => host, createElement: createNode,
        createTextNode: text => Object.assign(createNode('text'), { textContent: text }),
        body: createNode('body'), documentElement: createNode('html'), head: createNode('head'), querySelectorAll: () => [],
        addEventListener() {}, removeEventListener() {} },
      window, URL, URLSearchParams,
      location: { search: '?componentPreview=1&sceneComponent=1', pathname: '/imported-danmaku', href: 'http://127.0.0.1:3000/imported-danmaku' },
      clearTimeout() {},
    });
    const send = data => listeners.get('message')({ source: window.parent, origin: 'http://127.0.0.1:3000', data });
    await send({ type: 'component-preview:init', config: { cssStyle: { engine } } });
    const messageId = 'a'.repeat(64);
    const snapshot = { status: 'connected', epoch: 'one', state: { liveStatus: 1, liveSessionId: 'live', confirmationMessage: '开播' } };
    await send({ type: 'component-preview:data', data: { ...snapshot, events: [
      { type: 'danmaku', liveSessionId: 'live', message: '聊天' },
      { type: 'superchat', liveSessionId: 'live', message: '撤下', messageId, price: 30 },
      { type: 'superchat', liveSessionId: 'live', message: '旧服务器 SC', price: 30 },
    ] } });
    const items = allNodes(host).find(node => node.className === 'danmaku-list' || node.id === 'items');
    assert.equal(items.children.length, 4, engine);
    const retained = items.children.filter(node => node.dataset.superchatMessageId !== messageId);
    const deletion = { type: 'superchat-delete', liveSessionId: 'live', messageIds: [messageId] };
    await send({ type: 'component-preview:data', data: { ...snapshot, events: [deletion, deletion] } });
    assert.deepEqual(items.children, retained, engine);
    await send({ type: 'component-preview:dispose' });
  }
});
