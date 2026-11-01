'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { isBilibiliCommandText } = require('../../src/bilibili/danmaku/command-text');
const { createDomainServices } = require('../../src/server/domain-services');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { createSettingsStore } = require('../../src/storage/settings-store');

test('check-in and fortune commands participate in danmaku command filtering', () => {
  for (const [text, expected] of [['签到', true], ['抽签', true], ['点歌 晴天', true], ['路过', false], ['帮我抽签', false]]) {
    assert.equal(isBilibiliCommandText(text), expected, text);
  }
});

for (const [message, type, setting, reply] of [
  ['签到', 'checkin', 'enableCheckinBot', 'checkinReply'],
  ['抽签', 'fortune', 'enableFortuneBot', 'fortuneReply'],
]) {
  test(`domain services reserve the ${type} command for the cloud without writing or replying locally`, (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `lira-daily-bot-${type}-`));
    const databases = createDatabases({ dataDir });
    t.after(() => {
      closeDatabases(databases);
      fs.rmSync(dataDir, { recursive: true, force: true });
    });
    const settingsStore = createSettingsStore(databases.songDb);
    settingsStore.setSetting(setting, 'true');
    settingsStore.setSetting('checkinBlessings', JSON.stringify(['祝你万事顺遂。']));
    const services = createDomainServices({ db: databases, settingsStore, onGiftFlushed() {} });
    const result = services.messages.handleDanmaku({ message, uid: '456', userName: 'Bob' });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'cloud-owned');
    assert.deepEqual(result.command, { type });
    assert.equal(result[reply], undefined);
    assert.equal(databases.checkinDb.prepare('SELECT count(*) AS count FROM checkin_users').get().count, 0);
  });
}
