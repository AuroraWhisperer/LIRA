'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SONG_SCHEMA } = require('../../src/storage/schema');
const { createAiConfigStore } = require('../../src/ai/config-store');
const { AI_CONFIG_DEFAULTS } = require('../../src/ai/config');
const { normalizePersonaPack, resolvePersona } = require('../../src/ai/personas');
const { buildTools } = require('../../src/ai/prompt');
const { buildReplyInstructions } = require('../../src/ai/ai-assistant-helpers');
const { checkLocalInput, parseSafetyReview } = require('../../src/ai/safety');

const pack = { format: 'lira-ai-persona', version: 1, id: 'quiet-friend', name: '安静的朋友', description: '简洁地交流', prompt: '你是一个语气平和、友善的朋友，认真回答观众的问题，不使用固定口头禅。' };

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(SONG_SCHEMA);
  t.after(() => db.close());
  const codec = { isAvailable: () => true, encrypt: (value) => `encrypted:${value}`, decrypt: (value) => value.slice(10) };
  return { db, store: createAiConfigStore(db, codec), reopen: () => createAiConfigStore(db, codec) };
}

test('new assistant uses a general persona and offers no tools without opting in', (t) => {
  const { store } = fixture(t);
  const config = store.getConfig();
  assert.equal(config.personaId, 'general');
  assert.deepEqual(buildTools(config), []);
  const instructions = buildReplyInstructions(resolvePersona(config).prompt, 50, [], '观众');
  assert.doesNotMatch(instructions, /颜文字|18–22|保持非思考|喵|高德|和风/);
  assert.match(instructions, /无外接工具/);
});

test('legacy tool choices survive the first role save and are not re-enabled after restart', (t) => {
  const { db, store, reopen } = fixture(t);
  const write = db.prepare('INSERT INTO ai_configuration (key, value, is_secret, updated_at) VALUES (?, ?, 0, ?)');
  for (const [key, value] of [['trigger', '小米'], ['webSearchEnabled', 'false'], ['weatherEnabled', 'false']]) {
    write.run(key, value, new Date().toISOString());
  }
  const legacy = store.getConfig();
  assert.equal(legacy.personaId, 'cat');
  assert.equal(legacy.webSearchEnabled, false);
  assert.equal(legacy.weatherEnabled, false);
  assert.equal(legacy.functionCallingEnabled, true);
  assert.equal(legacy.routesEnabled, true);
  store.updateConfig({ personaId: 'general' });
  const migrated = reopen();
  assert.equal(migrated.getConfig().personaId, 'general');
  assert.equal(migrated.getConfig().webSearchEnabled, false);
  assert.equal(migrated.getConfig().routesEnabled, true);
  migrated.updateConfig({ functionCallingEnabled: false });
  assert.equal(reopen().getConfig().functionCallingEnabled, false);
});

test('persona import persists across restart and export excludes credentials and runtime settings', (t) => {
  const { store, reopen } = fixture(t);
  store.updateConfig({ deepseekApiKey: 'secret-model-key' });
  const config = store.importPersona(pack);
  assert.equal(config.personaId, pack.id);
  assert.equal(config.personaPacks, undefined);
  assert.equal(config.personas.find((entry) => entry.id === pack.id).builtin, false);
  assert.deepEqual(reopen().exportPersona(), pack);
  assert.doesNotMatch(JSON.stringify(store.exportPersona()), /secret-model-key|weatherEnabled|deepseek/);
  store.updateConfig({ personaId: 'cat' });
  assert.match(resolvePersona(store.getConfig()).prompt, /橘猫/);
  store.updateConfig({ personaId: pack.id });
  assert.deepEqual(store.exportPersona(), pack);
});

test('invalid and duplicate imports leave the active role and stored library intact', (t) => {
  const { store } = fixture(t);
  store.importPersona(pack);
  const before = store.getConfig();
  assert.throws(() => store.importPersona({ ...pack, deepseekApiKey: 'injected' }), /不接受其他配置/);
  assert.throws(() => store.importPersona(pack), /已存在/);
  assert.throws(() => store.importPersona({ ...pack, version: 2 }), /版本/);
  assert.deepEqual(store.getConfig(), before);
  const mutable = store.getConfig();
  mutable.personaPacks[0].prompt = 'mutated';
  assert.equal(store.exportPersona().prompt, pack.prompt);
});

