'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDanmakuSenderService,
  DANMAKU_MESSAGE_LIMIT
} = require('../src/bilibili/danmaku/sender-service');
const { buildMentionedMessage } = require('../src/bilibili/danmaku/mention-policy');

test('mention policy formats a visible mention without transport dependencies', () => {
  assert.deepEqual(
    buildMentionedMessage('选中了一首歌', { uid: '42', name: 'Alice' }),
    { message: '@Alice 选中了一首歌', target: { uid: '42', name: 'Alice' } }
  );
});

test('sender service gets the mention target only when requested', async () => {
  let targetReads = 0;
  const calls = [];
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => {
      targetReads += 1;
      return { uid: '42', name: 'Alice', source: 'random' };
    },
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      sendDanmaku: async (roomId, message, target) => {
        calls.push({ roomId, message, target });
        return { message, replyMid: target.uid, replyUname: target.name };
      }
    }),
    minIntervalMs: 0,
    log() {}
  });

  await service.send({ message: 'hello', mentionRequester: false });
  await service.send({ message: 'reply', mentionRequester: true });

  assert.equal(targetReads, 1);
  assert.deepEqual(calls[0].target, { uid: '', name: '', source: '', createdAt: '' });
  assert.equal(calls[1].target.uid, '42');
});

test('sender service splits long admin messages into Bilibili-sized chunks', async () => {
  const calls = [];
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => ({ uid: '42', name: 'Alice', source: 'random' }),
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      sendDanmaku: async (roomId, message, target) => {
        calls.push({ roomId, message, target });
        return { message, replyMid: target.uid, replyUname: target.name };
      }
    }),
    minIntervalMs: 0,
    log() {}
  });

  const result = await service.send({ message: '1234567890'.repeat(8), mentionRequester: true });

  assert.equal(result.count, 2);
  assert.equal(result.messages.length, 2);
  assert.ok(calls.every((call) => Array.from(call.message).length <= DANMAKU_MESSAGE_LIMIT));
  assert.equal(calls[0].target.uid, '42');
  assert.deepEqual(calls[1].target, { uid: '', name: '', source: '', createdAt: '' });
  assert.equal(result.message, '1234567890'.repeat(8));
});

test('sender service accepts the current requester as an explicit mention target', async () => {
  const calls = [];
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => {
      assert.fail('automatic replies should not read the latest requester');
    },
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      sendDanmaku: async (roomId, message, target) => {
        calls.push({ roomId, message, target });
        return { message, replyMid: target.uid, replyUname: target.name };
      }
    }),
    minIntervalMs: 0,
    log() {}
  });

  await service.send({
    message: '请调整组合条件后再试。',
    mentionTarget: { uid: '789', name: '当前点歌人' }
  });

  assert.equal(calls[0].message, '请调整组合条件后再试。');
  assert.deepEqual(calls[0].target, {
    uid: '789',
    name: '当前点歌人',
    source: '',
    createdAt: ''
  });
});

test('sender state exposes only the stable UI contract', async () => {
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'secret-cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: false, message: 'reconnecting' }),
    getMentionTarget: async () => null,
    createClient: () => ({
      fetchCurrentUserName: async () => '',
      resolveRoomInfo: async () => ({ roomId: 123, ownerName: '' })
    })
  });
  const state = await service.getState();

  assert.equal(state.canSend, true);
  assert.equal(state.connected, false);
  assert.equal('cookieHeader' in state, false);
  assert.deepEqual(state.requester, { uid: '', name: '', source: '', createdAt: '' });
});

test('sender state exposes account and room display names when available', async () => {
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'secret-cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => null,
    createClient: () => ({
      fetchCurrentUserName: async () => '主播小号',
      resolveRoomInfo: async () => ({ roomId: 123, ownerName: '直播间主人' })
    }),
    log() {}
  });
  const state = await service.getState();

  assert.equal(state.accountName, '主播小号');
  assert.equal(state.roomName, '直播间主人');
});
