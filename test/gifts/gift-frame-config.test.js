'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { invokeBodyRoute } = require('../helpers/route-invoke');
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
    avatarUrl: '',
    themeId: 'woodland-bloom',
  });
  assert.equal(normalizeRmbCents('19.99'), 1999);
  assert.equal(normalizeRmbCents('20.005'), 2001);
});

test('frame avatars use the known sender profile and reject untrusted URLs', () => {
  const base = { id: 1, total_price: 20 };
  const settings = { giftFrameEnabled: 'true' };
  const avatar = 'https://i0.hdslb.com/bfs/face/viewer.webp';
  assert.equal(buildGiftFrameEvent({ ...base, avatar_url: avatar }, settings).avatarUrl, avatar);
  assert.equal(buildGiftFrameEvent({ ...base, avatarUrl: avatar }, settings).avatarUrl, avatar);
  for (const avatarUrl of ['http://i0.hdslb.com/face.jpg', 'https://hdslb.com.evil.test/face.jpg',
    'https://secret@i0.hdslb.com/face.jpg', 'file:///private/avatar', 'x'.repeat(2049)]) {
    assert.equal(buildGiftFrameEvent({ ...base, avatarUrl }, settings).avatarUrl, '');
  }
  assert.equal(buildGiftFramePreviewEvent({ avatarUrl: avatar }).avatarUrl, '');
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
  assert.throws(() => buildGiftFramePreviewEvent({ themeId: 'unknown' }));
  assert.throws(() => buildGiftFramePreviewEvent({ num: 1.5 }));
});

test('effect 1 retains its own settings while obsolete and retired ribbon settings cannot be written or trigger', () => {
  const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
  const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
  assert.deepEqual(normalizeSettingsPatch({
    giftFrameEnabled: true, giftFrameThresholdRmb: '22.50', giftFrameTheme: 'old', giftFrameMotionMode: 'reduced',
    giftFrameRibbonEnabled: true, giftFrameRibbonThresholdRmb: '100',
  }, DEFAULT_SETTINGS), { values: { giftFrameEnabled: 'true', giftFrameThresholdRmb: '22.50' } });
  const payload = buildGiftFrameEvent({ id: 7, total_price: 30 }, {
    giftFrameEnabled: 'true', giftFrameTheme: 'obsolete', giftFrameMotionMode: 'reduced',
  });
  assert.equal(payload.themeId, 'woodland-bloom');
  assert.equal(payload.motionMode, undefined);
  const gift = { id: 12, detection_status: 'final', total_price: 300 };
  const retired = { giftFrameRibbonEnabled: 'true', giftFrameRibbonThresholdRmb: '100' };
  assert.equal(buildGiftFrameEvent(gift, retired), null);
  assert.equal(buildGiftFrameEvent(gift, { ...retired, giftFrameEnabled: 'false' }), null);
  assert.equal(buildGiftFrameEvent(gift, { ...retired, giftFrameEnabled: 'true' }).themeId, 'woodland-bloom');
  assert.equal(normalizeFrameSettingValue('giftFrameRibbonEnabled', 'true'), null);
  assert.equal(normalizeFrameSettingValue('giftFrameRibbonThresholdRmb', '100'), null);
  assert.throws(() => buildGiftFramePreviewEvent({ themeId: 'satin-ribbon' }));
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
  const retired = await invokeBodyRoute(handler, context, { themeId: 'satin-ribbon' });
  assert.equal(retired.status, 400);
  assert.equal(broadcasts.length, 1);
});

test('imported gift-frame styles each keep their own switch and threshold', async t => {
  const { buildGiftFrameStyleEvent } = require('../../src/bilibili/gift/frame-config');
  const { writeGiftFrameStyleTrigger } = await import('../../public/js/shared/gift-frame-style-triggers.js');
  const [a, b, c] = ['1', '2', '3'].map((digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`);
  const gift = { id: 9, detection_status: 'final', gift_name: '礼物', user_name: '观众A', num: 1, total_price: 25 };
  // Not yet migrated: imported styles keep the pre-upgrade switch shared with 林间花信.
  const legacy = { giftFrameEnabled: 'true', giftFrameThresholdRmb: '20', giftFrameStyleTriggers: '' };
  assert.deepEqual(buildGiftFrameStyleEvent(gift, legacy, [a, b]).styleIds, [a, b]);

  const value = normalizeFrameSettingValue('giftFrameStyleTriggers',
    { [a]: { enabled: 'true', thresholdRmb: '30' }, [b]: { enabled: true, thresholdRmb: '10.5' } });
  assert.deepEqual(JSON.parse(value), { [a]: { enabled: 'true', thresholdRmb: '30' }, [b]: { enabled: 'true', thresholdRmb: '10.50' } });
  const settings = { giftFrameEnabled: 'false', giftFrameThresholdRmb: '20', giftFrameStyleTriggers: value };
  const parse = JSON.parse;
  let triggerParses = 0;
  const parseMock = t.mock.method(JSON, 'parse', (text, ...args) => {
    if (text === value) triggerParses++;
    return parse(text, ...args);
  });
  const event = buildGiftFrameStyleEvent(gift, settings, [a, b, c]);
  parseMock.mock.restore();
  assert.equal(triggerParses, 1, 'one gift parses the shared trigger mapping once for all styles');
  assert.deepEqual([event.eventId, event.themeId, event.styleIds], ['gift-frame:9:imported', 'imported', [b]]);
  assert.deepEqual(buildGiftFrameStyleEvent({ ...gift, total_price: 30 }, settings, [a, c]).styleIds, [a], 'threshold is inclusive');
  assert.equal(buildGiftFrameEvent(gift, settings), null, '林间花信 keeps its own switch');

  // Saving one style before migration materializes the others with their current values.
  assert.deepEqual(JSON.parse(writeGiftFrameStyleTrigger(legacy, [a, b], a, { enabled: false, thresholdRmb: '5.00' })),
    { [a]: { enabled: 'false', thresholdRmb: '5.00' }, [b]: { enabled: 'true', thresholdRmb: '20' } });
  assert.deepEqual(Object.keys(JSON.parse(writeGiftFrameStyleTrigger(settings, [a, b, c], c, { enabled: true, thresholdRmb: '1' }))), [a, b, c]);

  for (const invalid of ['[]', '{', JSON.stringify({ 'not-a-style': { enabled: 'true', thresholdRmb: '1' } }),
    JSON.stringify({ [a]: { enabled: 'maybe', thresholdRmb: '1' } }), JSON.stringify({ [a]: { enabled: 'true', thresholdRmb: '-1' } }),
    JSON.stringify({ [a]: { enabled: 'true', thresholdRmb: '1', extra: true } })]) {
    assert.equal(normalizeFrameSettingValue('giftFrameStyleTriggers', invalid), null, invalid);
  }
  assert.equal(normalizeFrameSettingValue('giftFrameStyleTriggers', ''), '');
});
