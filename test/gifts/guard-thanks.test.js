'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildGuardThanksEvent,
  buildGuardThanksPreviewEvent,
  normalizeGuardThanksSettingValue,
  resolveGuardTier,
} = require('../../src/bilibili/gift/guard-thanks-config');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { createRuntimeTransport } = require('../../src/server/runtime-transport');
const { projectWebSocketPayload } = require('../../src/server/overlay-projection');
const { readAdminHtml } = require('../helpers/admin-html');

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
  assert.match(read('src/server/api-context.js'), /previewGuardThanks: broadcastGiftEffectPreview/);
});

test('finalized guard gifts broadcast thanks after the frame event and only when enabled', () => {
  const sent = [];
  let settings = { giftFrameEnabled: 'true', giftFrameThresholdRmb: '20', ...enabled };
  const transport = createRuntimeTransport({
    defaultPort: 3000,
    getHost: () => '127.0.0.1',
    getStartedPort: () => 3000,
    getSessionToken: () => 'test-session',
    getState: () => ({}),
    getSettings: () => settings,
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

test('gift assistant owns guard settings and sends previewing to the canvas', () => {
  const html = readAdminHtml();
  const moduleSource = read('public/js/admin/gift-guard-thanks.js');
  assert.match(html, /<button\b(?=[^>]*\sid="giftAssistantGuardTab")(?=[^>]*\saria-controls="guardThanksPanel")(?=[^>]*\sdata-gift-tab="guard")[^>]*>/);
  for (const id of [
    'guardThanksEnabled',
    'guardThanksTextMode',
    'guardThanksStyle',
    'guardThanksPreviewTier',
    'guardThanksPreviewUser',
    'guardThanksPreviewMonths',
    'guardThanksPlayBtn',
    'guardThanksSaveBtn',
  ]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /id="guardThanks(?:PreviewStage|OverlayUrl|SendBtn|OpenBtn|CopyBtn)"/);
  assert.match(html, /href="\/css\/admin\/gift-guard-thanks\.css"/);
  assert.match(read('public/js/admin/app.js'), /initGuardThanks\(\);/);
  assert.match(moduleSource, /\/api\/settings/);
  assert.match(moduleSource, /openComponentPreview\(\{ id: 'guard-thanks', previewData \}\)/);
  assert.match(moduleSource, /app:settings-state/);
  assert.doesNotMatch(moduleSource, /\/gift-effects/);
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

async function invokeBodyRoute(handler, context, body) {
  let status = 0;
  let responseBody = null;
  const response = {
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(content) {
      responseBody = JSON.parse(content);
    },
  };
  await handler(context, { body: async () => body }, response);
  return { status, body: responseBody };
}
