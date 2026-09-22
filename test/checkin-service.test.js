'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CHECKIN_BLESSINGS } = require('../src/shared/bot-defaults');
const { isBilibiliCommandText } = require('../src/bilibili/danmaku/command-text');
const { createDomainServices } = require('../src/server/domain-services');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { createSettingsStore } = require('../src/storage/settings-store');

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

test('domain services reserve cloud check-in without writing or replying locally', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-checkin-domain-'));
  const databases = createDatabases({ dataDir });
  const settingsStore = createSettingsStore(databases.songDb);
  settingsStore.setSetting('enableCheckinBot', 'true');
  settingsStore.setSetting('checkinBlessings', JSON.stringify(['祝你万事顺遂。']));
  const services = createDomainServices({
    db: databases,
    settingsStore,
    onGiftFlushed() {},
  });

  try {
    const result = services.messages.handleDanmaku({
      message: '签到',
      uid: '456',
      userName: 'Bob',
    });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'cloud-owned');
    assert.deepEqual(result.command, { type: 'checkin' });
    assert.equal(result.checkinReply, undefined);
    assert.equal(databases.checkinDb.prepare('SELECT count(*) AS count FROM checkin_users').get().count, 0);
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
