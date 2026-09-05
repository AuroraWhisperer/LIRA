'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDanmakuSenderService,
  DANMAKU_MESSAGE_LIMIT,
  splitDanmakuEveryMentionMessage,
} = require('../src/bilibili/danmaku/sender-service');
const {
  buildMentionedMessage,
} = require('../src/bilibili/danmaku/mention-policy');

test('mention policy formats a visible mention without transport dependencies', () => {
  assert.deepEqual(
    buildMentionedMessage('选中了一首歌', { uid: '42', name: 'Alice' }),
    { message: '@Alice 选中了一首歌', target: { uid: '42', name: 'Alice' } },
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
      },
    }),
    minIntervalMs: 0,
    log() {},
  });

  await service.send({ message: 'hello', mentionRequester: false });
  await service.send({ message: 'reply', mentionRequester: true });

  assert.equal(targetReads, 1);
  assert.deepEqual(calls[0].target, {
    uid: '',
    name: '',
    source: '',
    createdAt: '',
  });
  assert.equal(calls[1].target.uid, '42');
});

test('sender service accepts a caller-specific rate limit interval', async () => {
  let currentTime = 10000;
  const waits = [];
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => null,
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      sendDanmaku: async (roomId, message) => ({ message }),
    }),
    now: () => currentTime,
    delay: async (ms) => {
      waits.push(ms);
      currentTime += ms;
    },
    log() {},
  });

  await service.send({ message: 'first' });
  currentTime += 500;
  await service.send({
    message: 'second',
    rateLimitIntervalMs: 0,
    waitForRateLimit: true,
  });

  assert.deepEqual(waits, []);
});

test('concurrent default sends cannot pass the same rate-limit check', async () => {
  const { service, sent } = createConcurrentSenderFixture();
  const results = await Promise.allSettled([
    service.send({ message: 'first' }),
    service.send({ message: 'second' }),
  ]);

  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected']);
  assert.match(results[1].reason.message, /发送过于频繁/);
  assert.deepEqual(sent.map((item) => item.message), ['first']);
});

test('waiting sends recheck rate limits in FIFO order', async () => {
  const { service, sent, waits } = createConcurrentSenderFixture();
  await Promise.all([
    service.send({ message: 'first', waitForRateLimit: true }),
    service.send({ message: 'second', waitForRateLimit: true }),
    service.send({ message: 'third', waitForRateLimit: true }),
  ]);

  assert.deepEqual(sent.map((item) => [item.message, item.at]), [
    ['first', 10000], ['second', 11500], ['third', 13000],
  ]);
  assert.deepEqual(waits, [1500, 1500]);
});

test('zero-rate sends keep all chunks together across callers', async () => {
  const firstChunk = Promise.withResolvers();
  const { service, sent } = createConcurrentSenderFixture({
    sendDanmaku: async (_roomId, message) => {
      if (message === 'a'.repeat(DANMAKU_MESSAGE_LIMIT)) await firstChunk.promise;
      return { message };
    },
  });
  const first = service.send({ message: 'a'.repeat(DANMAKU_MESSAGE_LIMIT + 1), rateLimitIntervalMs: 0 });
  const second = service.send({ message: 'second', rateLimitIntervalMs: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeRelease = sent.map((item) => item.message);
  firstChunk.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(beforeRelease, ['a'.repeat(DANMAKU_MESSAGE_LIMIT)]);
  assert.deepEqual(sent.map((item) => item.message), [
    'a'.repeat(DANMAKU_MESSAGE_LIMIT), 'a', 'second',
  ]);
});

test('a failed send does not block the next queued caller', async () => {
  const { service, sent } = createConcurrentSenderFixture({
    sendDanmaku: async (_roomId, message) => {
      if (message === 'first') throw new Error('synthetic send failure');
      return { message };
    },
  });
  const results = await Promise.allSettled([
    service.send({ message: 'first' }),
    service.send({ message: 'second' }),
  ]);

  assert.deepEqual(results.map((result) => result.status), ['rejected', 'fulfilled']);
  assert.equal(results[0].reason.message, 'synthetic send failure');
  assert.deepEqual(sent.map((item) => item.message), ['first', 'second']);
});

function createConcurrentSenderFixture(options = {}) {
  let currentTime = 10000;
  const sent = [];
  const waits = [];
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'synthetic-cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true }),
    getMentionTarget: () => null,
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      async sendDanmaku(roomId, message) {
        sent.push({ message, at: currentTime });
        return options.sendDanmaku ? options.sendDanmaku(roomId, message) : { message };
      },
    }),
    now: () => currentTime,
    delay: async (ms) => {
      waits.push(ms);
      currentTime += ms;
    },
    log() {},
  });
  return { service, sent, waits };
}

