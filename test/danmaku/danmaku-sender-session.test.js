'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDanmakuSenderService } = require('../../src/bilibili/danmaku/sender-service');

test('danmaku route forwards optional sendSession and retains its existing failure shape', async () => {
  const { routes } = require('../../src/server/routes/bilibili-routes');
  const calls = [];
  const context = { bilibili: { sendDanmaku: async input => {
    calls.push(input);
    if (input.sendSession !== undefined) throw Object.assign(new Error('synthetic changed session'), { code: 'DANMAKU_SESSION_CHANGED' });
    return { message: input.message };
  } } };
  for (const sendSession of [undefined, 'old-session', null, false]) {
    const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    await routes['POST /api/bilibili/danmaku/send'](context,
      { body: async () => ({ message: 'hello', ...(sendSession === undefined ? {} : { sendSession }) }) }, response);
    assert.equal(response.status, sendSession === undefined ? 200 : 502);
    assert.equal(Object.hasOwn(calls.at(-1), 'sendSession'), sendSession !== undefined);
    if (sendSession !== undefined) {
      assert.match(response.body.error, /账号或房间已变更/);
      assert.equal(response.body.detail, 'synthetic changed session');
      assert.equal(Object.hasOwn(response.body, 'code'), false);
    }
  }
});

for (const boundary of ['auth', 'room', 'chunk', 'send']) {
  test(`public sendSession cancels after the ${boundary} boundary`, async () => {
    let session = 'account-and-room-a';
    const reached = Promise.withResolvers();
    const release = Promise.withResolvers();
    const sent = [];
    const pause = async stage => {
      if (stage === boundary) { reached.resolve(); await release.promise; }
    };
    const sender = createDanmakuSenderService({
      getSessionKey: () => session,
      getAuth: async () => { await pause('auth'); return { loggedIn: true, uid: 1, cookieHeader: 'synthetic' }; },
      getRoom: async () => ({ roomId: '201' }),
      createClient: () => ({
        resolveRoomInfo: async () => { await pause('room'); return { roomId: '201' }; },
        sendDanmaku: async (_room, message) => { sent.push(message); await pause('send'); return { message }; },
      }),
      delay: () => pause('chunk'), minIntervalMs: 0, log() {},
    });
    const operation = sender.send({ message: '答'.repeat(80), sendSession: session, intervalMs: 1 });
    const rejected = assert.rejects(operation, { code: 'DANMAKU_SESSION_CHANGED' });
    await reached.promise;
    session = 'account-or-room-b';
    release.resolve();
    await rejected;
    assert.equal(sent.length, ['chunk', 'send'].includes(boundary) ? 1 : 0);
  });
}

test('public sendSession rejects obsolete queued batches while omitted manual calls remain compatible', async () => {
  let session = 'first-session';
  const reached = Promise.withResolvers();
  const release = Promise.withResolvers();
  const sent = [];
  const sender = createDanmakuSenderService({
    getSessionKey: () => session,
    getAuth: async () => ({ loggedIn: true, uid: 1, cookieHeader: 'synthetic' }),
    getRoom: async () => ({ roomId: '201' }),
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: '201' }),
      sendDanmaku: async (_room, message) => {
        sent.push(message);
        if (message === 'manual first') { reached.resolve(); await release.promise; }
        return { message };
      },
    }), minIntervalMs: 0, log() {},
  });
  const manual = sender.send({ message: 'manual first' });
  await reached.promise;
  const obsolete = sender.send({ message: 'old batch', sendSession: session });
  const rejected = assert.rejects(obsolete, { code: 'DANMAKU_SESSION_CHANGED' });
  session = 'second-session';
  release.resolve();
  await manual;
  await rejected;
  await sender.send({ message: 'manual later' });
  assert.deepEqual(sent, ['manual first', 'manual later']);
});

