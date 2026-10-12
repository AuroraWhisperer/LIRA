'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildDesktopMenuCommands } = require('../../src/server/danmaku-menu');
const { createServerRuntime } = require('../../src/server');
const { CLOUD_SYNC_KEYS, hasCloudSettingChanges } = require('../../src/shared/cloud-settings');

const settings = { danmakuMonitoringEnabled: 'true', paused: 'false' };

test('desktop menu follows monitoring, pause and ready AI configuration without listing automatic actions', () => {
  assert.deepEqual(buildDesktopMenuCommands({ settings }), ['点歌 歌名', '随机点歌 [条件]']);
  const ai = { ready: true, trigger: '小米', deepseekApiKey: 'secret' };
  assert.deepEqual(buildDesktopMenuCommands({ settings: { ...settings, paused: 'true' }, ai }), ['小米 问题（AI 互动）']);
  assert.deepEqual(buildDesktopMenuCommands({ settings: { ...settings, danmakuMonitoringEnabled: 'false' }, ai }), []);
  assert.deepEqual(buildDesktopMenuCommands({ settings: { ...settings, paused: 'true' }, ai: { ...ai, ready: false } }), []);
});

test('keyword menu describes enabled rules without uploading their private replies or cloud exact triggers', () => {
  const value = {
    ...settings, paused: 'true', enableCustomReplyBot: 'true',
    customReplyRules: JSON.stringify([{ keyword: 'xx', reply: 'private reply' }]),
  };
  assert.deepEqual(buildDesktopMenuCommands({ settings: value }), ['关键词回复（发送已设置关键词）']);
  assert.deepEqual(buildDesktopMenuCommands({ settings: { ...value, enableCustomReplyBot: 'false' } }), []);
  assert.deepEqual(buildDesktopMenuCommands({ settings: { ...value, customReplyRules: '[{"keyword":"xx","reply":"text","enabled":false}]' } }), []);
  assert.equal(hasCloudSettingChanges(['customReplyRules']), true);
  assert.equal(hasCloudSettingChanges(['enableCustomReplyBot']), true);
  assert.equal(CLOUD_SYNC_KEYS.includes('customReplyRules'), false);
});

test('menu includes only accepting sessions and clearly identifies ongoing interactions', () => {
  const current = (input) => buildDesktopMenuCommands({ settings: { ...settings, paused: 'true' }, ...input });
  assert.deepEqual(current({ interaction: { kind: 'poll', phase: 'collecting', connected: true } }), ['投票（进行中）：完整发送当前选项']);
  assert.deepEqual(current({ interaction: { kind: 'rating', phase: 'collecting', connected: true } }), ['评分（进行中）：发送 1—10']);
  assert.deepEqual(current({ interaction: { kind: 'poll', phase: 'finished', connected: true } }), []);
  assert.deepEqual(current({ interaction: { kind: 'rating', phase: 'collecting', connected: false } }), []);
  assert.deepEqual(current({ game: { game: 'gomoku', state: { turn: 'viewer', winner: '' } } }), ['五子棋（进行中）：发送坐标 A1—O15']);
  assert.deepEqual(current({ game: { game: 'gomoku', state: { turn: 'host', winner: '' } } }), []);
  assert.deepEqual(current({ game: { game: 'number-bomb', state: { turn: 'viewer', winner: '' } } }), ['数字炸弹（进行中）：发送当前范围内数字']);
  assert.deepEqual(current({ game: { game: 'number-bomb', state: { turn: 'viewer', winner: 'host' } } }), []);
  assert.deepEqual(current({ game: { game: 'draw-guess', state: { phase: 'drawing' } } }), ['你画我猜（进行中）：发送答案']);
  assert.deepEqual(current({ game: { game: 'draw-guess', state: { phase: 'round-result' } } }), []);
});

test('current menu is projected into pending uploads and changes request cloud sync without storing menu state', async (t) => {
  const scratchRoot = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(scratchRoot, 'danmaku-menu-'));
  const runtime = createServerRuntime({ dataDir, licenseGate: { isAuthorized: () => true },
    aiSecretCodec: { encrypt: value => value, decrypt: value => value } });
  const requested = [];
  const unsubscribe = runtime.onCloudSyncRequested((scope) => requested.push(scope));
  t.after(async () => {
    unsubscribe();
    await runtime.stop({ exitProcess: false });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const server = await runtime.start({ host: '127.0.0.1', startPort: 0 });
  const accountKey = 'menu-test-account';
  runtime.prepareCloudRoomAccount(accountKey);
  const request = async (endpoint, body, method = 'POST') => {
    const response = await fetch(`${server.baseUrl}${endpoint}`, {
      method, body: JSON.stringify(body), headers: {
        authorization: `Bearer ${runtime.getApiToken()}`, 'content-type': 'application/json', origin: server.baseUrl,
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload;
  };
  await request('/api/settings', { paused: true, danmakuMonitoringEnabled: true, enableCustomReplyBot: false });
  const pendingId = runtime.getPendingCloudSettings(accountKey).mutationId;
  requested.length = 0;
  const configuredAi = await request('/api/ai/config', { enabled: true, trigger: '小米', model: 'test-model',
    deepseekResponsesUrl: 'https://example.test/responses', deepseekApiKey: 'synthetic-key' }, 'PUT');
  assert.equal(configuredAi.data.hasDeepSeekApiKey, true, JSON.stringify(configuredAi));
  assert.equal(runtime.getSetting('danmakuMonitoringEnabled'), 'true');
  assert.deepEqual(requested, ['settings']);
  assert.deepEqual(runtime.getPendingCloudSettings(accountKey).values.menuCommands, ['小米 问题（AI 互动）']);
  assert.equal(runtime.getPendingCloudSettings(accountKey).mutationId, pendingId);
  assert.equal(runtime.getSetting('menuCommands'), undefined);
  assert.doesNotMatch(JSON.stringify(runtime.getCloudSettingsSnapshot()), /synthetic-key/);
  requested.length = 0;
  await request('/api/ai/config', { reasoningEnabled: true }, 'PUT');
  assert.deepEqual(requested, []);
  requested.length = 0;
  await request('/api/ai/config', { enabled: false }, 'PUT');
  assert.deepEqual(requested, ['settings']);
  assert.deepEqual(runtime.getCloudSettingsSnapshot().menuCommands, []);
  requested.length = 0;
  await request('/api/ai/config', { trigger: '小梨' }, 'PUT');
  assert.deepEqual(requested, []);
  await request('/api/games/session', { game: 'gomoku', mode: 'multi' });
  assert.deepEqual(requested, []);
  await request('/api/games/session/move', { value: 'A1' });
  assert.deepEqual(requested, ['settings']);
  assert.deepEqual(runtime.getCloudSettingsSnapshot().menuCommands, ['五子棋（进行中）：发送坐标 A1—O15']);
  requested.length = 0;
  await request('/api/games/session', { action: 'stop' });
  assert.deepEqual(requested, ['settings']);
  assert.deepEqual(runtime.getPendingCloudSettings(accountKey).values.menuCommands, []);
});
