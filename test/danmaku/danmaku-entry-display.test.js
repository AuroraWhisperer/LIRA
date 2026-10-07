const test = require('node:test');
const assert = require('node:assert/strict');
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
