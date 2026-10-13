'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { isBilibiliCommandText } = require('../../src/bilibili/danmaku/command-text');
const {
  createCustomReplyService,
  findCustomReplyRule,
  parseCustomReplyRules,
  normalizeCustomReplyRule,
} = require('../../src/bilibili/custom-reply-service');
const { createDomainServices } = require('../../src/server/domain-services');
const { createBilibiliClient } = require('../../src/server/bilibili-client');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const { DEFAULT_SETTINGS, createSettingsStore } = require('../../src/storage/settings-store');

test('all danmaku reply bots are enabled by default', () => {
  assert.deepEqual(
    [
      DEFAULT_SETTINGS.enableRandomTagReply,
      DEFAULT_SETTINGS.enableCheckinBot,
      DEFAULT_SETTINGS.enableFortuneBot,
      DEFAULT_SETTINGS.enableCustomReplyBot,
    ],
    ['true', 'true', 'true', 'true'],
  );
});

test('custom reply rules normalize and match enabled keyword replies', () => {
  const settings = {
    enableCustomReplyBot: 'true',
    customReplyRules: JSON.stringify([
      { keyword: ' 菜单 ', reply: ' 点歌格式：点歌 歌名 ', enabled: true },
      { keyword: '晚安', reply: '好梦。', enabled: false },
      { keyword: '', reply: 'empty keyword' },
      { keyword: 'empty reply', reply: '' },
    ]),
  };

  assert.deepEqual(parseCustomReplyRules(settings.customReplyRules), [
    { keyword: '菜单', reply: '点歌格式：点歌 歌名', enabled: true },
    { keyword: '晚安', reply: '好梦。', enabled: false },
  ]);
  assert.deepEqual(findCustomReplyRule('主播菜单在哪', settings), {
    keyword: '菜单',
    reply: '点歌格式：点歌 歌名',
    enabled: true,
  });
  assert.equal(findCustomReplyRule('晚安主播', settings), null);
  assert.equal(
    findCustomReplyRule('主播菜单在哪', {
      ...settings,
      enableCustomReplyBot: 'false',
    }),
    null,
  );
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
      customReplyRules: '[{"keyword":"菜单","reply":"点歌格式：点歌 歌名"}]',
    }),
  });

  const result = service.handleDanmaku({
    message: '菜单看看',
    uid: '123',
    userName: 'Alice',
  });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.command, { type: 'custom-reply', keyword: '菜单' });
  assert.deepEqual(result.autoReply, {
    message: '点歌格式：点歌 歌名',
    target: { uid: '123', name: 'Alice' },
  });
  assert.equal(service.handleDanmaku({ message: '路过', uid: '123' }).reason, 'not-custom-reply');
  assert.equal(isBilibiliCommandText('菜单看看', service.isCommandText), true);
});

test('cloud exact commands use trimmed equality and ignore stale projections until account reset', () => {
  const service = createCustomReplyService();
  service.setCloudExactReplySettings({ customExactReplyEnabled: true, customExactReplies: [{ trigger: '月卡', reply: '说明' }] }, 5);
  for (const message of ['菜单', ' 菜单 ', '月卡']) assert.equal(service.isCloudOwnedCommand(message), true);
  assert.equal(service.isCloudOwnedCommand('看看菜单'), false);
  assert.equal(service.isCommandText('月卡'), true);
  service.setCloudExactReplySettings({ customExactReplyEnabled: false, customExactReplies: [] }, 4);
  assert.equal(service.isCloudOwnedCommand('菜单'), true);
  service.setCloudExactReplySettings(null);
  assert.equal(service.isCloudOwnedCommand('菜单'), false);
  service.setCloudExactReplySettings({ customExactReplyEnabled: true, customExactReplies: [] }, 1);
  assert.equal(service.isCloudOwnedCommand('菜单'), true);
  service.setCloudExactReplySettings({}, 2);
  assert.equal(service.isCloudOwnedCommand('菜单'), false);
});

