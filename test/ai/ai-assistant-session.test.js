'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBilibiliRuntime } = require('../../src/server/bilibili-runtime');
const { createBilibiliClient } = require('../../src/server/bilibili-client');
const { BilibiliApiClient } = require('../../src/bilibili/danmaku/api-client');
const { createTestService, waitUntil } = require('../helpers/ai-assistant-service-fixture');

for (const change of ['room', 'disconnect', 'account', 'same-account-login']) {
  test(`AI ingress cancels an old reply after ${change} changes during generation`, async (t) => {
    const generation = Promise.withResolvers();
    t.after(() => generation.resolve());
    let generating = false;
    const fixture = await createSessionFixture(t, {
      async createResponse(request) {
        if (request.purpose === 'generation') {
          generating = true;
          await generation.promise;
          return { text: '这是旧房间的回复。', functionCalls: [], usage: {} };
        }
        return { text: '{"allowed":true,"safeText":""}', functionCalls: [], usage: {} };
      },
    });
    fixture.ask();
    await waitUntil(() => generating);
    if (change === 'room') {
      fixture.settings.roomId = '200';
      await fixture.runtime.reconnect();
    } else if (change === 'disconnect') {
      fixture.runtime.disconnect();
    } else if (change === 'account') {
      fixture.account.uid = 10;
    } else {
      fixture.account.revision += 2;
    }
    generation.resolve();
    await fixture.waitForIdle();

    assert.deepEqual(fixture.sent, []);
    assert.deepEqual(fixture.contexts, []);
    assert.equal(fixture.service.getStatus().lastError, '');
    if (change === 'same-account-login') {
      fixture.ask();
      await fixture.waitForIdle();
      assert.equal(fixture.sent.length, 1);
      assert.equal(fixture.contexts.length, 1);
    }
  });
}

test('AI ingress preserves normal same-session delivery and conversation context', async (t) => {
  const fixture = await createSessionFixture(t);
  fixture.ask();
  await fixture.waitForIdle();
  assert.deepEqual(fixture.sent.map(({ roomId, message }) => ({ roomId, message })), [
    { roomId: '100', message: '正常回复。' },
  ]);
  assert.equal(fixture.contexts.length, 1);
});

test('first AI request after a different account logs in uses the current identity without reconnect', async (t) => {
  const fixture = await createSessionFixture(t);
  fixture.account.uid = 10;
  fixture.account.revision += 1;
  fixture.ask();
  await fixture.waitForIdle();
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.contexts.length, 1);
});

test('AI does not read credentials for messages rejected before admission', async (t) => {
  const fixture = await createSessionFixture(t);
  const before = fixture.identityReads.length;
  fixture.ask('普通弹幕');
  assert.equal(fixture.identityReads.length, before);
  assert.equal(fixture.service.getStatus().handledCount, 0);
});

test('shutdown drains an accepted identity read that fails without delivery or unhandled rejection', async (t) => {
  const identity = Promise.withResolvers();
  t.after(() => identity.reject(new Error('Synthetic identity read failure')));
  const fixture = await createSessionFixture(t);
  fixture.account.readIdentity = () => identity.promise;
  fixture.ask();
  const shutdown = fixture.service.shutdown();
  identity.reject(new Error('Synthetic identity read failure'));
  await shutdown;
  assert.deepEqual(fixture.sent, []);
  assert.deepEqual(fixture.contexts, []);
  assert.equal(fixture.service.getStatus().lastError, '');
});

for (const change of ['account', 'logout']) {
  test(`AI stops remaining chunks after ${change} changes without reconnecting the listener`, async (t) => {
    const firstSent = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.after(() => release.resolve());
    const fixture = await createSessionFixture(t, {
      async createResponse(request) {
        return {
          text: request.purpose === 'generation' ? '回答'.repeat(30) : '{"allowed":true,"safeText":""}',
          functionCalls: [], usage: {},
        };
      },
    });
    const sendDanmaku = BilibiliApiClient.prototype.sendDanmaku;
    t.mock.method(BilibiliApiClient.prototype, 'sendDanmaku', async (...args) => {
      const result = await sendDanmaku(...args);
      firstSent.resolve();
      await release.promise;
      return result;
    });
    fixture.ask();
    await firstSent.promise;
    if (change === 'account') fixture.account.uid = 10;
    else fixture.account.loggedIn = false;
    release.resolve();
    await fixture.waitForIdle();
    assert.equal(fixture.sent.length, 1);
    assert.deepEqual(fixture.contexts, []);
    assert.equal(fixture.service.getStatus().lastError, '');
  });
}

