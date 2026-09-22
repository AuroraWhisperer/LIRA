'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabases, closeDatabases } = require('../../src/storage/database');
const { createFanProfileStore } = require('../../src/storage/fan-profile-store');
const { createFanProfileService } = require('../../src/fans/profile-service');

const SCOPE = JSON.stringify(['https://lira.example', 'streamer-a']);
const IDENTITY = { platform: 'bilibili', type: 'uid', value: '900000001' };
const NOW = '2026-09-18T04:00:00.000Z';

function fanFixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-fan-test-'));
  let currentTime = NOW;
  let db;
  let store;
  let service;
  function open() {
    db = createDatabases({ dataDir });
    store = createFanProfileStore(db.songDb);
    service = createFanProfileService({ store, now: () => currentTime });
  }
  open();
  service.execute(SCOPE, 'configure', { autoCreate: true, autoUpdate: true });
  t.after(() => {
    closeDatabases(db);
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('lira-fan-test-'));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const fixture = {
    get db() {
      return db;
    },
    get store() {
      return store;
    },
    get service() {
      return service;
    },
    setNow(value) {
      currentTime = value;
    },
    restart() {
      closeDatabases(db);
      open();
    },
    run(action, input = {}, scope = SCOPE) {
      return service.execute(scope, action, input);
    },
    create(input = {}, scope = SCOPE) {
      return service.execute(scope, 'create', { alias: '小海', identity: IDENTITY, ...input });
    },
    detail(profileId, scope = SCOPE) {
      return service.execute(scope, 'detail', { id: profileId });
    },
    record(profileId, kind, data, extra = {}) {
      return service.execute(SCOPE, 'save-record', { profileId, kind, data, ...extra }).record;
    },
    consume(events, extra = {}, scope = SCOPE) {
      const settings = store.getScope(scope);
      const after = settings.cursor || 0;
      return service.consumeFacts(scope, {
        version: 1,
        streamerId: JSON.parse(scope)[1],
        epoch: settings.epoch || 'fixture-epoch',
        after,
        nextCursor: after + events.length,
        events: events.map((event, index) => ({
          cursor: after + index + 1,
          id: `fixture-${after + index + 1}`,
          identity: IDENTITY,
          observedAt: currentTime,
          kind: 'identity',
          name: '海边听歌',
          nameComplete: true,
          ...event,
        })),
        ...extra,
      });
    },
  };
  return fixture;
}

function interval(start, end, extra = {}) {
  return { type: 'interval', precision: 'date', start, end, level: 3, ...extra };
}

module.exports = { fanFixture, interval, SCOPE, IDENTITY, NOW };
