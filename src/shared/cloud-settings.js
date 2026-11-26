'use strict';

const { SONG_REQUEST_CONTROL_KEYS } = require('./song-request-settings');

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
  ...SONG_REQUEST_CONTROL_KEYS,
  'guardPriorityEnabled',
  'songCooldownMode',
  'songCooldownValue',
  'danmakuMonitoringEnabled',
  'giftMonitoringEnabled',
  'giftEffectDanmakuEnabled',
  ...CLOUD_SETTING_KEYS,
  'giftBlindBoxConfig',
  'giftBlindBoxCustomConfigV2',
]);

function isKeywordMenuSetting(key) {
  return key === 'enableCustomReplyBot' || key === 'customReplyRules';
}

function hasKeywordMenuCommand(settings, parseCustomReplyRules) {
  return (settings.danmakuMonitoringEnabled ?? settings.enableBilibili) === 'true'
    && settings.enableCustomReplyBot === 'true'
    && parseCustomReplyRules(settings.customReplyRules).some(rule => rule.enabled);
}

function hasCloudSettingChanges(keys) {
  return keys.some(key => CLOUD_SYNC_KEYS.includes(key));
}

module.exports = { CLOUD_SETTING_KEYS, CLOUD_SYNC_KEYS, isKeywordMenuSetting, hasKeywordMenuCommand, hasCloudSettingChanges };
