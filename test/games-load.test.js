'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');
const { createGameSessionService } = require('../src/games/game-session-service');

test('a burst of correct guesses publishes one complete result per message without dropping scores', () => {
  let updates = 0;
  let latest;
  const service = createGameSessionService({
    monotonicNow: () => 1000,
    wallNow: () => 1_800_000_000_000,
    setTimeout: () => null,
    clearTimeout() {},
    drawGuessWords: [{ word: '猫', category: '动物' }],
    broadcast(event) { updates++; latest = event.session; },
  });
  try {
    service.start({ game: 'draw-guess' });
    updates = 0;
    for (let index = 0; index < 1000; index++) {
      const result = service.handleDanmaku({ uid: String(index + 1), userName: `Viewer ${index}`, message: '猫' });
      assert.equal(result.accepted, true);
    }
    assert.equal(updates, 1000, 'each accepted message should publish its complete result once');
    assert.equal(latest.state.correct.length, 1000);
    assert.equal(latest.state.scores.length, 1000);
    assert.equal(latest.state.scores.reduce((sum, viewer) => sum + viewer.score, 0), 10 + 7 + 5 + 997 * 3);
    assert.equal(latest.danmaku.length, 500);
    assert.equal(Object.hasOwn(latest.state, 'answer'), false);
    assert.equal(service.handleDanmaku({ uid: '1001', message: '狗' }).accepted, false);
    assert.equal(updates, 1001, 'an incorrect guess still appears in chat');
    assert.equal(latest.state.correct.length, 1000);
  } finally {
    service.dispose();
  }
});

function measuredGameService() {
  let wallMs = 1_800_000_000_000;
  let monotonicMs = 0;
  let visits = 0;
  const maps = [];
  class CountedMap extends Map {
    constructor(...args) {
      super(...args);
      maps.push(this);
    }
    *[Symbol.iterator]() {
      for (const entry of super[Symbol.iterator]()) {
        visits++;
        yield entry;
      }
    }
  }
  const filename = path.join(__dirname, '../src/games/game-session-service.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: createRequire(filename),
    Map: CountedMap,
    Date: class extends Date {
      static now() { return wallMs; }
    },
  }, { filename });
  const service = module.exports.createGameSessionService({
    wallNow: () => wallMs,
    monotonicNow: () => monotonicMs,
    setTimeout: () => null,
    clearTimeout() {},
  });
  return {
    service,
    get visits() { return visits; },
    get retained() { return maps.reduce((total, map) => total + map.size, 0); },
    advance(ms) { wallMs += ms; monotonicMs += ms; },
    shiftWall(ms) { wallMs += ms; },
  };
}

test('viewer ingestion does linear expiry work for a burst of distinct and repeated viewers', () => {
  const f = measuredGameService();
  const count = 3000;
  for (let index = 0; index < count; index++) {
    f.service.handleDanmaku({ uid: String(index + 1), userName: `Viewer ${index}`, message: 'hello' });
  }
  for (let index = 0; index < count; index++) {
    f.service.handleDanmaku({ uid: '1', userName: 'Renamed viewer', message: 'hello again' });
  }
  assert.equal(f.service.listViewers().length, count);
  assert.equal(f.retained, count);
  assert.ok(f.visits <= 4 * count, `expiry inspected ${f.visits} entries for ${count * 2} messages`);
  assert.equal(f.service.listViewers().find((viewer) => viewer.uid === '1').name, 'Renamed viewer');
  f.service.dispose();
});

test('viewer expiry keeps a refreshed UID and uses elapsed time through a wall clock rollback', () => {
  const f = measuredGameService();
  f.service.handleDanmaku({ uid: '1', userName: 'A' });
  f.service.handleDanmaku({ uid: '2', userName: 'B' });
  f.advance(5 * 60_000);
  f.service.handleDanmaku({ uid: '1', userName: 'A updated' });
  f.shiftWall(-7 * 24 * 60 * 60_000);
  f.advance(5 * 60_000 + 1);
  const viewers = JSON.parse(JSON.stringify(f.service.listViewers()));
  assert.deepEqual(viewers.map((viewer) => viewer.uid), ['1']);
  assert.deepEqual(Object.keys(viewers[0]).sort(), ['lastSeenAt', 'name', 'uid']);
  f.advance(5 * 60_000);
  assert.equal(f.service.listViewers().length, 0);
  assert.equal(f.retained, 0);
  f.service.dispose();
});

for (const hours of [12, 24, 168]) {
  test(`viewer resources cover only the recent ten-minute window after ${hours} virtual hours`, () => {
    const f = measuredGameService();
    for (let minute = 0; minute < hours * 60; minute++) {
      f.service.handleDanmaku({ uid: String(minute + 1), userName: `Viewer ${minute}` });
      assert.ok(f.retained <= 11);
      f.advance(60_000);
    }
    assert.equal(f.service.listViewers().length, 10);
    assert.equal(f.retained, 10);
    assert.ok(f.visits <= 2 * hours * 60 + 11);
    f.service.dispose();
  });
}
