'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageDeduplicator } = require('../../src/bilibili/danmaku/message-deduplicator');

test('deduplicates one command across masked danmaku and full history identities', () => {
  const deduplicator = new MessageDeduplicator();
  const timestamp = Date.now();

  assert.equal(
    deduplicator.remember(0, '点歌1', timestamp, {
      userName: '哈***',
      source: 'danmaku',
    }),
    true,
  );
  assert.equal(
    deduplicator.remember(12345, '点歌1', timestamp, {
      userName: '哈极光dd_',
      source: 'history',
    }),
    false,
  );
  assert.equal(
    deduplicator.remember(12345, '点歌1', timestamp, {
      userName: '哈极光dd_',
      source: 'history',
    }),
    false,
  );
});

test('keeps simultaneous commands from different viewers', () => {
  const deduplicator = new MessageDeduplicator();
  const timestamp = Date.now();

  assert.equal(
    deduplicator.remember(101, '点歌 同一首', timestamp, {
      userName: '观众甲',
      source: 'danmaku',
    }),
    true,
  );
  assert.equal(
    deduplicator.remember(202, '点歌 同一首', timestamp, {
      userName: '观众乙',
      source: 'history',
    }),
    true,
  );
});

test('different reliable UIDs override matching or masked display names across sources', () => {
  const timestamp = Date.now();
  for (const [firstName, secondName] of [
    ['同名观众', '同名观众'],
    ['A***', 'Alice'],
  ]) {
    const deduplicator = new MessageDeduplicator();
    assert.equal(
      deduplicator.remember('101', '点歌 同一首', timestamp, {
        userName: firstName,
        source: 'danmaku',
      }),
      true,
    );
    assert.equal(
      deduplicator.remember('202', '点歌 同一首', timestamp + 500, {
        userName: secondName,
        source: 'history',
      }),
      true,
    );
    assert.equal(
      deduplicator.remember('101', '点歌 同一首', timestamp + 500, {
        userName: '改名后的观众',
        source: 'history',
      }),
      false,
    );
  }
});

test('deduplicates anonymous commands across live and history sources', () => {
  const deduplicator = new MessageDeduplicator();
  const timestamp = Date.now();

  assert.equal(
    deduplicator.remember(0, '点歌 匿名曲', timestamp, {
      userName: '观众',
      source: 'danmaku',
    }),
    true,
  );
  assert.equal(
    deduplicator.remember(0, '点歌 匿名曲', timestamp + 500, {
      userName: '观众',
      source: 'history',
    }),
    false,
  );
});

test('matches repeated cross-source commands one to one', () => {
  const deduplicator = new MessageDeduplicator();
  const timestamp = Date.now();
  const danmaku = { userName: '哈***', source: 'danmaku' };
  const history = { userName: '哈极光dd_', source: 'history' };

  assert.equal(deduplicator.remember(0, '点歌1', timestamp, danmaku), true);
  assert.equal(deduplicator.remember(0, '点歌1', timestamp + 1000, danmaku), true);
  assert.equal(deduplicator.remember(12345, '点歌1', timestamp, history), false);
  assert.equal(deduplicator.remember(12345, '点歌1', timestamp + 1000, history), false);
});

test('unrelated commands do not rescan retained candidates and evicted text cannot suppress a command', (t) => {
  const timestamp = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => timestamp);
  const deduplicator = new MessageDeduplicator();
  for (let i = 0; i < 500; i++) {
    deduplicator.remember(0, `点歌 ${i}`, timestamp, { source: 'danmaku', userName: 'A***' });
  }
  let candidateReads = 0;
  for (const command of deduplicator.recentCommands) {
    Object.defineProperty(command, 'source', { get() { candidateReads++; return 'danmaku'; } });
  }
  for (let i = 500; i < 600; i++) {
    assert.equal(deduplicator.remember(0, `点歌 ${i}`, timestamp, { source: 'danmaku', userName: 'A***' }), true);
  }
  assert.ok(candidateReads < 500, 'new texts must not scan the retained command history');
  assert.equal(deduplicator.remember(12345, '点歌 0', timestamp, { source: 'history', userName: 'Alice' }), true);
  assert.equal(deduplicator.remember(12345, '点歌 599', timestamp, { source: 'history', userName: 'Alice' }), false);
});

test('expiry removes text candidates after a clock correction while preserving newer evidence', (t) => {
  const timestamp = 1_800_000_000_000;
  let now = timestamp + 20 * 60 * 1000;
  t.mock.method(Date, 'now', () => now);
  const deduplicator = new MessageDeduplicator();
  const live = { source: 'danmaku', userName: 'A***' };
  const history = { source: 'history', userName: 'Alice' };
  deduplicator.remember(0, '点歌 newer', now, live);
  now = timestamp;
  deduplicator.remember(0, '点歌 older', now, live);
  now = timestamp + 30 * 60 * 1000 + 1;
  deduplicator.remember(0, '点歌 trigger-pruning', now, live);
  assert.equal(deduplicator.remember(12345, '点歌 older', timestamp, history), true);
  assert.equal(deduplicator.remember(12345, '点歌 newer', timestamp + 20 * 60 * 1000, history), false);
});

test('logs one cross-source rejection without repeating on every history poll', () => {
  const deduplicator = new MessageDeduplicator();
  const timestamp = Date.now();
  const logs = captureConsoleLogs(() => {
    assert.equal(
      deduplicator.remember(0, '点歌 日落', timestamp, {
        userName: 'A**e',
        source: 'danmaku',
      }),
      true,
    );
    assert.equal(
      deduplicator.remember(12345, '点歌 日落', timestamp + 500, {
        userName: 'Alice',
        source: 'history',
      }),
      false,
    );
    assert.equal(
      deduplicator.remember(12345, '点歌 日落', timestamp + 500, {
        userName: 'Alice',
        source: 'history',
      }),
      false,
    );
  });

  assert.equal(logs.length, 1);
});

function captureConsoleLogs(callback) {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    callback();
  } finally {
    console.log = originalLog;
  }
  return logs;
}