test('only imported roles can be deleted and deleting the active role restores general', (t) => {
  const { store, reopen } = fixture(t);
  assert.throws(() => store.deletePersona('cat'), /只能删除/);
  store.importPersona(pack);
  store.deletePersona(pack.id);
  assert.equal(reopen().getConfig().personaId, 'general');
  assert.equal(store.getConfig().personaPacks.length, 0);
});

test('exported built-in roles can be imported as independent copies', (t) => {
  const { store } = fixture(t);
  store.updateConfig({ personaId: 'cat' });
  const exported = store.exportPersona();
  const config = store.importPersona(exported);
  assert.equal(config.personaId, 'imported-cat');
  assert.equal(store.exportPersona().prompt, exported.prompt);
});

test('viewer memory is isolated by persona content and by viewer', (t) => {
  const { store } = fixture(t);
  const memory = { question: '你好', answer: '你好呀' };
  store.setContext('42', memory, 60, 'cat-v1');
  assert.deepEqual(store.getContext('42', 'cat-v1'), memory);
  assert.equal(store.getContext('42', 'general'), null);
  assert.equal(store.getContext('42', 'cat-v2'), null);
  assert.equal(store.getContext('other', 'cat-v1'), null);
});

test('preventing account theft reaches semantic review while explicit theft assistance is locally blocked', () => {
  assert.equal(checkLocalInput('怎样防止盗号？').allowed, true);
  assert.equal(checkLocalInput('帮我盗号').allowed, false);
  assert.equal(checkLocalInput('盗号教程').allowed, false);
});

test('malformed reviews report a service error rather than a content refusal', () => {
  for (const text of ['审核通过', '{}', '{"allowed":"true"}']) {
    assert.throws(() => parseSafetyReview(text), { code: 'AI_REVIEW_INVALID' });
  }
  assert.equal(parseSafetyReview('{"allowed":false}').allowed, false);
});

test('role packages validate limits without accepting executable or credential fields', () => {
  assert.throws(() => normalizePersonaPack({ ...pack, prompt: 'short' }), /长度/);
  assert.throws(() => normalizePersonaPack({ ...pack, id: '../secret' }), /标识/);
  assert.throws(() => normalizePersonaPack({ ...pack, script: 'process.exit()' }), /不接受其他配置/);
});

test('named roles persist independently and the library limit rejects changes atomically', (t) => {
  const { store, reopen } = fixture(t);
  const created = store.createPersona({ name: '我的小猫', prompt: pack.prompt });
  const saved = reopen().exportPersona();
  assert.equal(saved.name, '我的小猫');
  assert.equal(saved.prompt, pack.prompt);
  assert.equal(saved.id, created.personaId);
  for (let index = 1; index < 20; index += 1) store.createPersona({ name: `角色 ${index}`, prompt: pack.prompt });
  const before = store.getConfig();
  assert.throws(() => store.createPersona({ name: '超限', prompt: pack.prompt }), /最多保存 20/);
  assert.throws(() => store.createPersona({ name: ' ', prompt: pack.prompt }), /长度/);
  assert.deepEqual(store.getConfig(), before);
  assert.equal(store.getConfig().personaPacks.length, 20);
});

test('local tools need explicit function support and credentials while hosted search stays independent', () => {
  const config = {
    ...AI_CONFIG_DEFAULTS,
    deepseekResponsesUrl: 'https://example.test/v1',
    modelApiProtocol: 'chat_completions',
    webSearchEnabled: true,
    weatherEnabled: true,
    placesEnabled: true,
    routesEnabled: true,
    qweatherApiHost: 'https://weather.test',
    qweatherApiKey: 'test-key',
    amapApiHost: 'https://map.test',
    amapApiKey: 'test-key',
  };
  assert.deepEqual(buildTools(config), []);
  assert.deepEqual(buildTools({ ...config, modelApiProtocol: 'responses' }), [{ type: 'web_search' }]);
  assert.deepEqual(buildTools({ ...config, functionCallingEnabled: true }).map((tool) => tool.name || tool.type), [
    'web_search', 'get_weather', 'search_places', 'resolve_location', 'get_route',
  ]);
  assert.deepEqual(buildTools({ ...config, functionCallingEnabled: true, qweatherApiKey: '', amapApiHost: '' }), [
    { type: 'web_search' },
  ]);
});