test('sender service splits long admin messages into Bilibili-sized chunks', async () => {
  const calls = [];
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => ({
      uid: '42',
      name: 'Alice',
      source: 'random',
    }),
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      sendDanmaku: async (roomId, message, target) => {
        calls.push({ roomId, message, target });
        return { message, replyMid: target.uid, replyUname: target.name };
      },
    }),
    minIntervalMs: 0,
    log() {},
  });

  const result = await service.send({
    message: '1234567890'.repeat(8),
    mentionRequester: true,
  });

  assert.equal(result.count, 3);
  assert.equal(result.accountUid, '9');
  assert.equal(typeof result.sentAfter, 'number');
  assert.equal(result.messages.length, 3);
  assert.ok(
    calls.every(
      (call) => Array.from(call.message).length <= DANMAKU_MESSAGE_LIMIT,
    ),
  );
  assert.ok(
    Array.from(`@Alice ${calls[0].message}`).length <= DANMAKU_MESSAGE_LIMIT,
  );
  assert.equal(calls[0].target.uid, '42');
  assert.deepEqual(calls[1].target, {
    uid: '',
    name: '',
    source: '',
    createdAt: '',
  });
  assert.equal(result.message, '1234567890'.repeat(8));
});

test('sender service repeats an AI mention on every 40-character chunk', async () => {
  const calls = [];
  const waits = [];
  const target = { uid: '42', name: 'Alice', source: 'ai-assistant' };
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => null,
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      sendDanmaku: async (roomId, message, replyTarget) => {
        calls.push({ roomId, message, target: replyTarget });
        return {
          message,
          replyMid: replyTarget.uid,
          replyUname: replyTarget.name,
        };
      },
    }),
    minIntervalMs: 0,
    delay: async (ms) => waits.push(ms),
    log: () => {},
  });
  await service.send({
    message: '猫'.repeat(70),
    mentionTarget: target,
    mentionEveryChunk: true,
    intervalMs: 3000,
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.target.uid === '42'));
  assert.ok(
    calls.every(
      (call) =>
        Array.from(`@Alice ${call.message}`).length <= DANMAKU_MESSAGE_LIMIT,
    ),
  );
  assert.equal(calls.map((call) => call.message).join(''), '猫'.repeat(70));
  assert.deepEqual(waits, [3000, 3000]);
});

test('sender service waits only after each AI chunk finishes before sending the next one', async () => {
  const events = [];
  let finishSend;
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'cookie' }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => null,
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: 123 }),
      sendDanmaku: async (roomId, message, target) => {
        events.push(`send:${message}`);
        if (!finishSend) {
          await new Promise((resolve) => {
            finishSend = resolve;
          });
        }
        events.push(`sent:${message}`);
        return { message, replyMid: target.uid, replyUname: target.name };
      },
    }),
    minIntervalMs: 0,
    delay: async (ms) => events.push(`wait:${ms}`),
    log: () => {},
  });

  const sending = service.send({
    message: '猫'.repeat(50),
    mentionTarget: { uid: '42', name: 'Alice', source: 'ai-assistant' },
    mentionEveryChunk: true,
    intervalMs: 200,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [`send:${'猫'.repeat(33)}`]);

  finishSend();
  await sending;
  assert.deepEqual(events, [
    `send:${'猫'.repeat(33)}`,
    `sent:${'猫'.repeat(33)}`,
    'wait:200',
    `send:${'猫'.repeat(17)}`,
    `sent:${'猫'.repeat(17)}`,
  ]);
});

test('AI chunking moves a short trailing emoticon instead of cutting through it', () => {
  const message = `喵平时都在自己直播间蹲着，最爱看的就是你们这些观众啦～(｡･ω･｡)`;
  const chunks = splitDanmakuEveryMentionMessage(message, {
    name: '哈极光dd_',
  });

  assert.deepEqual(chunks, [
    '喵平时都在自己直播间蹲着，最爱看的就是你们这些观众啦～',
    '(｡･ω･｡)',
  ]);
  assert.equal(chunks.join(''), message);
  assert.ok(
    chunks.every(
      (chunk) =>
        Array.from(`@哈极光dd_ ${chunk}`).length <= DANMAKU_MESSAGE_LIMIT,
    ),
  );
});

