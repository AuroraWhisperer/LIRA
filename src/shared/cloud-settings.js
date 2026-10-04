'use strict';

const CLOUD_SETTING_KEYS = Object.freeze([
  'roomId',
  'enableBilibili',
  'paused',
  'queueLimit',
  'userCooldownSeconds',
  'onlyFromLibrary',
  'allowDuplicate',
]);
const CLOUD_SYNC_KEYS = Object.freeze([
  'danmakuMonitoringEnabled',
  'giftMonitoringEnabled',
  'giftEffectDanmakuEnabled',
  ...CLOUD_SETTING_KEYS,
  'giftBlindBoxConfig',
  'giftBlindBoxCustomConfigV2',
]);

function hasCloudSettingChanges(keys) {
  return keys.some((key) => CLOUD_SYNC_KEYS.includes(key));
}

module.exports = { CLOUD_SETTING_KEYS, CLOUD_SYNC_KEYS, hasCloudSettingChanges };
