'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildGiftFrameEvent,
  buildGiftFramePreviewEvent,
  normalizeFrameSettingValue,
  normalizeRmbCents,
} = require('../../src/bilibili/gift/frame-config');

test('frame adapter uses final total price in integer cents and stable event ids', () => {
  const event = buildGiftFrameEvent(
    {
      id: 77,
      detection_status: 'final',
      gift_id: '35457',
      gift_name: '梦幻城堡',
      user_name: '观众A',
      num: 2,
      unit_price: 1,
      total_price: 20,
    },
    {
      giftFrameEnabled: 'true',
      giftFrameThresholdRmb: '20',
      giftFrameTheme: 'woodland-bloom',
      giftFrameMotionMode: 'auto',
    },
  );

  assert.deepEqual(event, {
    type: 'gift:frame',
    eventId: 'gift-frame:77',
    giftEventId: 77,
    giftId: 35457,
    giftName: '梦幻城堡',
    num: 2,
    totalPriceCents: 2000,
    userName: '观众A',
    themeId: 'woodland-bloom',
  });
  assert.equal(normalizeRmbCents('19.99'), 1999);
  assert.equal(normalizeRmbCents('20.005'), 2001);
});

test('frame adapter rejects disabled, progress, zero, and below-threshold gifts', () => {
  const base = { id: 1, detection_status: 'final', total_price: 20 };
  assert.equal(buildGiftFrameEvent(base, { giftFrameEnabled: 'false' }), null);
  assert.equal(buildGiftFrameEvent({ ...base, detection_status: 'progress' }, { giftFrameEnabled: 'true' }), null);
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 0 }, { giftFrameEnabled: 'true' }), null);
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 19.99 }, { giftFrameEnabled: 'true' }), null);
});

test('frame settings allowlist invalid values and preview bypasses live settings', () => {
  assert.equal(normalizeFrameSettingValue('giftFrameEnabled', 'yes'), null);
  assert.equal(normalizeFrameSettingValue('giftFrameThresholdRmb', '-1'), null);
  assert.equal(normalizeFrameSettingValue('giftFrameTheme', 'remote'), null);
  assert.equal(normalizeFrameSettingValue('giftFrameMotionMode', 'loop'), null);

  const preview = buildGiftFramePreviewEvent({
    userName: '<观众>',
    giftName: '测试礼物',
    num: 3,
    totalPriceRmb: 0.01,
    themeId: 'woodland-bloom',
    motionMode: 'reduced',
  });
  assert.equal(preview.type, 'gift:frame');
  assert.equal(preview.preview, true);
  assert.match(preview.eventId, /^gift-frame:preview-/);
  assert.equal(preview.totalPriceCents, 1);
  assert.equal(preview.num, 3);
  assert.equal(preview.motionMode, undefined);
  assert.equal(buildGiftFramePreviewEvent({ num: 2 }).totalPriceCents, 1);
  assert.notEqual(buildGiftFramePreviewEvent().eventId, buildGiftFramePreviewEvent().eventId);
  assert.throws(() => buildGiftFramePreviewEvent({ themeId: 'unknown' }), /主题无效/);
  assert.throws(() => buildGiftFramePreviewEvent({ num: 1.5 }), /正整数/);
});

test('effect 1 retains its own settings while obsolete settings cannot be written', () => {
  const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
  const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
  assert.equal(DEFAULT_SETTINGS.giftFrameTheme, undefined);
  assert.equal(DEFAULT_SETTINGS.giftFrameMotionMode, undefined);
  assert.deepEqual(normalizeSettingsPatch({
    giftFrameEnabled: true, giftFrameThresholdRmb: '22.50', giftFrameTheme: 'old', giftFrameMotionMode: 'reduced',
  }, DEFAULT_SETTINGS), { values: { giftFrameEnabled: 'true', giftFrameThresholdRmb: '22.50' } });
  const payload = buildGiftFrameEvent({ id: 7, total_price: 30 }, {
    giftFrameEnabled: 'true', giftFrameTheme: 'obsolete', giftFrameMotionMode: 'reduced',
  });
  assert.equal(payload.themeId, 'woodland-bloom');
  assert.equal(payload.motionMode, undefined);
});

test('frame preview route broadcasts a preview event and validates bad input', async () => {
  const { routes } = require('../../src/server/routes/gift-routes');
  const handler = routes['POST /api/gifts/frame/preview'];
  const broadcasts = [];
  const context = {
    gifts: { previewFrame: (event) => broadcasts.push(event) },
  };
  const response = await invokeBodyRoute(handler, context, {
    userName: '观众',
    giftName: '礼物',
    num: 1,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.preview, true);
  assert.equal(broadcasts.length, 1);

  const invalid = await invokeBodyRoute(handler, context, { totalPriceRmb: 0 });
  assert.equal(invalid.status, 400);
  assert.equal(broadcasts.length, 1);
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
