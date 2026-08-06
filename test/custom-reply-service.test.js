'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { isBilibiliCommandText } = require('../src/bilibili/danmaku/command-text');
const {
  createCustomReplyService,
  findCustomReplyRule,
  parseCustomReplyRules,
  normalizeCustomReplyRule
} = require('../src/bilibili/custom-reply-service');
const { createDomainServices } = require('../src/server/domain-services');
const { closeDatabases, createDatabases } = require('../src/storage/database');
const { createSettingsStore } = require('../src/storage/settings-store');

test('custom reply rules normalize and match enabled keyword replies', () => {
  const settings = {
    enableCustomReplyBot: 'true',
    customReplyRules: JSON.stringify([
      { keyword: ' 菜单 ', reply: ' 点歌格式：点歌 歌名 ', enabled: true },
      { keyword: '晚安', reply: '好梦。', enabled: false },
      { keyword: '', reply: 'empty keyword' },
      { keyword: 'empty reply', reply: '' }
    ])
  };

  assert.deepEqual(parseCustomReplyRules(settings.customReplyRules), [
    { keyword: '菜单', reply: '点歌格式：点歌 歌名', enabled: true },
    { keyword: '晚安', reply: '好梦。', enabled: false }
  ]);
  assert.deepEqual(findCustomReplyRule('主播菜单在哪', settings), {
    keyword: '菜单',
    reply: '点歌格式：点歌 歌名',
    enabled: true
  });
  assert.equal(findCustomReplyRule('晚安主播', settings), null);
  assert.equal(findCustomReplyRule('主播菜单在哪', { ...settings, enableCustomReplyBot: 'false' }), null);
});

test('custom replies preserve special symbols when applying the length limit', () => {
  const reply = `${'\u{1F680}'.repeat(119)}\u{1F600}`;
  const normalized = normalizeCustomReplyRule({ keyword: '\u{1F3AE}', reply });

  assert.equal(Array.from(normalized.keyword).length, 1);
  assert.equal(Array.from(normalized.reply).length, 120);
  assert.equal(normalized.reply.endsWith('\u{1F600}'), true);
  assert.equal(normalized.reply.includes('\uFFFD'), false);
});

test('custom reply service creates targeted automatic replies', () => {
  const service = createCustomReplyService({
    settings: () => ({
      enableCustomReplyBot: 'true',
      customReplyRules: '[{"keyword":"菜单","reply":"点歌格式：点歌 歌名"}]'
    })
  });

  const result = service.handleDanmaku({ message: '菜单看看', uid: '123', userName: 'Alice' });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.command, { type: 'custom-reply', keyword: '菜单' });
  assert.deepEqual(result.autoReply, {
    message: '点歌格式：点歌 歌名',
    target: { uid: '123', name: 'Alice' }
  });
  assert.equal(service.handleDanmaku({ message: '路过', uid: '123' }).reason, 'not-custom-reply');
  assert.equal(isBilibiliCommandText('菜单看看', service.isCommandText), true);
});

test('domain services attach a custom reply after built-in commands decline', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-custom-reply-'));
  const databases = createDatabases({ dataDir });
  const settingsStore = createSettingsStore(databases.songDb);
  settingsStore.setSetting('enableCustomReplyBot', 'true');
  settingsStore.setSetting('customReplyRules', JSON.stringify([
    { keyword: '菜单', reply: '点歌格式：点歌 歌名', enabled: true },
    { keyword: '签到', reply: '不会覆盖签到', enabled: true },
    { keyword: '随机点歌', reply: '不会抢占随机点歌', enabled: true }
  ]));
  const services = createDomainServices({
    db: databases,
    settingsStore,
    onGiftFlushed() {}
  });

  try {
    const random = services.messages.handleDanmaku({
      message: '随机点歌',
      uid: '456',
      userName: 'Bob'
    });
    assert.equal(random.command.type, 'random');
    assert.equal(random.customReply, undefined);
    assert.equal(random.customReplyReply, undefined);

    const custom = services.messages.handleDanmaku({
      message: '看看菜单',
      uid: '456',
      userName: 'Bob'
    });
    assert.equal(custom.accepted, false);
    assert.equal(custom.customReply.accepted, true);
    assert.equal(custom.customReplyReply.message, '点歌格式：点歌 歌名');
    assert.deepEqual(custom.customReplyReply.target, { uid: '456', name: 'Bob' });

    const checkin = services.messages.handleDanmaku({
      message: '签到',
      uid: '456',
      userName: 'Bob'
    });
    assert.equal(checkin.checkin.accepted, true);
    assert.equal(checkin.customReplyReply, undefined);
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
