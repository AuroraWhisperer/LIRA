'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutoReplyController } = require('../../src/ai/auto-reply-controller');

function fixture(t) {
  let time = 1794480000000;
  let nextTimer = 1;
  let busy = false;
  const timers = new Map();
  const jobs = [];
  const controller = createAutoReplyController({
    now: () => time,
    setTimer(callback, ms) { const id = nextTimer++; timers.set(id, { callback, at: time + ms }); return id; },
    clearTimer: id => timers.delete(id),
    canRun: () => !busy,
    enqueue(job) { jobs.push(job); return true; },
  });
  t.after(() => controller.dispose());
  return {
    controller, jobs, timers,
    now: () => time,
    setBusy(value) { busy = value; },
    observe(input = {}) {
      return controller.observe({
        source: 'danmaku', roomId: 'room-a', uid: 'viewer-a', userName: '观众甲',
        message: '这个有点意思', messageTimestamp: time, sessionKey: 'session-a', ...input,
      });
    },
    advance(ms) {
      const end = time + ms;
      let count = 0;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++count < 1000, 'timers must make bounded progress');
        timers.delete(next[0]);
        time = next[1].at;
        next[1].callback();
      }
      time = end;
    },
  };
}

test('one ordinary message is evaluated on its own timer and a silent batch is consumed', t => {
  const f = fixture(t);
  f.observe();
  f.advance(599);
  assert.equal(f.jobs.length, 0);
  f.advance(1);
  assert.equal(f.jobs.length, 1);
  f.jobs[0].complete({ action: 'silent' });
  f.advance(6000);
  assert.equal(f.jobs.length, 1, 'silence does not poll the same message again');
  f.observe({ message: '换个新话题' });
  f.advance(600);
  assert.deepEqual(f.jobs[1].snapshot.messages.map(message => message.text), ['换个新话题']);
  assert.deepEqual(f.jobs[1].snapshot.contextMessages.map(message => message.text), ['这个有点意思']);
  assert.throws(() => f.jobs[1].assertFresh(f.jobs[0].snapshot.messages[0].id), { code: 'AI_AUTO_STALE' });
  f.jobs[1].complete({ action: 'silent' });
  f.advance(30000);
  f.observe({ message: '窗口之外的新话题' });
  f.advance(600);
  assert.deepEqual(f.jobs[2].snapshot.contextMessages, []);
});

test('a rejected public batch is removed from context without discarding newer arrivals', t => {
  const f = fixture(t);
  f.observe({ message: '前面的公开背景' });
  f.advance(600);
  f.jobs[0].complete({ action: 'silent' });
  f.controller.rememberReply({ roomId: 'room-a', text: '之前的公开回复' });
  f.advance(5000);
  f.observe({ message: '需要语义审核的当前内容' });
  f.advance(600);
  const blocked = f.jobs[1];
  assert.equal(blocked.snapshot.contextMessages.length, 1);
  f.observe({ uid: 'viewer-b', message: '审核期间新来的正常聊天' });
  blocked.complete({ action: 'silent', reason: 'AI_AUTO_INPUT_BLOCKED' });
  f.advance(5000);
  const next = f.jobs[2].snapshot;
  assert.deepEqual(next.messages.map(message => message.text), ['审核期间新来的正常聊天']);
  assert.deepEqual(next.contextMessages, []);
  assert.deepEqual(next.botReplies, []);
});

test('wait has a fixed deadline and unrelated arrivals cannot extend it or trigger a second evaluation', t => {
  const f = fixture(t);
  f.observe({ message: '我刚想说' });
  f.advance(600);
  const first = f.jobs[0];
  first.complete({ action: 'wait', targetMessageId: first.snapshot.messages[0].id });
  for (const delay of [400, 700, 700]) {
    f.advance(delay);
    f.observe({ uid: `other-${delay}-${f.now()}`, message: '别的话题' });
    f.advance(0);
    assert.equal(f.jobs.length, 1);
  }
  f.advance(200);
  assert.equal(f.jobs.length, 1);
  f.advance(3000);
  assert.equal(f.jobs.length, 2, 'new unrelated messages may form their own later batch');
  assert.ok(f.jobs[1].snapshot.messages.every(message => message.text !== '我刚想说'));
});

test('a related supplement permits exactly one bounded reevaluation', t => {
  const f = fixture(t);
  f.observe({ message: '我刚想说' });
  f.advance(600);
  const first = f.jobs[0];
  first.complete({ action: 'wait', targetMessageId: first.snapshot.messages[0].id });
  f.advance(400);
  f.observe({ message: '这个配色很像西瓜' });
  f.advance(0);
  assert.equal(f.jobs.length, 2);
  assert.equal(f.jobs[1].snapshot.waitAllowed, false);
  assert.deepEqual(f.jobs[1].snapshot.messages.map(message => message.text), ['我刚想说', '这个配色很像西瓜']);
  f.jobs[1].complete({ action: 'wait', targetMessageId: first.snapshot.messages[0].id });
  f.advance(15000);
  assert.equal(f.jobs.length, 2);
  assert.equal(f.timers.size, 0);
});