for (const change of ['disconnect', 'account']) {
  for (const delivered of [false, true]) {
    test(`AI cancels ${delivered ? 'confirmed' : 'missing'} delivery after ${change} during confirmation`, async (t) => {
      const confirmation = Promise.withResolvers();
      t.after(() => confirmation.resolve(false));
      let confirming = false;
      const fixture = await createSessionFixture(t, null, async () => {
        confirming = true;
        return confirmation.promise;
      });
      fixture.ask();
      await waitUntil(() => confirming);
      if (change === 'disconnect') fixture.runtime.disconnect();
      else {
        fixture.account.uid = 10;
        fixture.account.revision += 1;
      }
      confirmation.resolve(delivered);
      await fixture.waitForIdle();
      assert.equal(fixture.sent.length, 1);
      assert.equal(fixture.generations.length, 1);
      assert.deepEqual(fixture.contexts, []);
      assert.equal(fixture.service.getStatus().lastError, '');
    });
  }
}

async function createSessionFixture(t, deepseek, waitForDelivery) {
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected external request in AI session test');
  });
  t.after(() => assert.equal(network.mock.callCount(), 0));
  const settings = { roomId: '100', enableBilibili: 'true' };
  const account = { uid: 9, loggedIn: true, revision: 1 };
  const sent = [];
  const contexts = [];
  const generations = [];
  const identityReads = [];
  const clients = [];
  t.mock.method(BilibiliApiClient.prototype, 'resolveRoomInfo', async function () {
    return { roomId: this.roomId };
  });
  t.mock.method(BilibiliApiClient.prototype, 'sendDanmaku', async (roomId, message) => {
    sent.push({ roomId, message });
    return { message };
  });
  const domainServices = {
    requesterTargets: { getLatestRandomRequester: () => null },
    messages: { handleDanmaku: () => ({ accepted: false }), logDanmaku() {} },
    customReplies: { isCommandText: () => false },
  };
  let service;
  const runtime = createBilibiliRuntime({
    settingsStore: { getSettings: () => settings },
    domainServices,
    broadcastSnapshot() {},
    buildClient(roomId, context) {
      const client = createBilibiliClient(roomId, {
        ...context,
        domainServices,
        aiAssistant: service,
        aiDanmakuDeliveryVerifier: { observe() {} },
      });
      client.restart = async () => {};
      clients.push(client);
      return client;
    },
  });
  runtime.setAuthProvider({
    getCookieHeader: async () => 'synthetic-cookie',
    getUid: async () => {
      identityReads.push(account.uid);
      return account.readIdentity ? account.readIdentity() : account.uid;
    },
    getAuthState: async () => ({ ...account }),
    getSessionRevision: () => account.revision,
  });
  const model = deepseek || {
    async createResponse(request) {
      return {
        text: request.purpose === 'generation' ? '正常回复。' : '{"allowed":true,"safeText":""}',
        functionCalls: [],
        usage: {},
      };
    },
  };
  service = createTestService({
    store: { setContext: (...args) => contexts.push(args) },
    deepseek: {
      createResponse(request) {
        if (request.purpose === 'generation') generations.push(request);
        return model.createResponse(request);
      },
    },
    sendReply: (input) => runtime.getDanmakuSender().send({ ...input, waitForRateLimit: true }),
    waitForDelivery,
    random: () => 0,
  });
  t.after(async () => {
    runtime.stop();
    await service.shutdown();
  });
  await runtime.reconnect();
  return {
    runtime,
    service,
    settings,
    account,
    sent,
    contexts,
    generations,
    identityReads,
    ask: (message = '小米 你好') => clients.at(-1).handlers.onMessage({ uid: '42', userName: '观众', message }),
    waitForIdle: () =>
      waitUntil(() => {
        const status = service.getStatus();
        return !status.queued && !status.delivering;
      }),
  };
}
