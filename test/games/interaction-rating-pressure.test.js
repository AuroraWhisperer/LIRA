'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const vm = require('node:vm');

// Counts every Map/Set the session service creates so retained state can be measured.
for (const scenario of [
  { reliableIds: false, users: 64 },
  { reliableIds: true, users: 64 },
  { reliableIds: false, users: 50000 },
]) {
  test(`rating pressure retains exact state: IDs=${scenario.reliableIds}, users=${scenario.users}`, (t) => {
    const maps = [];
    const sets = [];
    class CountedMap extends Map {
      constructor(...args) {
        super(...args);
        maps.push(this);
      }
    }
    class CountedSet extends Set {
      constructor(...args) {
        super(...args);
        sets.push(this);
      }
    }
    const filename = path.join(__dirname, '../../src/games/interaction-session-service.js');
    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(filename, 'utf8'),
      {
        module,
        require: createRequire(filename),
        Map: CountedMap,
        Set: CountedSet,
      },
      { filename },
    );
    const source = { ready: true, accountUid: '80000', roomId: '100', ownerUid: '90000', connectionKey: '1' };
    let listener = null;
    let tasks = 0;
    const service = module.exports.createInteractionSessionService({
      now: () => 1000,
      wallNow: () => 1_800_000_000_000,
      getSourceState: () => source,
      subscribe(callback) {
        listener = callback;
        return () => {
          listener = null;
        };
      },
      setTimeout() {
        tasks++;
        return {};
      },
      clearTimeout() {},
    });
    t.after(() => service.dispose());
    const id = service.start({ kind: 'rating' }).session.sessionId;
    const expected = new Map();
    const started = performance.now();
    for (let index = 0; index < 50000; index++) {
      const uid = String(1 + (index % scenario.users));
      const score = 1 + (index % 10);
      listener({
        ...source,
        source: 'danmaku',
        receivedAt: 1000,
        platformTime: 1,
        eventId: scenario.reliableIds ? `event-${index}` : null,
        uid,
        message: String(score),
      });
      expected.set(uid, score);
    }
    if (scenario.reliableIds) {
      listener({
        ...source,
        source: 'danmaku',
        receivedAt: 1000,
        platformTime: 1,
        eventId: 'event-0',
        uid: '1',
        message: '10',
      });
    }
    assert.equal(service.getHostState().participants, scenario.users);
    assert.equal(tasks, 0);
    const retainedTimestamps = maps.reduce((sum, map) => sum + map.size, 0);
    const retainedEventIds = sets.reduce((sum, set) => sum + set.size, 0);
    assert.equal(retainedTimestamps, scenario.users);
    assert.equal(retainedEventIds, scenario.reliableIds ? 50000 : 0);
    const final = service.finish(id);
    assert.equal(final.session.average, [...expected.values()].reduce((sum, value) => sum + value, 0) / expected.size);
    assert.equal(listener, null);
    assert.equal(
      maps.reduce((sum, map) => sum + map.size, 0),
      0,
    );
    assert.equal(
      sets.reduce((sum, set) => sum + set.size, 0),
      0,
    );
    service.clear(id);
    assert.equal(service.getState().session, null);
    t.diagnostic(
      JSON.stringify({
        scenario: 'rating',
        ...scenario,
        messages: 50000,
        retainedTimestamps,
        retainedEventIds,
        elapsedMs: Number((performance.now() - started).toFixed(2)),
      }),
    );
  });
}
