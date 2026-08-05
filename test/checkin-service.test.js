'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCheckinService, chinaDateKey } = require('../src/bilibili/checkin-service');
const {
  CHECKIN_BLESSINGS,
  parseCheckinBlessings,
  pickCheckinBlessing
} = require('../src/bilibili/checkin-blessings');
const { isBilibiliCommandText } = require('../src/bilibili/danmaku/command-text');
const { createDomainServices } = require('../src/server/domain-services');
const { closeDatabases, createDatabases, getSchemaVersions } = require('../src/storage/database');
const { createCheckinStore } = require('../src/storage/checkin-store');
const { createSettingsStore } = require('../src/storage/settings-store');

test('check-in bot records first, duplicate, and next-day check-ins by uid', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-checkin-'));
  const databases = createDatabases({ dataDir });
  let currentMs = Date.parse('2026-08-04T16:30:00.000Z');
  const service = createCheckinService({
    store: createCheckinStore(databases.checkinDb),
    settings: () => ({ enableCheckinBot: 'true' }),
    nowMs: () => currentMs,
    pickBlessing: () => '祝你今天顺利。'
  });

  try {
    assert.equal(getSchemaVersions(databases).checkinDb, 1);
    assert.equal(chinaDateKey(currentMs), '2026-08-05');

    const first = service.handleDanmaku({ message: '签到', uid: '123', userName: 'Alice' });
    assert.equal(first.accepted, true);
    assert.equal(first.record.totalDays, 1);
    assert.equal(first.record.alreadyCheckedToday, false);
    assert.equal(first.autoReply.message, '已签到 1 天。祝你今天顺利。');
    assert.deepEqual(first.autoReply.target, { uid: '123', name: 'Alice' });

    const duplicate = service.handleDanmaku({ message: '签到', uid: '123', userName: 'AliceNew' });
    assert.equal(duplicate.record.totalDays, 1);
    assert.equal(duplicate.record.alreadyCheckedToday, true);
    assert.equal(duplicate.autoReply.message, '今天已经签到过啦，已累计 1 天。祝你今天顺利。');

    currentMs = Date.parse('2026-08-05T17:00:00.000Z');
    const nextDay = service.handleDanmaku({ message: '签到', uid: '123', userName: 'AliceNew' });
    assert.equal(nextDay.record.totalDays, 2);
    assert.equal(nextDay.record.alreadyCheckedToday, false);

    const row = databases.checkinDb.prepare('SELECT uid, user_name, total_days, last_checkin_date FROM checkin_users WHERE uid = ?')
      .get('123');
    assert.equal(row.uid, '123');
    assert.equal(row.user_name, 'AliceNew');
    assert.equal(row.total_days, 2);
    assert.equal(row.last_checkin_date, '2026-08-06');
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('check-in bot ignores non-check-in messages and disabled settings', () => {
  let touched = false;
  const service = createCheckinService({
    store: {
      checkIn() {
        touched = true;
      }
    },
    settings: () => ({ enableCheckinBot: 'false' })
  });

  assert.deepEqual(service.handleDanmaku({ message: '点歌 晴天', uid: '1' }), {
    accepted: false,
    reason: 'not-checkin'
  });
  assert.deepEqual(service.handleDanmaku({ message: '签到', uid: '1' }), {
    accepted: false,
    reason: 'checkin-disabled',
    command: { type: 'checkin' }
  });
  assert.equal(touched, false);
});

test('check-in command participates in danmaku command filtering', () => {
  assert.equal(isBilibiliCommandText('签到'), true);
  assert.equal(isBilibiliCommandText('点歌 晴天'), true);
  assert.equal(isBilibiliCommandText('路过'), false);
});

test('check-in blessings provide thirty reusable Chinese phrases', () => {
  assert.equal(CHECKIN_BLESSINGS.length, 30);
  assert.ok(CHECKIN_BLESSINGS.every((item) => typeof item === 'string' && item.length > 0));
  assert.equal(new Set(CHECKIN_BLESSINGS).size, 30);
});

test('check-in blessings use saved phrases and recover from invalid settings', () => {
  assert.deepEqual(parseCheckinBlessings('[" 祝你天天开心。 ",""]'), ['祝你天天开心。']);
  assert.equal(pickCheckinBlessing('["祝你万事顺遂。"]'), '祝你万事顺遂。');
  assert.deepEqual(parseCheckinBlessings('not-json'), CHECKIN_BLESSINGS);
  assert.deepEqual(parseCheckinBlessings('[]'), CHECKIN_BLESSINGS);
});

test('domain services attach a check-in reply without accepting it as a song request', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-checkin-domain-'));
  const databases = createDatabases({ dataDir });
  const settingsStore = createSettingsStore(databases.songDb);
  settingsStore.setSetting('enableCheckinBot', 'true');
  settingsStore.setSetting('checkinBlessings', JSON.stringify(['祝你万事顺遂。']));
  const services = createDomainServices({
    db: databases,
    settingsStore,
    onGiftFlushed() {}
  });

  try {
    const result = services.messages.handleDanmaku({
      message: '签到',
      uid: '456',
      userName: 'Bob'
    });
    assert.equal(result.accepted, false);
    assert.equal(result.checkin.accepted, true);
    assert.equal(result.checkinReply.message, '已签到 1 天。祝你万事顺遂。');
    assert.deepEqual(result.checkinReply.target, { uid: '456', name: 'Bob' });
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
