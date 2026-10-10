'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageHandlers } = require('../../src/bilibili/danmaku/message-handlers');
const { BilibiliDanmakuClient } = require('../../src/bilibili/danmaku-client');

function packet(cmd, data) {
  const body = Buffer.from(JSON.stringify({ cmd, data }));
  const frame = Buffer.alloc(16 + body.length);
  frame.writeUInt32BE(frame.length, 0);
  frame.writeUInt16BE(16, 4);
  frame.writeUInt32BE(5, 8);
  frame.writeUInt32BE(1, 12);
  body.copy(frame, 16);
  return frame;
}

function createHandler() {
  return new MessageHandlers({}, {}, null, {
    commandCounts: {}, recentCommands: [], recentGiftLikeCommands: [],
  });
}

test('room likes are absolute snapshots, including repeated, lower and zero counts', async () => {
  const handler = createHandler();
  assert.deepEqual(handler.getLikeState(), { count: null, updatedAt: null });
  for (const count of [3227, 3227, 4000, 8, 0]) {
    await handler.handlePackets(packet('LIKE_INFO_V3_UPDATE:1', { click_count: count }));
    const state = handler.getLikeState();
    assert.equal(state.count, count);
    assert.ok(Number.isFinite(Date.parse(state.updatedAt)));
    state.count = 99;
    assert.equal(handler.getLikeState().count, count, 'readers cannot mutate the snapshot');
  }
});

test('individual clicks and invalid totals do not change the room like snapshot', async () => {
  const handler = createHandler();
  await handler.handlePackets(packet('LIKE_INFO_V3_UPDATE', { click_count: 42 }));
  const state = handler.getLikeState();
  for (const count of [undefined, null, true, '43', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
    await handler.handlePackets(packet('LIKE_INFO_V3_UPDATE', { click_count: count }));
    assert.deepEqual(handler.getLikeState(), state);
  }
  await handler.handlePackets(Buffer.concat([
    packet('LIKE_INFO_V3_CLICK', { uid: 123, like_count: 1, click_count: 100 }),
    packet('LIKE_INFO_V3_UPDATE_UNKNOWN', { click_count: 200 }),
    packet('LIKE_INFO_V3_UPDATE', null),
  ]));
  assert.deepEqual(handler.getLikeState(), state);
});

test('connection and live boundaries clear the last like snapshot', async () => {
  const handler = createHandler();
  for (const reset of [
    () => handler.updateConnectionGeneration(2),
    () => handler.updateConnectionAttempt(2),
    () => handler.handlePackets(packet('PREPARING', {})),
    () => handler.handlePackets(packet('LIVE', {})),
    () => handler.destroy(),
  ]) {
    await handler.handlePackets(packet('LIKE_INFO_V3_UPDATE', { click_count: 42 }));
    await reset();
    assert.deepEqual(handler.getLikeState(), { count: null, updatedAt: null });
  }
});

test('client exposes likes only while the current socket is open and authenticated', async (t) => {
  t.mock.method(console, 'info', () => {});
  const client = new BilibiliDanmakuClient('123', {}, { userInfoService: {} });
  t.after(() => client.stop());
  const unknown = { roomId: '123', count: null, updatedAt: null, connected: false };
  assert.deepEqual(client.getLikeState(), unknown);
  client.resolvedRoomId = '456';
  unknown.roomId = '456';
  client.stopped = false;
  const socket = { readyState: 1, close() { this.readyState = 3; } };
  client.wsConnection.ws = socket;
  client.wsConnection.connectionTrace = { authStatus: 'pending' };
  await client.messageHandlers.handlePackets(packet('LIKE_INFO_V3_UPDATE', { click_count: 42 }));
  assert.deepEqual(client.getLikeState(), unknown);
  client.wsConnection.connectionTrace.authStatus = 'accepted';
  assert.deepEqual(client.getLikeState(), {
    ...client.messageHandlers.getLikeState(), roomId: '456', connected: true,
  });
  socket.readyState = 3;
  assert.deepEqual(client.getLikeState(), unknown);
  socket.readyState = 1;
  client.wsConnection.connectionTrace.authStatus = 'rejected';
  assert.deepEqual(client.getLikeState(), unknown);
  client.wsConnection.connectionTrace.authStatus = 'accepted';
  client.messageHandlers.updateConnectionAttempt(2);
  assert.deepEqual(client.getLikeState(), { ...unknown, connected: true });
  await client.messageHandlers.handlePackets(packet('LIKE_INFO_V3_UPDATE', { click_count: 5 }));
  client.stop();
  assert.deepEqual(client.getLikeState(), unknown);
  assert.deepEqual(client.messageHandlers.getLikeState(), { count: null, updatedAt: null });
});
