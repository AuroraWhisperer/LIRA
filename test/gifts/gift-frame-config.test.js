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

test('each frame effect owns its switch and threshold, with the highest qualifying threshold winning', () => {
  const base = { id: 12, detection_status: 'final', gift_name: '缎带', user_name: '观众B', num: 1 };
  const both = (threshold, ribbonThreshold) => ({
    giftFrameEnabled: 'true',
    giftFrameThresholdRmb: threshold,
    giftFrameRibbonEnabled: 'true',
    giftFrameRibbonThresholdRmb: ribbonThreshold,
  });

  // 只有特效 2 启用：只要够它自己的门槛就播 1 次缎带礼笺。
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 100 }, {
    giftFrameEnabled: 'false', giftFrameRibbonEnabled: 'true', giftFrameRibbonThresholdRmb: '100',
  }).themeId, 'satin-ribbon');
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 99.99 }, {
    giftFrameRibbonEnabled: 'true', giftFrameRibbonThresholdRmb: '100',
  }), null);

  // 两者都启用：只播门槛更高的那个，并列时特效 2 优先。
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 300 }, both('20', '100')).themeId, 'satin-ribbon');
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 300 }, both('100', '20')).themeId, 'woodland-bloom');
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 300 }, both('50', '50')).themeId, 'satin-ribbon');
  // 同一笔礼物只产生一个事件，ID 仍然是 final gift group 的稳定 ID。
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 300 }, both('20', '100')).eventId, 'gift-frame:12');
  // 两个都不满足时没有事件。
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 20 }, both('20.01', '100')), null);
  assert.equal(buildGiftFrameEvent({ ...base, total_price: 0 }, both('0', '0')), null);

  // 特效 2 的键与特效 1 一样做白名单校验。
  assert.equal(normalizeFrameSettingValue('giftFrameRibbonEnabled', 'yes'), null);
  assert.equal(normalizeFrameSettingValue('giftFrameRibbonEnabled', 'true'), 'true');
  assert.equal(normalizeFrameSettingValue('giftFrameRibbonThresholdRmb', '-1'), null);
  assert.equal(normalizeFrameSettingValue('giftFrameRibbonThresholdRmb', '100'), '100');
  assert.equal(buildGiftFramePreviewEvent({ themeId: 'satin-ribbon' }).themeId, 'satin-ribbon');
});

test('frame preview route broadcasts a preview event and validates bad input', async () => {  const { routes } = require('../../src/server/routes/gift-routes');
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