test('domain services attach a custom reply after built-in commands decline', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-custom-reply-'));
  const databases = createDatabases({ dataDir });
  const settingsStore = createSettingsStore(databases.songDb);
  settingsStore.setSetting('enableCustomReplyBot', 'true');
  settingsStore.setSetting(
    'customReplyRules',
    JSON.stringify([
      { keyword: '菜单', reply: '点歌格式：点歌 歌名', enabled: true },
      { keyword: '签到', reply: '不会覆盖签到', enabled: true },
      { keyword: '抽签', reply: '不会覆盖抽签', enabled: true },
      { keyword: '随机点歌', reply: '不会抢占随机点歌', enabled: true },
    ]),
  );
  const services = createDomainServices({
    db: databases,
    settingsStore,
    onGiftFlushed() {},
  });

  try {
    const random = services.messages.handleDanmaku({
      message: '随机点歌',
      uid: '456',
      userName: 'Bob',
    });
    assert.equal(random.command.type, 'random');
    assert.equal(random.customReply, undefined);
    assert.equal(random.customReplyReply, undefined);

    const custom = services.messages.handleDanmaku({
      message: '看看菜单',
      uid: '456',
      userName: 'Bob',
    });
    assert.equal(custom.accepted, false);
    assert.equal(custom.customReply.accepted, true);
    assert.equal(custom.customReplyReply.message, '点歌格式：点歌 歌名');
    assert.deepEqual(custom.customReplyReply.target, {
      uid: '456',
      name: 'Bob',
    });

    const checkin = services.messages.handleDanmaku({
      message: '签到',
      uid: '456',
      userName: 'Bob',
    });
    assert.equal(checkin.reason, 'cloud-owned');
    assert.equal(checkin.customReplyReply, undefined);
    for (const enabled of ['true', 'false']) {
      settingsStore.setSetting('enableCheckinBot', enabled);
      settingsStore.setSetting('enableFortuneBot', enabled);
      for (const message of [' 签到 ', '抽签']) {
        const result = services.messages.handleDanmaku({ message, uid: '456', userName: 'Bob' });
        assert.equal(result.reason, 'cloud-owned');
        assert.equal(result.customReplyReply, undefined);
      }
    }
    assert.equal(databases.checkinDb.prepare('SELECT count(*) AS n FROM checkin_users').get().n, 0);
    services.customReplies.setCloudExactReplySettings({
      customExactReplyEnabled: true,
      customExactReplies: [{ trigger: '随机点歌', reply: '不会覆盖系统指令' }],
    }, 1);
    const exact = services.messages.handleDanmaku({ message: ' 菜单 ', uid: '456', userName: 'Bob' });
    assert.equal(exact.reason, 'cloud-owned');
    assert.equal(exact.customReplyReply, undefined);
    assert.equal(services.messages.handleDanmaku({ message: '随机点歌', uid: '456' }).command.type, 'random');
    assert.equal(services.messages.handleDanmaku({ message: '看看菜单', uid: '456' }).customReply.accepted, true);
    const deliveries = [];
    const replies = [];
    const client = createBilibiliClient('123', {
      isShuttingDown: () => false,
      aiDanmakuDeliveryVerifier: { observe() {} },
      domainServices: services,
      aiAssistant: { handleDanmaku: () => deliveries.push('ai') },
      danmakuSender: { send: async (reply) => { replies.push(reply); deliveries.push('keyword'); } },
      broadcastSnapshot() {}, updateLiveStatus() {},
      bilibiliDiagnostics: {}, bilibiliAuthCache: { cookieHeader: '', uid: 0 },
    });
    try {
      client.handlers.onMessage({ message: '菜单', uid: '456', userName: 'Bob' });
      assert.deepEqual(deliveries, [], 'a server-owned exact command must not also trigger local AI or keyword replies');
      client.handlers.onMessage({ message: '看看菜单', uid: '456', userName: 'Bob' });
      assert.deepEqual(deliveries, ['ai', 'keyword']);
      assert.deepEqual(replies[0], {
        message: custom.customReplyReply.message,
        mentionTarget: { uid: '456', name: 'Bob' },
        mentionEveryChunk: true,
      });
      settingsStore.setSetting('enableRandomTagReply', 'true');
      client.handlers.onMessage({ message: '随机点歌 不存在的分类', uid: '789', userName: 'Alice' });
      assert.equal(replies.length, 2);
      assert.deepEqual(replies[1].mentionTarget, { uid: '789', name: 'Alice' });
      assert.equal(replies[1].mentionEveryChunk, true);
    } finally {
      client.stop();
    }
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
