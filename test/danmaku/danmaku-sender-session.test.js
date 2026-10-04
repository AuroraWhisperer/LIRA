'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDanmakuSenderService } = require('../../src/bilibili/danmaku/sender-service');

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
