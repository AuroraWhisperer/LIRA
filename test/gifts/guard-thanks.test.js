'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { invokeBodyRoute } = require('../helpers/route-invoke');
const {
  buildGuardThanksEvent,
  buildGuardThanksEvents,
  buildGuardThanksPreviewEvent,
  normalizeGuardThanksSettingValue,
  resolveGuardTier,
} = require('../../src/bilibili/gift/guard-thanks-config');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { createRuntimeTransport } = require('../../src/server/runtime-transport');
const { projectWebSocketPayload } = require('../../src/server/overlay-projection');

const ROOT_DIR = path.join(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
const enabled = { guardThanksEnabled: 'true', guardThanksTextMode: 'en' };
const guardRow = {
  id: 41,
  detection_status: 'final',
  gift_id: '10003',
  gift_name: '舰长',
  user_name: '观众A',
  num: 3,
  total_price: 594,
  avatar_url: 'https://i0.hdslb.com/bfs/face/sample.jpg',
};

test('guard tiers resolve from canonical ids, aliases and exact guard names only', () => {
  assert.equal(resolveGuardTier({ gift_id: '10003' }), 'captain');
  assert.equal(resolveGuardTier({ gift_id: '34637' }), 'captain');
  assert.equal(resolveGuardTier({ gift_id: 'guard-2' }), 'admiral');
  assert.equal(resolveGuardTier({ gift_id: '33909' }), 'governor');
  assert.equal(resolveGuardTier({ gift_id: 'guard-unknown', gift_name: '提督' }), 'admiral');
  assert.equal(resolveGuardTier({ gift_id: '31036', gift_name: '小花花' }), null);
  assert.equal(resolveGuardTier({ gift_id: '31036', gift_name: '舰长的祝福' }), null);
});

test('final guard rows become display-only thanks events when enabled', () => {
  assert.deepEqual(buildGuardThanksEvent(guardRow, enabled), {
    type: 'gift:guard-thanks',
    eventId: 'guard-thanks:41',
    giftEventId: 41,
    tier: 'captain',
    userName: '观众A',
    months: 3,
    avatarUrl: 'https://i0.hdslb.com/bfs/face/sample.jpg',
    textMode: 'en',
    style: 'aurora',
  });
  const untrusted = buildGuardThanksEvent(
    { ...guardRow, avatar_url: 'http://example.com/face.jpg', user_name: '' },
    { guardThanksEnabled: 'true', guardThanksTextMode: 'bad' },
  );
  assert.equal(untrusted.avatarUrl, '');
  assert.equal(untrusted.userName, '观众');
  assert.equal(untrusted.textMode, 'bilingual');
  assert.equal(buildGuardThanksEvent(guardRow, { guardThanksEnabled: 'false' }), null);
  assert.equal(buildGuardThanksEvent(guardRow, {}), null);
  assert.equal(buildGuardThanksEvent({ ...guardRow, detection_status: 'progress' }, enabled), null);
  assert.equal(buildGuardThanksEvent({ ...guardRow, gift_id: '31036', gift_name: '小花花' }, enabled), null);
  assert.equal(buildGuardThanksEvent({ ...guardRow, id: 0 }, enabled), null);
});

test('guard thanks settings are allowlisted local settings with safe defaults', () => {
  assert.equal(DEFAULT_SETTINGS.guardThanksEnabled, 'false');
  assert.equal(DEFAULT_SETTINGS.guardThanksTextMode, 'bilingual');
  assert.equal(DEFAULT_SETTINGS.guardThanksStyle, 'aurora');
  assert.equal(normalizeGuardThanksSettingValue('guardThanksEnabled', true), 'true');
  assert.equal(normalizeGuardThanksSettingValue('guardThanksEnabled', 'yes'), null);
  assert.equal(normalizeGuardThanksSettingValue('guardThanksTextMode', 'zh'), 'zh');
  assert.equal(normalizeGuardThanksSettingValue('guardThanksTextMode', 'fr'), null);
  assert.equal(normalizeGuardThanksSettingValue('guardThanksStyle', 'classic'), 'classic');
  assert.equal(normalizeGuardThanksSettingValue('guardThanksStyle', 'neon'), null);
  assert.deepEqual(normalizeSettingsPatch({ guardThanksEnabled: true, guardThanksTextMode: 'en' }, DEFAULT_SETTINGS), {
    values: { guardThanksEnabled: 'true', guardThanksTextMode: 'en' },
  });
  assert.match(normalizeSettingsPatch({ guardThanksTextMode: 'fr' }, DEFAULT_SETTINGS).error, /guardThanksTextMode/);
  assert.deepEqual(normalizeSettingsPatch({ guardThanksStyle: 'classic' }, DEFAULT_SETTINGS), {
    values: { guardThanksStyle: 'classic' },
  });
  assert.match(normalizeSettingsPatch({ guardThanksStyle: 'neon' }, DEFAULT_SETTINGS).error, /guardThanksStyle/);
});

test('independent styles preserve legacy selection and generate distinct events with their own text', () => {
  for (const style of ['aurora', 'classic']) {
    const settings = { ...DEFAULT_SETTINGS, ...enabled, guardThanksStyle: style };
    assert.deepEqual(buildGuardThanksEvents(guardRow, settings).map(event => [event.style, event.textMode]), [[style, 'en']]);
  }
  const settings = { ...enabled, guardThanksAuroraEnabled: 'true', guardThanksAuroraTextMode: 'zh',
    guardThanksClassicEnabled: 'true', guardThanksClassicTextMode: 'en' };
  const events = buildGuardThanksEvents(guardRow, settings);
  assert.deepEqual(events.map(({ eventId, style, textMode }) => [eventId, style, textMode]), [
    ['guard-thanks:41:aurora', 'aurora', 'zh'], ['guard-thanks:41:classic', 'classic', 'en'],
  ]);
  assert.deepEqual(buildGuardThanksEvents(guardRow, { ...settings,
    guardThanksAuroraEnabled: 'false', guardThanksClassicEnabled: 'false' }), []);
  assert.deepEqual(buildGuardThanksEvents({ ...guardRow, detection_status: 'progress' }, settings), []);
  for (const prefix of ['guardThanksAurora', 'guardThanksClassic']) {
    assert.deepEqual(normalizeSettingsPatch({ [`${prefix}Enabled`]: true, [`${prefix}TextMode`]: 'zh' }, DEFAULT_SETTINGS),
      { values: { [`${prefix}Enabled`]: 'true', [`${prefix}TextMode`]: 'zh' } });
    for (const [suffix, value] of [['Enabled', 'yes'], ['TextMode', 'fr'], ['Enabled', ''], ['TextMode', '']]) {
      assert.ok(normalizeSettingsPatch({ [`${prefix}${suffix}`]: value }, DEFAULT_SETTINGS).error);
    }
  }
});

test('style settings survive store initialization without replacing legacy or other style settings', () => {
  const { DatabaseSync } = require('node:sqlite');
  const { createSettingsStore } = require('../../src/storage/settings-store');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
    const store = createSettingsStore(db);
    store.setSettings({ ...enabled, guardThanksStyle: 'classic' });
    assert.deepEqual(buildGuardThanksEvents(guardRow, store.getSettings()).map(event => event.style), ['classic']);
    store.setSettings({ guardThanksAuroraEnabled: 'true', guardThanksAuroraTextMode: 'zh' });
    const reopened = createSettingsStore(db);
    assert.deepEqual(buildGuardThanksEvents(guardRow, reopened.getSettings()).map(event => [event.style, event.textMode]),
      [['aurora', 'zh'], ['classic', 'en']]);
    reopened.setSettings({ guardThanksClassicEnabled: 'false', guardThanksClassicTextMode: 'bilingual' });
    assert.deepEqual(buildGuardThanksEvents(guardRow, createSettingsStore(db).getSettings()).map(event => event.style), ['aurora']);
    assert.equal(store.getSettings().guardThanksStyle, 'classic');
  } finally { db.close(); }
});

