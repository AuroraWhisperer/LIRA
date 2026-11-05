const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { FakeNode, allNodes } = require('../helpers/fake-dom');
const { createSceneDanmakuDisplay } = require('../../public/js/overlays/scene-danmaku-display.js');
const { createCloudDisplayBuffer } = require('../../src/scenes/cloud-display-buffer');

test('mist and comic scene output include SC and forward its deletion; other random and floating styles omit SC', () => {
  for (const style of ['mist', 'comic', 'outline', 'floating']) {
    const items = [];
    const deleted = [];
    const display = createSceneDanmakuDisplay({ clear() {}, append: item => items.push(item),
      remove: ids => deleted.push(...ids), status() {}, getStyle: () => style });
    const snapshot = { status: 'connected', epoch: 'mist-test', state: { liveStatus: 1, liveSessionId: 'live' } };
    display.update({ ...snapshot, events: [
      { type: 'superchat', liveSessionId: 'live', messageId: 'sc', message: '原文\n第二行', price: 30 },
      { type: 'superchat', liveSessionId: 'old', messageId: 'old-sc', message: '旧场次', price: 30 },
    ] });
    assert.equal(items.length, ['mist', 'comic'].includes(style) ? 1 : 0);
    if (items.length) assert.equal(items[0].message, '原文\n第二行');
    display.update({ ...snapshot, events: [{ type: 'superchat-delete', liveSessionId: 'live', messageIds: ['sc'] }] });
    assert.deepEqual(deleted, ['sc']);
  }
});

test('scene room identity comes only from authorized room state and clears while offline', () => {
  const rooms = [];
  const display = createSceneDanmakuDisplay({ clear() {}, append() {}, status() {}, getStyle: () => 'twitter',
    room: (roomId) => rooms.push(roomId) });
  const state = { liveStatus: 1, liveSessionId: 'live', roomGuard: { roomId: '123' } };
  display.update({ status: 'connected', epoch: 'one', state, events: [] });
  display.update({ status: 'offline', epoch: 'one', events: [] });
  assert.deepEqual(rooms, ['123', '']);
});