test('AI chunking prefers nearby punctuation without creating more than three messages', () => {
  const message = `${'甲'.repeat(28)}。${'乙'.repeat(28)}，${'丙'.repeat(28)}`;
  const chunks = splitDanmakuEveryMentionMessage(message, {
    name: '哈极光dd_',
    source: 'ai-assistant',
  });

  assert.equal(chunks[0], `${'甲'.repeat(28)}。`);
  assert.equal(chunks.join(''), message);
  assert.ok(chunks.length <= 3);
  assert.ok(
    chunks.every(
      (chunk) =>
        Array.from(`@哈极光dd_ ${chunk}`).length <= DANMAKU_MESSAGE_LIMIT,
    ),
  );
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
      },
    }),
    minIntervalMs: 0,
    log() {},
  });
  const message = `${'\u{1F680}!@#$%^&*()'.repeat(6)} DIY`;
  const target = { uid: '789', name: '主播名字很长😀' };

  const result = await service.send({ message, mentionTarget: target });

  assert.equal(result.message, message);
  assert.ok(calls.length > 1);
  assert.ok(calls.every((call) => !call.message.includes('\uFFFD')));
  assert.ok(
    calls.every(
      (call) => Array.from(call.message).length <= DANMAKU_MESSAGE_LIMIT,
    ),
  );
  assert.ok(
    Array.from(`@${target.name} ${calls[0].message}`).length <=
      DANMAKU_MESSAGE_LIMIT,
  );
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
      },
    }),
    minIntervalMs: 0,
    log() {},
  });
  const messages = [
    '上上签·云开见日｜守得云开见月明，眼前的阻滞正在渐渐散去。宜乘势而为，把握已经出现的机会；忌得意忘形，忽略同行之人。',
    '已签到 128 天。愿你今日所行皆坦途，所遇皆温暖，认真生活也被生活温柔以待。',
  ];

  for (const message of messages) {
    calls.length = 0;
    const result = await service.send({
      message,
      mentionTarget: { uid: '789', name: longName },
    });

    assert.ok(result.count > 1);
    assert.ok(
      Array.from(`@${longName} ${calls[0].message}`).length <=
        DANMAKU_MESSAGE_LIMIT,
    );
    assert.ok(
      calls
        .slice(1)
        .every(
          (call) => Array.from(call.message).length <= DANMAKU_MESSAGE_LIMIT,
        ),
    );
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
      },
    }),
    minIntervalMs: 0,
    log() {},
  });

  await service.send({
    message: '请调整组合条件后再试。',
    mentionTarget: { uid: '789', name: '当前点歌人' },
  });

  assert.equal(calls[0].message, '请调整组合条件后再试。');
  assert.deepEqual(calls[0].target, {
    uid: '789',
    name: '当前点歌人',
    source: '',
    createdAt: '',
  });
});

test('sender state exposes only the stable UI contract', async () => {
  const service = createDanmakuSenderService({
    getAuth: async () => ({
      loggedIn: true,
      uid: 9,
      cookieHeader: 'secret-cookie',
    }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: false, message: 'reconnecting' }),
    getMentionTarget: async () => null,
    getFortuneBotEnabled: () => true,
    getCustomReplyBotEnabled: () => true,
    createClient: () => ({
      fetchCurrentUserName: async () => '',
      resolveRoomInfo: async () => ({ roomId: 123, ownerName: '' }),
    }),
  });
  const state = await service.getState();

  assert.equal(state.canSend, true);
  assert.equal(state.connected, false);
  assert.equal(state.fortuneBotEnabled, true);
  assert.equal(state.customReplyBotEnabled, true);
  assert.equal('cookieHeader' in state, false);
  assert.deepEqual(state.requester, {
    uid: '',
    name: '',
    source: '',
    createdAt: '',
  });
});

test('sender state exposes account and room display names when available', async () => {
  const service = createDanmakuSenderService({
    getAuth: async () => ({
      loggedIn: true,
      uid: 9,
      cookieHeader: 'secret-cookie',
    }),
    getRoom: async () => ({ roomId: '123' }),
    getLiveStatus: () => ({ connected: true, message: 'ok' }),
    getMentionTarget: async () => null,
    createClient: () => ({
      fetchCurrentUserName: async () => '主播小号',
      resolveRoomInfo: async () => ({ roomId: 123, ownerName: '直播间主人' }),
    }),
    log() {},
  });
  const state = await service.getState();

  assert.equal(state.accountName, '主播小号');
  assert.equal(state.roomName, '直播间主人');
});
