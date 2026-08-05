'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  FORTUNES,
  buildFortuneReply,
  createFortuneService,
  pickDailyFortune
} = require('../src/bilibili/fortune-service');
const { isBilibiliCommandText } = require('../src/bilibili/danmaku/command-text');
const { createDomainServices } = require('../src/server/domain-services');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { createSettingsStore } = require('../src/storage/settings-store');

test('fortune bot returns one stable fortune per viewer and Beijing date', () => {
  let currentMs = Date.parse('2026-08-05T01:00:00.000Z');
  const service = createFortuneService({
    settings: () => ({ enableFortuneBot: 'true' }),
    nowMs: () => currentMs
  });

  const first = service.handleDanmaku({ message: '抽签', uid: '123', userName: 'Alice' });
  const repeated = service.handleDanmaku({ message: '抽签', uid: '123', userName: 'Alice' });
  assert.equal(first.accepted, true);
  assert.equal(first.dateKey, '2026-08-05');
  assert.deepEqual(repeated.fortune, first.fortune);
  assert.deepEqual(first.autoReply.target, { uid: '123', name: 'Alice' });
  assert.equal(first.autoReply.message, buildFortuneReply(first.fortune));

  currentMs = Date.parse('2026-08-05T16:00:00.000Z');
  const nextDay = service.handleDanmaku({ message: '抽签', uid: '123', userName: 'Alice' });
  assert.equal(nextDay.dateKey, '2026-08-06');
  assert.deepEqual(nextDay.fortune, pickDailyFortune('123', '2026-08-06'));
});

test('fortune bot ignores other messages, disabled settings, and missing uid', () => {
  const disabled = createFortuneService({
    settings: () => ({ enableFortuneBot: 'false' })
  });
  assert.deepEqual(disabled.handleDanmaku({ message: '路过', uid: '1' }), {
    accepted: false,
    reason: 'not-fortune'
  });
  assert.deepEqual(disabled.handleDanmaku({ message: '抽签', uid: '1' }), {
    accepted: false,
    reason: 'fortune-disabled',
    command: { type: 'fortune' }
  });

  const enabled = createFortuneService({
    settings: () => ({ enableFortuneBot: 'true' })
  });
  assert.equal(enabled.handleDanmaku({ message: '抽签' }).reason, 'missing-uid');
});

test('fortune pool has weighted Chinese sign levels and complete guidance', () => {
  assert.equal(FORTUNES.length, 20);
  assert.deepEqual(
    FORTUNES.reduce((counts, fortune) => {
      counts[fortune.level] = (counts[fortune.level] || 0) + 1;
      return counts;
    }, {}),
    { 上上签: 2, 上吉签: 4, 中吉签: 7, 小吉签: 5, 平签: 2 }
  );
  assert.ok(FORTUNES.every((fortune) => {
    const reply = buildFortuneReply(fortune);
    return reply.includes('宜') && reply.includes('忌');
  }));
  assert.ok(FORTUNES.some((fortune) => Array.from(buildFortuneReply(fortune)).length > 40));
});

test('fortune command participates in danmaku filtering and domain replies', () => {
  assert.equal(isBilibiliCommandText('抽签'), true);
  assert.equal(isBilibiliCommandText('帮我抽签'), false);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-fortune-'));
  const databases = createDatabases({ dataDir });
  const settingsStore = createSettingsStore(databases.songDb);
  settingsStore.setSetting('enableFortuneBot', 'true');
  const services = createDomainServices({
    db: databases,
    settingsStore,
    onGiftFlushed() {}
  });

  try {
    const result = services.messages.handleDanmaku({
      message: '抽签',
      uid: '456',
      userName: 'Bob'
    });
    assert.equal(result.accepted, false);
    assert.equal(result.fortune.accepted, true);
    assert.deepEqual(result.fortuneReply.target, { uid: '456', name: 'Bob' });
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
