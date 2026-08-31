// 编写人：Aurora
// 设置域路由：按白名单写入设置并重建 Bilibili 监听。
'use strict';

const { sendJson } = require('../http-utils');
const { normalizeRoomInput } = require('../../shared/utils');
const {
  parseCustomReplyRules,
} = require('../../bilibili/custom-reply-service');
const {
  normalizeFrameSettingValue,
} = require('../../bilibili/gift/frame-config');
const { normalizeOpeningTrackMotion } = require('../opening-contract');
const {
  CLOCK_SETTING_KEYS,
  normalizeClockSettingValue,
} = require('../clock-contract');

const prefixes = ['/api/settings'];

// 这些 key 的默认值本身就是 JSON 字符串；前端若以数组/对象提交，必须显式序列化，
// 否则 String(rawValue) 会得到 "[object Object]"。
const JSON_SETTING_KEYS = new Set([
  'giftBlindBoxConfig',
  'checkinBlessings',
  'fortunePool',
]);
const FRAME_SETTING_KEYS = new Set([
  'giftFrameEnabled',
  'giftFrameThresholdRmb',
  'giftFrameTheme',
  'giftFrameMotionMode',
]);
const DANMAKU_OVERLAY_STYLES = new Set([
  'bubble',
  'signal',
  'minimal',
  'ranked',
  'outline',
]);

const routes = {
  async 'POST /api/settings'(context, request, res) {
    const body = await request.body();
    const allowedKeys = new Set(Object.keys(context.settings.defaults));
    let changed = false;
    for (const [key, rawValue] of Object.entries(body || {})) {
      if (allowedKeys.has(key)) {
        const value = normalizeSettingValue(key, rawValue);
        if (value === null) {
          sendJson(res, 400, { ok: false, error: `设置 ${key} 的值无效。` });
          return;
        }
        context.settings.set(key, value);
        changed = true;
      }
    }
    context.bilibili.configure();
    context.broadcastSnapshot('settings');
    if (changed) context.cloudSync?.request?.('settings');
    sendJson(res, 200, { ok: true, data: context.system.getState() });
  },
};

function normalizeSettingValue(key, rawValue) {
  if (FRAME_SETTING_KEYS.has(key))
    return normalizeFrameSettingValue(key, rawValue);
  if (CLOCK_SETTING_KEYS.has(key))
    return normalizeClockSettingValue(key, rawValue);
  if (key === 'danmakuOverlayStyle') {
    const value = String(rawValue || '').trim();
    return DANMAKU_OVERLAY_STYLES.has(value) ? value : null;
  }
  if (key === 'danmakuFullscreenDurationSeconds') {
    const value = normalizeFullscreenDurationSeconds(rawValue);
    return value === null ? null : String(value);
  }
  if (key === 'openingTrackMotion')
    return normalizeOpeningTrackMotion(rawValue);
  if (key === 'roomId') return normalizeRoomInput(rawValue);
  if (key === 'customReplyRules')
    return JSON.stringify(parseCustomReplyRules(rawValue));
  if (JSON_SETTING_KEYS.has(key)) {
    if (rawValue === null || rawValue === undefined) return String(rawValue);
    return typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
  }
  return String(rawValue);
}

function normalizeFullscreenDurationSeconds(rawValue) {
  let value;
  if (typeof rawValue === 'number') value = rawValue;
  else if (typeof rawValue === 'string' && /^\d+$/.test(rawValue.trim()))
    value = Number(rawValue.trim());
  else return null;
  return Number.isSafeInteger(value) && value >= 2 && value <= 30
    ? value
    : null;
}

module.exports = { prefixes, routes };