test('sender state captures its session before asynchronous identity reads', async () => {
  let session = 'first-session';
  const reached = Promise.withResolvers();
  const release = Promise.withResolvers();
  const sender = createDanmakuSenderService({
    getSessionKey: () => session,
    getAuth: async () => { reached.resolve(); await release.promise; return { loggedIn: true, uid: 1, cookieHeader: 'synthetic' }; },
    getRoom: async () => ({ roomId: '201' }), getMentionTarget: async () => null,
    getLiveStatus: () => ({}), createClient: () => ({}),
  });
  const state = sender.getState();
  await reached.promise;
  session = 'second-session';
  release.resolve();
  assert.equal((await state).sendSession, 'first-session');
  await assert.rejects(sender.send({ message: 'stale read', sendSession: 'first-session' }), { code: 'DANMAKU_SESSION_CHANGED' });
});

for (const boundary of ['auth', 'target', 'room', 'rate-limit', 'chunk', 'send']) {
  test(`sender cancels a bound session after the ${boundary} asynchronous boundary`, async () => {
    const waiting = Promise.withResolvers();
    const release = Promise.withResolvers();
    const sent = [];
    let current = true;
    let block = false;
    const pause = async (stage) => {
      if (block && stage === boundary) {
        waiting.resolve();
        await release.promise;
      }
    };
    const service = createDanmakuSenderService({
      getAuth: async () => {
        await pause('auth');
        return { loggedIn: true, uid: 9, cookieHeader: 'synthetic-cookie' };
      },
      getRoom: async () => ({ roomId: '100' }),
      getMentionTarget: async () => {
        await pause('target');
        return null;
      },
      createClient: () => ({
        async resolveRoomInfo() {
          await pause('room');
          return { roomId: '100' };
        },
        async sendDanmaku(roomId, message) {
          sent.push(message);
          await pause('send');
          return { message };
        },
      }),
      now: () => 10000,
      delay: () => pause(boundary === 'rate-limit' ? 'rate-limit' : 'chunk'),
      log() {},
    });
    if (boundary === 'rate-limit') await service.send({ message: 'manual warmup' });
    block = true;
    const operation = service.send({
      message: '答'.repeat(80),
      mentionRequester: true,
      intervalMs: 200,
      waitForRateLimit: true,
      assertSessionCurrent() {
        if (!current) throw Object.assign(new Error('Session changed'), { code: 'DANMAKU_SESSION_CHANGED' });
      },
    });
    const rejected = assert.rejects(operation, { code: 'DANMAKU_SESSION_CHANGED' });
    await waiting.promise;
    current = false;
    release.resolve();
    await rejected;
    assert.equal(sent.length, ['rate-limit', 'chunk', 'send'].includes(boundary) ? 1 : 0);
  });
}

test('sender discards obsolete queued work and still permits later manual sends', async () => {
  const waiting = Promise.withResolvers();
  const release = Promise.withResolvers();
  const sent = [];
  let current = true;
  const service = createDanmakuSenderService({
    getAuth: async () => ({ loggedIn: true, uid: 9, cookieHeader: 'synthetic-cookie' }),
    getRoom: async () => ({ roomId: '100' }),
    createClient: () => ({
      resolveRoomInfo: async () => ({ roomId: '100' }),
      async sendDanmaku(roomId, message) {
        sent.push(message);
        if (message === 'first manual') {
          waiting.resolve();
          await release.promise;
        }
        return { message };
      },
    }),
    minIntervalMs: 0,
    log() {},
  });
  const first = service.send({ message: 'first manual' });
  await waiting.promise;
  const obsolete = service.send({
    message: 'obsolete AI',
    assertSessionCurrent() {
      if (!current) throw Object.assign(new Error('Session changed'), { code: 'DANMAKU_SESSION_CHANGED' });
    },
  });
  const rejected = assert.rejects(obsolete, { code: 'DANMAKU_SESSION_CHANGED' });
  current = false;
  release.resolve();
  await first;
  await rejected;
  await service.send({ message: 'later manual' });
  assert.deepEqual(sent, ['first manual', 'later manual']);
});
