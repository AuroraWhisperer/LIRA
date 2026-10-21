'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createLiveReplySender } = require('../../src/bilibili/danmaku/live-reply-sender');

const reply = { message: '回复', target: { uid: '7', name: '观众' } };

test('fixed replies require confirmed live status and reuse the current live session', async () => {
  const sent = [];
  const sender = createLiveReplySender({
    isShuttingDown: () => false,
    sender: { send: async (input) => { input.assertSessionCurrent(); sent.push(input); } },
  });
  await sender.send(reply);
  sender.setLive(false);
  await sender.send(reply);
  assert.equal(sent.length, 0);
  sender.setLive(true);
  await sender.send(reply);
  sender.setLive(true);
  sent[0].assertSessionCurrent();
  assert.equal(sent[0].mentionEveryChunk, true);
  assert.deepEqual(sent[0].mentionTarget, reply.target);
  sender.setLive(false);
  sender.setLive(true);
  assert.throws(sent[0].assertSessionCurrent, { code: 'LIVE_REPLY_CANCELLED' });
  await sender.send(reply);
  assert.equal(sent.length, 2);
});

test('live end during auth capture cancels the old reply even after another live starts', async () => {
  const auth = Promise.withResolvers();
  const sender = createLiveReplySender({
    isShuttingDown: () => false,
    captureReplySession: () => auth.promise,
    sender: { send() { assert.fail('an old reply must not reach the sender'); } },
  });
  sender.setLive(true);
  const pending = sender.send(reply);
  sender.setLive(false);
  sender.setLive(true);
  auth.resolve(() => {});
  await pending;
});

test('each queued segment checks live status and the original account and room session', async () => {
  const first = Promise.withResolvers();
  const continueSend = Promise.withResolvers();
  let checks = 0;
  const segments = [];
  const sender = createLiveReplySender({
    isShuttingDown: () => false,
    captureReplySession: async () => () => { checks++; },
    sender: { async send(input) {
      input.assertSessionCurrent({ loggedIn: true, uid: 9 });
      segments.push('first');
      first.resolve();
      await continueSend.promise;
      input.assertSessionCurrent({ loggedIn: true, uid: 9 });
      segments.push('second');
    } },
  });
  sender.setLive(true);
  const pending = sender.send(reply);
  await first.promise;
  sender.setLive(false);
  continueSend.resolve();
  await pending;
  assert.deepEqual(segments, ['first']);
  assert.equal(checks, 2);
});