test('preview events validate tier, months and text mode without reading live settings', () => {
  const preview = buildGuardThanksPreviewEvent({ tier: 'governor', userName: '  ', months: '12', textMode: 'zh' });
  assert.equal(preview.type, 'gift:guard-thanks');
  assert.equal(preview.preview, true);
  assert.match(preview.eventId, /^guard-thanks:preview-/);
  assert.equal(preview.userName, '观众A');
  assert.equal(preview.months, 12);
  assert.equal(preview.avatarUrl, '');
  assert.equal(buildGuardThanksPreviewEvent({ tier: 'captain' }).textMode, 'bilingual');
  assert.throws(() => buildGuardThanksPreviewEvent({ tier: 'viewer' }), /舰长/);
  assert.throws(() => buildGuardThanksPreviewEvent({ tier: 'captain', months: 0 }), /月数/);
  assert.throws(() => buildGuardThanksPreviewEvent({ tier: 'captain', textMode: 'fr' }), /文字模式/);
});

test('preview route broadcasts through the gift preview channel and rejects bad input', async () => {
  const { routes } = require('../../src/server/routes/gift-routes');
  const handler = routes['POST /api/gifts/guard-thanks/preview'];
  const broadcasts = [];
  const context = { gifts: { previewGuardThanks: (event) => broadcasts.push(event) } };
  const ok = await invokeBodyRoute(handler, context, { tier: 'admiral', userName: '观众B', months: 2 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.tier, 'admiral');
  assert.equal(broadcasts.length, 1);
  const invalid = await invokeBodyRoute(handler, context, { tier: 'admin' });
  assert.equal(invalid.status, 400);
  assert.equal(broadcasts.length, 1);
});

test('finalized guard gifts broadcast thanks after the frame event and only when enabled', () => {
  const sent = [];
  let settings = { giftFrameEnabled: 'true', giftFrameThresholdRmb: '20', ...enabled };
  const sceneEvents = [];
  const transport = createRuntimeTransport({
    defaultPort: 3000,
    getHost: () => '127.0.0.1',
    getStartedPort: () => 3000,
    getSessionToken: () => 'test-session',
    getState: () => ({}),
    getSettings: () => settings,
    publishSceneGift: (event) => sceneEvents.push(event),
    getDanmakuFeedBuffer: () => ({ pushGift: () => null }),
    getWebSocketHub: () => ({
      broadcastSnapshot: () => sent.push({ type: 'snapshot' }),
      broadcast: (payload) => sent.push(payload),
    }),
  });
  transport.publishGiftFlushed(guardRow);
  assert.deepEqual(
    sent.map((payload) => payload.type),
    ['snapshot', 'gift:frame', 'gift:guard-thanks'],
  );
  settings = { guardThanksEnabled: 'false' };
  transport.publishGiftFlushed({ ...guardRow, id: 42 });
  assert.equal(sent.filter((payload) => payload.type === 'gift:guard-thanks').length, 1);
  settings = { guardThanksAuroraEnabled: 'true', guardThanksAuroraTextMode: 'zh',
    guardThanksClassicEnabled: 'true', guardThanksClassicTextMode: 'en' };
  transport.publishGiftFlushed({ ...guardRow, id: 43 });
  assert.deepEqual(sent.slice(-2).map(event => [event.eventId, event.textMode]),
    [['guard-thanks:43:aurora', 'zh'], ['guard-thanks:43:classic', 'en']]);
  assert.deepEqual(sceneEvents.slice(-2), sent.slice(-2));
});

test('only the gift-effects overlay scope receives the projected thanks fields', () => {
  const event = { ...buildGuardThanksEvent(guardRow, enabled), uid: '123', secret: 'PRIVATE' };
  assert.deepEqual(projectWebSocketPayload({ type: 'overlay', scope: 'gift-effects' }, event), {
    type: 'gift:guard-thanks',
    eventId: 'guard-thanks:41',
    tier: 'captain',
    userName: '观众A',
    months: 3,
    avatarUrl: 'https://i0.hdslb.com/bfs/face/sample.jpg',
    textMode: 'en',
    style: 'aurora',
  });
  assert.equal(projectWebSocketPayload({ type: 'overlay', scope: 'danmaku' }, event), null);
});

test('gift-effects overlay hosts the shared guard thanks renderer without HTML injection', () => {
  const html = read('public/pages/overlays/gift-effects.html');
  const overlay = read('public/js/overlays/gift-effects.js');
  assert.match(html, /href="\/css\/shared\/guard-thanks\.css/);
  assert.match(html, /id="guardThanksRoot"/);
  assert.match(overlay, /payload\.type === 'gift:guard-thanks'\) guardThanks\.enqueue\(payload\)/);
  for (const file of [
    'public/js/overlays/gift-effects-guard.js',
    'public/js/shared/guard-thanks-card.js',
    'public/js/shared/guard-thanks-emblems.js',
    'public/js/shared/guard-thanks-particles.js',
    'public/js/admin/gift-guard-thanks.js',
  ]) {
    assert.doesNotMatch(read(file), /innerHTML|insertAdjacentHTML|iterations:\s*Infinity/, file);
  }
  const css = read('public/css/shared/guard-thanks.css');
  assert.doesNotMatch(css, /mix-blend-mode|\binfinite\b/);
});
