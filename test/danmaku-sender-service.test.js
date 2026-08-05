'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDanmakuSenderService } = require('../src/bilibili/danmaku/sender-service');
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

test('sender state exposes only the stable UI contract', async () => {
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'secret-cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: false, message: 'reconnecting' }),
    getMentionTarget: async () => null,
    createClient() { throw new Error('not used'); }
  });
  const state = await service.getState();

  assert.equal(state.canSend, true);
  assert.equal(state.connected, false);
  assert.equal('cookieHeader' in state, false);
  assert.deepEqual(state.requester, { uid: '', name: '', source: '', createdAt: '' });
});