test('a supplement received while generation runs is available to wait without another chat event', t => {
  const f = fixture(t);
  f.observe({ message: '我想到一个办法' });
  f.advance(600);
  const first = f.jobs[0];
  f.advance(400);
  f.observe({ message: '用蓝色试试看' });
  first.complete({ action: 'wait', targetMessageId: first.snapshot.messages[0].id });
  f.advance(0);
  assert.equal(f.jobs.length, 2);
  assert.equal(f.jobs[1].snapshot.messages.at(-1).text, '用蓝色试试看');
});

test('busy direct work expires a candidate instead of leaving a backlog', t => {
  const f = fixture(t);
  f.setBusy(true);
  f.observe();
  f.advance(12000);
  assert.equal(f.jobs.length, 0);
  assert.equal(f.timers.size, 0);
  f.setBusy(false);
  f.observe({ message: '现在有空啦' });
  f.advance(600);
  assert.deepEqual(f.jobs[0].snapshot.messages.map(message => message.text), ['现在有空啦']);
});

test('a direct question cancels an unsent job and late completion cannot reschedule it', t => {
  const f = fixture(t);
  f.observe();
  f.advance(600);
  const old = f.jobs[0];
  f.controller.interrupt();
  assert.equal(old.signal.reason.code, 'AI_AUTO_CANCELLED');
  old.complete({ action: 'wait', targetMessageId: old.snapshot.messages[0].id });
  f.advance(12000);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.timers.size, 0);
});

test('an in-flight candidate expires and its late completion cannot clear a newer batch', t => {
  const f = fixture(t);
  f.observe();
  f.advance(600);
  const expired = f.jobs[0];
  f.advance(11400);
  assert.equal(expired.signal.reason.code, 'AI_AUTO_CANCELLED');
  f.observe({ message: '这是后来的新话题' });
  expired.complete({ action: 'wait', targetMessageId: expired.snapshot.messages[0].id });
  f.advance(600);
  assert.equal(f.jobs.length, 2);
  assert.deepEqual(f.jobs[1].snapshot.messages.map(message => message.text), ['这是后来的新话题']);
});

test('unrelated traffic cannot evict a selected draft but target corrections invalidate it', t => {
  const f = fixture(t);
  f.observe({ message: '准备试试蓝色' });
  f.advance(600);
  const first = f.jobs[0];
  const target = first.snapshot.messages[0].id;
  for (let index = 0; index < 50; index++) f.observe({ uid: `other-${index}`, message: `别人的聊天${index}` });
  assert.doesNotThrow(() => first.assertFresh(target), 'a frozen target survives bounded-window eviction');
  f.observe({ message: '说错了，是绿色' });
  assert.throws(() => first.assertFresh(target), { code: 'AI_AUTO_STALE' });
  first.complete({ error: { code: 'AI_AUTO_STALE' } });
  f.advance(0);
  assert.equal(f.jobs.length, 2);
  assert.equal(f.jobs[1].snapshot.messages.at(-1).text, '说错了，是绿色');
  f.observe({ message: '还是用红色吧' });
  f.jobs[1].complete({ error: { code: 'AI_AUTO_STALE' } });
  f.advance(0);
  assert.equal(f.jobs.length, 2, 'the second stale draft cannot start a third immediate attempt');
});

test('after submission, expiry and direct interruption preserve confirmation; reset still cancels', t => {
  const f = fixture(t);
  f.observe();
  f.advance(600);
  const job = f.jobs[0];
  job.assertFresh(job.snapshot.messages[0].id);
  job.markSubmitted();
  f.controller.interrupt();
  f.advance(20000);
  assert.equal(job.signal.aborted, false);
  assert.doesNotThrow(() => job.assertFresh(job.snapshot.messages[0].id));
  assert.equal(f.timers.size, 0);
  f.controller.reset();
  assert.equal(job.signal.aborted, true, 'configuration/session reset can cancel confirmation');
});

test('old, future and repeated platform events do not become fresh candidates', t => {
  const f = fixture(t);
  assert.equal(f.observe({ messageTimestamp: f.now() - 31000 }).accepted, false);
  assert.equal(f.observe({ messageTimestamp: f.now() + 6000 }).accepted, false);
  assert.equal(f.observe({ source: 'history' }).accepted, false);
  const timestamp = new Date(f.now()).toISOString();
  assert.equal(f.observe({ messageTimestamp: timestamp }).accepted, true);
  f.advance(600);
  f.jobs[0].complete({ action: 'silent' });
  f.advance(3000);
  assert.equal(f.observe({ messageTimestamp: timestamp }).reason, 'auto_duplicate');
  assert.equal(f.observe({ message: '另一句话', messageTimestamp: f.now() / 1000 }).accepted, true);
});

