'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  createRequestScheduler,
} = require('../src/bilibili/dynamic-lottery/request-scheduler');
const {
  runDynamicLotteryMigrations,
} = require('../src/storage/dynamic-lottery-migrations');
const {
  createDynamicLotteryStore,
} = require('../src/storage/dynamic-lottery-store');

function createFixture(fetchImpl) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runDynamicLotteryMigrations(db);
  const store = createDynamicLotteryStore(db);
  let now = 1_000;
  const sleeps = [];
  const scheduler = createRequestScheduler({
    fetchImpl,
    budgetStore: store.requestBudget,
    clock: {
      nowMs: () => now,
      async sleep(ms, signal) {
        if (signal?.aborted) throw signal.reason;
        sleeps.push(ms);
        now += ms;
      },
    },
  });
  return { db, scheduler, sleeps, store, get now() { return now; } };
}

test('scheduler retries transient network failures through one persistent budget', async () => {
  let calls = 0;
  const fixture = createFixture(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('temporary network failure');
    return new Response('{}', { status: 200 });
  });
  try {
    const response = await fixture.scheduler.request({
      scope: 'streamer-1',
      kind: 'comment_page',
      url: 'https://api.bilibili.com/example',
      init: { method: 'GET' },
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.ok(fixture.sleeps.includes(30_000));
    assert.ok(fixture.sleeps.includes(60_000));
    assert.equal(
      fixture.store.requestBudget.get({
        scope: 'streamer-1',
        nowMs: fixture.now,
      }).requestCount,
      3,
    );
  } finally {
    await fixture.scheduler.dispose();
    fixture.db.close();
  }
});

test('scheduler permits one post-429 probe then requires manual recovery', async () => {
  let calls = 0;
  const fixture = createFixture(async () => {
    calls += 1;
    return new Response('{}', { status: 429 });
  });
  try {
    await fixture.scheduler.request({
      scope: 'streamer-1',
      kind: 'comment_page',
      url: 'https://api.bilibili.com/example',
    });
    await fixture.scheduler.request({
      scope: 'streamer-1',
      kind: 'comment_page',
      url: 'https://api.bilibili.com/example',
    });

    await assert.rejects(
      fixture.scheduler.request({
        scope: 'streamer-1',
        kind: 'comment_page',
        url: 'https://api.bilibili.com/example',
      }),
      (error) => error.code === 'LOTTERY_REQUEST_PAUSED',
    );
    assert.equal(calls, 2);
    assert.ok(fixture.sleeps.some((delay) => delay >= 5 * 60 * 1000));

    fixture.scheduler.resume('streamer-1');
    const probe = await fixture.scheduler.request({
      scope: 'streamer-1',
      kind: 'comment_page',
      url: 'https://api.bilibili.com/example',
    });
    assert.equal(probe.status, 429);
    assert.equal(calls, 3);
  } finally {
    await fixture.scheduler.dispose();
    fixture.db.close();
  }
});

test('scheduler waits through the 50-request batch rest', async () => {
  let calls = 0;
  const fixture = createFixture(async () => {
    calls += 1;
    return new Response('{}', { status: 200 });
  });
  try {
    for (let index = 0; index < 51; index += 1) {
      await fixture.scheduler.request({
        scope: 'streamer-1',
        kind: 'comment_page',
        url: 'https://api.bilibili.com/example',
      });
    }

    assert.equal(calls, 51);
    assert.ok(fixture.sleeps.some((delay) => delay >= 60_000));
  } finally {
    await fixture.scheduler.dispose();
    fixture.db.close();
  }
});

test('scheduler serializes concurrent requests', async () => {
  let releaseFirst;
  let calls = 0;
  const fixture = createFixture(async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    }
    return new Response('{}', { status: 200 });
  });
  try {
    const first = fixture.scheduler.request({
      scope: 'streamer-1',
      kind: 'first',
      url: 'https://api.bilibili.com/first',
    });
    const second = fixture.scheduler.request({
      scope: 'streamer-1',
      kind: 'second',
      url: 'https://api.bilibili.com/second',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(calls, 2);
  } finally {
    await fixture.scheduler.dispose();
    fixture.db.close();
  }
});
