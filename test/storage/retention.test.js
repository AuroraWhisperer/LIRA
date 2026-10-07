'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { applyRetentionPolicies } = require('../../src/storage/retention');

const NOW = Date.parse('2026-09-30T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(NOW - days * DAY).toISOString();

function seed(databases) {
  const insertGift = databases.giftDb.prepare(`
    INSERT INTO gift_events (platform_id, cmd, gift_name, total_price, raw_json, created_at, updated_at)
    VALUES (?, 'SEND_GIFT', '礼物', 1, ?, ?, ?)
  `);
  for (const [id, raw, created] of [
    ['old-raw', '{"old":true}', daysAgo(40)],
    ['recent-raw', '{"recent":true}', daysAgo(1)],
  ]) {
    insertGift.run(id, raw, created, created);
  }
  const insertRequest = databases.songDb.prepare(
    'INSERT INTO requests (song_name, created_at) VALUES (?, ?)',
  );
  for (const [name, created] of [
    ['old-request', daysAgo(31)],
    ['boundary-request', daysAgo(30)],
    ['recent-request', daysAgo(1)],
  ]) {
    insertRequest.run(name, created);
  }
  const insertSuperChat = databases.superChatDb.prepare(
    'INSERT INTO super_chats (platform_id, message, created_at, updated_at) VALUES (?, ?, ?, ?)',
  );
  for (const [id, created] of [
    ['old-sc', daysAgo(45)],
    ['recent-sc', daysAgo(2)],
  ]) {
    insertSuperChat.run(id, id, created, created);
  }
}

function snapshot(databases) {
  return {
    gifts: databases.giftDb
      .prepare('SELECT platform_id, raw_json FROM gift_events ORDER BY platform_id')
      .all()
      .map((row) => ({ ...row })),
    requests: databases.songDb
      .prepare('SELECT song_name FROM requests ORDER BY song_name')
      .all()
      .map((row) => row.song_name),
    superChats: databases.superChatDb
      .prepare('SELECT platform_id FROM super_chats ORDER BY platform_id')
      .all()
      .map((row) => row.platform_id),
  };
}

test('retention clears expired raw gift text, requests and SuperChats only after a matching dry run', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-retention-'));
  const databases = createDatabases({ dataDir });
  t.after(() => {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  seed(databases);
  const before = snapshot(databases);
  const policy = {
    giftRawJsonDays: 30,
    giftEventDays: 0,
    requestDays: 30,
    superChatDays: 30,
    aiRequestLogDays: 0,
    cooldownDays: 0,
  };
  const expectedCounts = { giftRawJsonCleared: 1, giftEventsDeleted: 0, requestsDeleted: 1, superChatsDeleted: 1 };
  const pick = (result) => Object.fromEntries(Object.keys(expectedCounts).map((key) => [key, result[key]]));

  const dryRun = applyRetentionPolicies(databases, { dryRun: true, policy });
  assert.deepEqual(pick(dryRun), expectedCounts);
  assert.deepEqual(snapshot(databases), before);

  const applied = applyRetentionPolicies(databases, { policy });
  assert.deepEqual(pick(applied), expectedCounts);
  assert.deepEqual(snapshot(databases), {
    // Raw text is cleared but the parsed gift row is kept.
    gifts: [
      { platform_id: 'old-raw', raw_json: '' },
      { platform_id: 'recent-raw', raw_json: '{"recent":true}' },
    ],
    // A row exactly at the threshold is not yet expired.
    requests: ['boundary-request', 'recent-request'],
    superChats: ['recent-sc'],
  });

  const disabled = applyRetentionPolicies(databases, {
    policy: { ...policy, giftRawJsonDays: 0, requestDays: 0, superChatDays: 0 },
  });
  assert.deepEqual(pick(disabled), {
    giftRawJsonCleared: 0,
    giftEventsDeleted: 0,
    requestsDeleted: 0,
    superChatsDeleted: 0,
  });
  assert.deepEqual(snapshot(databases).requests, ['boundary-request', 'recent-request']);
});