test('new same-text events retain their identity without making an older replay eligible again', t => {
  const f = fixture(t);
  const firstTimestamp = f.now();
  assert.equal(f.observe().accepted, true);
  f.advance(500);
  assert.equal(f.observe().accepted, true, 'a distinct platform timestamp represents a new event');
  f.advance(100);
  assert.equal(f.jobs[0].snapshot.messages.length, 2);
  f.jobs[0].complete({ action: 'silent' });
  f.advance(20000);
  assert.equal(f.observe({ messageTimestamp: firstTimestamp }).reason, 'auto_duplicate');
  assert.equal(f.observe({ message: '没有时间戳', messageTimestamp: undefined }).accepted, true);
  assert.equal(f.observe({ message: '没有时间戳', messageTimestamp: undefined }).reason, 'auto_duplicate');
});

test('room or account scope changes clear old candidates and capture the new session once', async t => {
  const f = fixture(t);
  let captures = 0;
  f.observe({ captureReplySession: () => { captures++; return () => {}; } });
  f.advance(100);
  f.observe({ roomId: 'room-b', sessionKey: 'session-b', message: '新房间', captureReplySession: () => { captures++; return () => {}; } });
  f.advance(600);
  assert.equal(captures, 2);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.jobs[0].snapshot.roomId, 'room-b');
  assert.deepEqual(f.jobs[0].snapshot.messages.map(message => message.text), ['新房间']);
  assert.deepEqual(f.jobs[0].snapshot.contextMessages, []);
  assert.equal(typeof (await f.jobs[0].replySession).assert, 'function');
});

test('session rejection is handled immediately and an invalidated ingress never evaluates', async t => {
  const f = fixture(t);
  const failure = new Error('synthetic identity read failure');
  f.observe({ captureReplySession: () => Promise.reject(failure) });
  await Promise.resolve();
  f.advance(600);
  assert.equal((await f.jobs[0].replySession).error, failure);
  f.controller.reset();
  let current = true;
  f.observe({ isSessionCurrent: () => current });
  current = false;
  f.advance(600);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.timers.size, 0);
});

test('automatic evaluation and submitted replies have separate bounded cadence', t => {
  const f = fixture(t);
  f.observe();
  f.advance(600);
  f.jobs[0].complete({ action: 'silent' });
  f.observe({ message: '一个新笑话' });
  f.advance(4999);
  assert.equal(f.jobs.length, 1);
  f.advance(1);
  const reply = f.jobs[1];
  reply.assertFresh(reply.snapshot.messages[0].id);
  reply.markSubmitted();
  f.controller.rememberReply({ roomId: 'room-a', text: '这个有点冷', sentAt: f.now() });
  reply.complete({ action: 'reply', delivered: true });
  f.advance(1000);
  f.observe({ message: '太早的下一句' });
  f.advance(9000);
  f.observe({ message: '最近的新话题' });
  f.advance(4999);
  assert.equal(f.jobs.length, 2);
  f.advance(1);
  assert.equal(f.jobs.length, 3);
  assert.deepEqual(f.jobs[2].snapshot.messages.map(message => message.text), ['最近的新话题']);
  assert.ok(f.jobs[2].snapshot.contextMessages.some(message => message.text === '太早的下一句'));
  assert.deepEqual(f.jobs[2].snapshot.botReplies.map(item => item.text), ['这个有点冷']);
});

test('continuous chat during cooldown leaves a full generation budget for the newest batch', t => {
  const f = fixture(t);
  f.observe();
  f.advance(600);
  f.jobs[0].markSubmitted();
  f.jobs[0].complete({ action: 'reply', delivered: true });
  const captured = [];
  for (let second = 1; second <= 14; second++) {
    f.advance(1000);
    f.observe({ uid: `viewer-${second}`, message: `话题${second}`,
      captureReplySession: () => { captured.push(second); return () => {}; } });
  }
  assert.equal(f.jobs.length, 1);
  assert.deepEqual(captured, [], 'cooldown only buffers messages, not pending reply sessions');
  f.advance(1000);
  const current = f.jobs[1];
  assert.deepEqual(current.snapshot.messages.map(message => message.text), ['话题14']);
  assert.deepEqual(captured, [14], 'the candidate binds the actual selected event');
  f.advance(2000); // Input review, generation and output review take time.
  current.assertFresh(current.snapshot.messages[0].id);
  current.markSubmitted();
  assert.equal(current.signal.aborted, false);
});

test('a cooldown ending with only an old topic does not start another model evaluation', t => {
  const f = fixture(t);
  f.observe();
  f.advance(600);
  f.jobs[0].markSubmitted();
  f.jobs[0].complete({ action: 'reply', delivered: true });
  f.advance(1000);
  f.observe({ message: '冷却刚开始时的话题' });
  f.advance(14000);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.timers.size, 0);
});

test('dispose removes all waiting work and rejects further observations', t => {
  const f = fixture(t);
  f.observe();
  f.advance(600);
  const job = f.jobs[0];
  job.complete({ action: 'wait', targetMessageId: job.snapshot.messages[0].id });
  f.controller.dispose();
  assert.equal(job.signal.aborted, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.observe({ message: '再来一句' }).accepted, false);
});
