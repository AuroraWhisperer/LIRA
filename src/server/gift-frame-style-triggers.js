'use strict';

// 组合根使用：列出消费礼物事件的全屏礼物感谢导入样式，并把升级前共用的开关迁移为各样式独立设置。
const { createComponentStyleStore } = require('../storage/component-style-store');
const { DEFAULT_FRAME_SETTINGS, normalizeThresholdRmb } = require('../bilibili/gift/frame-config');
const {
  GIFT_FRAME_STYLE_TRIGGERS_KEY,
  MAX_GIFT_FRAME_STYLE_TRIGGERS,
} = require('../../public/js/shared/gift-frame-style-triggers.js');

// Removed library cards stay listed: existing scenes may still play them.
function listGiftFrameTriggerStyleIds(dataDir) {
  if (!dataDir) return [];
  return createComponentStyleStore(dataDir).listMediaStyleIds('gift-frame');
}

// Idempotent: runs only while the key is still unset; an unreadable library is retried next start.
function migrateGiftFrameStyleTriggers(settingsStore, dataDir) {
  const settings = settingsStore.getSettings();
  if (settings[GIFT_FRAME_STYLE_TRIGGERS_KEY] !== '') return false;
  let ids;
  try { ids = listGiftFrameTriggerStyleIds(dataDir); } catch { return false; }
  const enabled = settings.giftFrameEnabled === 'true' ? 'true' : 'false';
  const thresholdRmb = normalizeThresholdRmb(settings.giftFrameThresholdRmb) ?? DEFAULT_FRAME_SETTINGS.giftFrameThresholdRmb;
  const triggers = Object.fromEntries([...new Set(ids)].slice(-MAX_GIFT_FRAME_STYLE_TRIGGERS)
    .map((id) => [id, { enabled, thresholdRmb }]));
  settingsStore.setSetting(GIFT_FRAME_STYLE_TRIGGERS_KEY, JSON.stringify(triggers));
  return true;
}

module.exports = { listGiftFrameTriggerStyleIds, migrateGiftFrameStyleTriggers };