test('welcome echoes cross the display buffer and opt in per component without hiding ordinary chat', () => {
  const buffer = createCloudDisplayBuffer({ getOwner: () => ({ scope: 'tenant', epoch: 1 }) });
  const envelope = { ownerScope: 'tenant', authorizationEpoch: 1, connectionEpoch: 'connection', status: 'connected' };
  buffer.receive({ ...envelope, status: 'connecting' });
  buffer.receive({ ...envelope, event: { type: 'overlay-state', style: 'signal', liveStatus: 1, state: 'running',
    liveSessionId: 'session', confirmationMessage: '开始' } });
  const cursor = buffer.getSnapshot();
  const event = { type: 'danmaku', name: '欢迎机器人', message: '欢迎 新观众 来到直播间～', isWelcome: true,
    liveSessionId: 'session', timestamp: new Date().toISOString(), uid: 'private' };
  assert.equal(buffer.receive({ ...envelope, event: { ...event, liveSessionId: 'old' } }), false);
  assert.equal(buffer.receive({ ...envelope, event }), true);
  for (const other of [
    { ...event, isWelcome: false, name: '普通观众' },
    { type: 'gift', giftName: '花', giftCount: 2 },
    { type: 'superchat', message: 'SC', price: 30 },
    { type: 'entry', name: '原始进房提示', guardLevel: 3 },
  ]) buffer.receive({ ...envelope, event: { ...other, liveSessionId: 'session' } });
  const snapshot = buffer.getSnapshot({ epoch: cursor.epoch, cursor: cursor.nextCursor });
  assert.equal(snapshot.events.length, 5);
  assert.equal(snapshot.events[0].uid, undefined);
  assert.equal(snapshot.events[0].isWelcome, true);
  for (const enabled of [undefined, false, true]) {
    const items = [];
    let visible = enabled;
    const display = createSceneDanmakuDisplay({ clear: () => { items.length = 0; }, append: item => items.push(item),
      status() {}, getStyle: () => 'signal', showWelcomeMessages: enabled === undefined ? undefined : () => visible });
    display.update(snapshot);
    assert.equal(items.filter(item => item.isWelcome).length, Number(enabled !== false));
    assert.equal(items.some(item => item.kind === 'entry'), false);
    assert.deepEqual(items.filter(item => !item.isWelcome).map(item => item.kind), ['system', 'danmaku', 'gift', 'superchat']);
    if (enabled !== undefined) {
      visible = !enabled;
      display.update({ ...snapshot, events: [event] });
      assert.equal(items.filter(item => item.isWelcome).length, 1, 'subsequent echoes use the current toggle');
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
  assert.equal(items.length, 2);
  display.update({ ...state, state: { liveStatus: 0, liveSessionId: null } });
  assert.equal(items.length, 0);
});

test('temporary disconnects and cursor gaps retain messages without repeating the live confirmation', () => {
  const items = [];
  const statuses = [];
  const display = createSceneDanmakuDisplay({ clear() { items.length = 0; }, append: item => items.push(item),
    status: (text, connected) => statuses.push(connected), getStyle: () => 'signal' });
  const snapshot = { status: 'connected', epoch: 'one', state: { liveStatus: 1, liveSessionId: 'live', confirmationMessage: '开播' } };
  display.update({ ...snapshot, events: [{ type: 'danmaku', liveSessionId: 'live', message: '保留已有弹幕' }] });
  const retained = [...items];
  display.update({ status: 'offline', epoch: 'one', reset: true, gap: true, state: null, events: [] });
  assert.deepEqual(items, retained);
  assert.equal(statuses.at(-1), false);
  display.update({ status: 'connecting', epoch: 'one', state: null, events: [] });
  display.update({ ...snapshot, state: { liveStatus: null, liveSessionId: null }, events: [] });
  assert.deepEqual(items, retained);
  assert.equal(statuses.at(-1), false);
  display.update({ ...snapshot, reset: true, gap: true, events: [] });
  assert.deepEqual(items, retained);
  assert.equal(statuses.at(-1), true);
  display.update({ ...snapshot, events: [{ type: 'danmaku', liveSessionId: 'live', message: '恢复后的新弹幕' }] });
  assert.deepEqual(items.slice(0, -1), retained);
  assert.equal(items.at(-1).message, '恢复后的新弹幕');
  display.update({ ...snapshot, epoch: 'other-owner', reset: true, events: [] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'system');
  display.update({ status: 'offline', epoch: null, reset: true, events: [] });
  assert.deepEqual(items, []);
});

test('scene SC deletion targets only current-session SC without replaying confirmation or entries', () => {
  let items = [];
  let clears = 0;
  const messageId = 'a'.repeat(64);
  const display = createSceneDanmakuDisplay({
    clear() { items = []; clears += 1; },
    append(item) { items.push(item); },
    remove(ids) { items = items.filter(item => item.kind !== 'superchat' || !ids.includes(item.messageId)); },
    status() {}, getStyle: () => 'signal', showWelcomeMessages: () => true,
  });
  const snapshot = { status: 'connected', epoch: 'one', state: { liveStatus: 1, liveSessionId: 'live', confirmationMessage: '开播' } };
  display.update({ ...snapshot, events: [
    { type: 'danmaku', liveSessionId: 'live', message: '聊天' },
    { type: 'danmaku', liveSessionId: 'live', name: '机器人', message: '欢迎新观众', isWelcome: true },
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

test('both imported CSS chat engines apply welcome visibility and remove only matching SC DOM nodes', async () => {
  for (const [engine, enabled] of [['blc', undefined], ['blc', false], ['blc', true],
    ['blivechat', undefined], ['blivechat', false], ['blivechat', true]]) {
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
    const id = '12345678-1234-1234-1234-123456789abc';
    await send({ type: 'component-preview:init', config: { cssStyle: { engine, id },
      ...(enabled === undefined ? {} : { styleParameters: { [`css:${id}`]: { showEntryMessages: enabled } } }) } });
    const messageId = 'a'.repeat(64);
    const snapshot = { status: 'connected', epoch: 'one', state: { liveStatus: 1, liveSessionId: 'live', confirmationMessage: '开播' } };
    await send({ type: 'component-preview:data', data: { ...snapshot, events: [
      { type: 'danmaku', liveSessionId: 'live', message: '聊天' },
      { type: 'danmaku', liveSessionId: 'live', name: '机器人', message: '欢迎新观众', isWelcome: true },
      { type: 'entry', liveSessionId: 'live', name: '原始进房提示' },
      { type: 'superchat', liveSessionId: 'live', message: '撤下', messageId, price: 30 },
      { type: 'superchat', liveSessionId: 'live', message: '旧服务器 SC', price: 30 },
    ] } });
    const items = allNodes(host).find(node => node.className === 'danmaku-list' || node.id === 'items');
    assert.equal(items.children.length, 4 + Number(enabled !== false), engine);
    const retained = items.children.filter(node => node.dataset.superchatMessageId !== messageId);
    const deletion = { type: 'superchat-delete', liveSessionId: 'live', messageIds: [messageId] };
    await send({ type: 'component-preview:data', data: { ...snapshot, events: [deletion, deletion] } });
    assert.deepEqual(items.children, retained, engine);
    await send({ type: 'component-preview:dispose' });
  }
});
