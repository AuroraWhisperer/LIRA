'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { FORTUNES } = require('../src/shared/bot-defaults');
const { isBilibiliCommandText } = require('../src/bilibili/danmaku/command-text');
const { createDomainServices } = require('../src/server/domain-services');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { createSettingsStore } = require('../src/storage/settings-store');

test('fortune pool has weighted Chinese sign levels and complete guidance', () => {
  assert.equal(FORTUNES.length, 20);
  assert.deepEqual(
    FORTUNES.reduce((counts, fortune) => {
      counts[fortune.level] = (counts[fortune.level] || 0) + 1;
      return counts;
    }, {}),
    { 上上签: 2, 上吉签: 4, 中吉签: 7, 小吉签: 5, 平签: 2 },
  );
  assert.ok(
    FORTUNES.every((fortune) => {
      return (
        [fortune.level, fortune.name, fortune.text, fortune.advice].every(
          (value) => typeof value === 'string' && value.length > 0,
        ) &&
        fortune.advice.includes('宜') &&
        fortune.advice.includes('忌')
      );
    }),
  );
});

test('fortune command is filtered and reserved for cloud execution', () => {
  assert.equal(isBilibiliCommandText('抽签'), true);
  assert.equal(isBilibiliCommandText('帮我抽签'), false);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-fortune-'));
  const databases = createDatabases({ dataDir });
  const settingsStore = createSettingsStore(databases.songDb);
  settingsStore.setSetting('enableFortuneBot', 'true');
  const services = createDomainServices({
    db: databases,
    settingsStore,
    onGiftFlushed() {},
  });

  try {
    const result = services.messages.handleDanmaku({
      message: '抽签',
      uid: '456',
      userName: 'Bob',
    });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'cloud-owned');
    assert.deepEqual(result.command, { type: 'fortune' });
    assert.equal(result.fortuneReply, undefined);
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
