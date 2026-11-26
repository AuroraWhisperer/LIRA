'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameSessionService } = require('../../src/games/game-session-service');
const { HistoryPoller } = require('../../src/bilibili/danmaku/history-poller');

test('a history poll finishing during a replacement game only plays commands from its lifetime', async t => {
  const base = 1_800_000_000_000;
  let now = base;
  t.mock.method(Date, 'now', () => now);
  const games = createGameSessionService({ wallNow: () => now });
  t.after(() => games.dispose());
  t.mock.method(Math, 'random', () => 0.5);
  const read = Promise.withResolvers();
  const results = [];
  const poller = new HistoryPoller({ fetchHistory: () => read.promise }, message => {
    results.push(games.handleDanmaku(message).accepted);
  }, { startedAtMs: base });
  const config = { game: 'number-bomb', mode: 'single', targetUid: '42' };
  games.start(config);
  const polling = poller.pollHistory({ roomId: '123' });
  games.stop();
  now += 2000;
  games.start(config);
  games.move({ value: 1 });
  now += 1000;
  read.resolve({ room: [
    { uid: '42', text: '点歌 2', timeline: base + 1000 },
    { uid: '42', text: '点歌 3', timeline: now },
  ] });
  await polling;
  assert.deepEqual(results, [false, true]);
});

test('a viewer guesses a complete integer without taking a turn on fractions or negative numbers', (t) => {
  t.mock.method(Math, 'random', () => 0.495);
  const service = createGameSessionService();
  t.after(() => service.dispose());
  service.start({ game: 'number-bomb', mode: 'single', targetUid: '42' });
  service.move({ value: 47 }, 'host');
  const guess = (message) => service.handleDanmaku({ uid: '42', message });
  const revision = service.getSession().eventRevision;
  for (const message of ['50.5', '0.50', '50．５', '50.５', '０．50', '-50', '我猜 −50！']) {
    assert.equal(guess(message).accepted, false, message);
  }
  assert.equal(service.getSession().eventRevision, revision);
  assert.equal(guess('我猜 48！').accepted, true);
  service.move({ value: 49 }, 'host');
  assert.equal(guess('我猜...50').hit, true);
  assert.equal(service.getSession().winner.role, 'host');
});
