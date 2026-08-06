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

  assert.equal(result.count, 3);
  assert.equal(result.messages.length, 3);
  assert.ok(calls.every((call) => Array.from(call.message).length <= DANMAKU_MESSAGE_LIMIT));
  assert.ok(Array.from(`@Alice ${calls[0].message}`).length <= DANMAKU_MESSAGE_LIMIT);
  assert.equal(calls[0].target.uid, '42');
  assert.deepEqual(calls[1].target, { uid: '', name: '', source: '', createdAt: '' });
  assert.equal(result.message, '1234567890'.repeat(8));
});

test('sender service repeats an AI mention on every 40-character chunk', async () => {
  const calls = [];
  const target = { uid: '42', name: 'Alice', source: 'xiaomi-ai' };
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => null,
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      sendDanmaku: async (roomId, message, replyTarget) => {
        calls.push({ roomId, message, target: replyTarget });
        return { message, replyMid: replyTarget.uid, replyUname: replyTarget.name };
      }
    }),
    minIntervalMs: 0,
    delay: async () => {},
    log: () => {}
  });
  await service.send({ message: '猫'.repeat(70), mentionTarget: target, mentionEveryChunk: true, intervalMs: 3000 });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.target.uid === '42'));
  assert.ok(calls.every((call) => Array.from(`@Alice ${call.message}`).length <= DANMAKU_MESSAGE_LIMIT));
  assert.equal(calls.map((call) => call.message).join(''), '猫'.repeat(70));
});

test('sender service keeps emoji and symbols intact while splitting a DIY reply after the mention', async () => {
  const calls = [];
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => null,
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
  const message = `${'\u{1F680}!@#$%^&*()'.repeat(6)} DIY`;
  const target = { uid: '789', name: '主播名字很长😀' };

  const result = await service.send({ message, mentionTarget: target });

  assert.equal(result.message, message);
  assert.ok(calls.length > 1);
  assert.ok(calls.every((call) => !call.message.includes('\uFFFD')));
  assert.ok(calls.every((call) => Array.from(call.message).length <= DANMAKU_MESSAGE_LIMIT));
  assert.ok(Array.from(`@${target.name} ${calls[0].message}`).length <= DANMAKU_MESSAGE_LIMIT);
  assert.equal(calls[0].target.uid, target.uid);
  assert.ok(calls.slice(1).every((call) => call.target.uid === ''));
});

test('sender service splits long fortune and check-in replies after reserving the mention length', async () => {
  const calls = [];
  const longName = '名字很长也不能挤掉签文的观众';
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => null,
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
  const messages = [
    '上上签·云开见日｜守得云开见月明，眼前的阻滞正在渐渐散去。宜乘势而为，把握已经出现的机会；忌得意忘形，忽略同行之人。',
    '已签到 128 天。愿你今日所行皆坦途，所遇皆温暖，认真生活也被生活温柔以待。'
  ];

  for (const message of messages) {
    calls.length = 0;
    const result = await service.send({
      message,
      mentionTarget: { uid: '789', name: longName }
    });

    assert.ok(result.count > 1);
    assert.ok(Array.from(`@${longName} ${calls[0].message}`).length <= DANMAKU_MESSAGE_LIMIT);
    assert.ok(calls.slice(1).every((call) => Array.from(call.message).length <= DANMAKU_MESSAGE_LIMIT));
    assert.equal(calls[0].target.uid, '789');
    assert.ok(calls.slice(1).every((call) => call.target.uid === ''));
    assert.equal(result.message, message);
  }
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
    getFortuneBotEnabled: () => true,
    getCustomReplyBotEnabled: () => true,
    createClient: () => ({
      fetchCurrentUserName: async () => '',
      resolveRoomInfo: async () => ({ roomId: 123, ownerName: '' })
    })
  });
  const state = await service.getState();

  assert.equal(state.canSend, true);
  assert.equal(state.connected, false);
  assert.equal(state.fortuneBotEnabled, true);
  assert.equal(state.customReplyBotEnabled, true);
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
