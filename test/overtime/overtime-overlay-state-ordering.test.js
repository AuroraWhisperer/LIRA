'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabases, closeDatabases, clearAllData } = require('../../src/storage/database');
const { createOvertimeService } = require('../../src/overtime');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();

function snapshot(revision, seconds) {
  return {
    revision,
    status: 'paused',
    effectiveRemainingMs: seconds * 1000,
    rules: [],
  };
}

async function openSocket(page, reconnect = false) {
  await page.evaluate((reconnect) => {
    window.socketOptions.onOpen?.();
    if (reconnect) window.socketOptions.onReconnect();
  }, reconnect);
}

async function sendState(page, state, type = 'snapshot', adjustment = null) {
  await page.evaluate(
    ({ state, type, adjustment }) =>
      window.socketOptions.onMessage({
        type,
        state: type === 'snapshot' ? { overtime: state } : state,
        adjustment,
      }),
    { state, type, adjustment },
  );
}

async function resolveSnapshot(page, index, state) {
  await page.evaluate(({ index, state }) => window.pendingSnapshots[index].resolve(state), { index, state });
}

async function clockValue(page) {
  return page.locator('#overtimeClock').textContent();
}

test('initial HTTP snapshot restores state before a socket is available', async (t) => {
  const page = await fixture(t, 'overlay');
  await resolveSnapshot(page, 0, snapshot(10, 300));
  assert.equal(await clockValue(page), '00:05:00');
});

test('an old initial HTTP response cannot roll back a newer WebSocket state', async (t) => {
  const page = await fixture(t, 'overlay');
  await openSocket(page);
  await sendState(page, snapshot(11, 360));
  await resolveSnapshot(page, 0, snapshot(10, 300));
  assert.equal(await clockValue(page), '00:06:00');
  await sendState(page, snapshot(12, 420), 'overtime:update');
  assert.equal(await clockValue(page), '00:07:00');
});

test('same-connection snapshots and updates share the revision guard', async (t) => {
  const page = await fixture(t, 'overlay');
  await openSocket(page);
  await sendState(page, snapshot(12, 420));
  for (const type of ['snapshot', 'overtime:update']) {
    for (const revision of [11, 12]) {
      await sendState(page, snapshot(revision, 120), type, {
        giftName: 'stale',
        appliedDeltaSeconds: 60,
      });
      assert.equal(await clockValue(page), '00:07:00');
      assert.equal(await page.locator('#overtimeAdjustmentStage').textContent(), '');
    }
  }
  await sendState(page, snapshot(13, 480), 'overtime:update', {
    giftName: 'fresh',
    appliedDeltaSeconds: 60,
  });
  assert.equal(await clockValue(page), '00:08:00');
  assert.match(await page.locator('#overtimeAdjustmentStage').textContent(), /fresh/);
});

test('clear-all synchronizes the existing overtime socket and rejects pre-clear HTTP state', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-overtime-overlay-'));
  const db = createDatabases({ dataDir });
  const service = createOvertimeService({ giftDb: db.giftDb });
  t.after(() => {
    service.dispose();
    closeDatabases(db);
    assert.equal(path.dirname(fs.realpathSync(dataDir)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  service.act('enable');
  service.setTime({ remainingSeconds: 600 });
  const previousState = service.getSnapshot();
  const page = await fixture(t, 'overlay');
  await openSocket(page, true);
  await sendState(page, previousState);
  assert.equal(await clockValue(page), '00:10:00');

  for (let reset = 0; reset < 2; reset += 1) {
    const { songDb, superChatDb, giftDb, musicDb, checkinDb } = db;
    assert.equal(clearAllData(songDb, superChatDb, giftDb, musicDb, checkinDb).cleared, true);
    service.reloadState();
    await sendState(page, service.getSnapshot());
    assert.equal(await clockValue(page), '00:00:00');
    service.act('enable');
    service.setTime({ remainingSeconds: 60 });
    await sendState(page, service.getSnapshot(), 'overtime:update');
    assert.equal(await clockValue(page), '00:01:00');
  }

  await resolveSnapshot(page, 1, previousState);
  assert.equal(await clockValue(page), '00:01:00');
});

test('the first socket after an HTTP-only load can restore a restarted service', async (t) => {
  const page = await fixture(t, 'overlay');
  await resolveSnapshot(page, 0, snapshot(50, 600));
  await openSocket(page);
  await sendState(page, snapshot(1, 60));
  await sendState(page, snapshot(2, 120), 'overtime:update');
  assert.equal(await clockValue(page), '00:02:00');
});

for (const first of ['http', 'websocket']) {
  test(`reconnect accepts a lower restart revision with ${first} first`, async (t) => {
    const page = await fixture(t, 'overlay');
    await openSocket(page);
    await sendState(page, snapshot(50, 600));
    await page.evaluate(() => window.socketOptions.onClose());
    await openSocket(page, true);
    if (first === 'http') {
      await resolveSnapshot(page, 1, snapshot(1, 60));
      await sendState(page, snapshot(2, 120));
    } else {
      await sendState(page, snapshot(2, 120));
      await resolveSnapshot(page, 1, snapshot(1, 60));
    }
    assert.equal(await clockValue(page), '00:02:00');
    await resolveSnapshot(page, 0, snapshot(99, 900));
    assert.equal(await clockValue(page), '00:02:00');
    await sendState(page, snapshot(3, 180), 'overtime:update');
    assert.equal(await clockValue(page), '00:03:00');
  });
}

for (const revision of [10, 11, 12]) {
  test(`reconnect HTTP revision ${revision} is compared with current WS revision 11`, async (t) => {
    const page = await fixture(t, 'overlay');
    await openSocket(page);
    await sendState(page, snapshot(9, 300));
    await page.evaluate(() => window.socketOptions.onClose());
    await openSocket(page, true);
    await sendState(page, snapshot(11, 360));
    await resolveSnapshot(page, 1, snapshot(revision, 420));
    assert.equal(await clockValue(page), revision > 11 ? '00:07:00' : '00:06:00');
  });
}

test('old-connection HTTP completion is ignored while disconnected', async (t) => {
  const page = await fixture(t, 'overlay');
  await openSocket(page);
  await sendState(page, snapshot(10, 300));
  await page.evaluate(() => window.socketOptions.onClose());
  await resolveSnapshot(page, 0, snapshot(99, 900));
  assert.equal(await clockValue(page), '00:05:00');
  assert.equal(await page.locator('#overtimeStatusText').textContent(), '连接中断');
});
