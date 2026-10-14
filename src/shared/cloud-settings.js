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

function hasCloudSettingChanges(keys) {
  return keys.some((key) => CLOUD_SYNC_KEYS.includes(key) || ['enableCustomReplyBot', 'customReplyRules'].includes(key));
}

module.exports = { CLOUD_SETTING_KEYS, CLOUD_SYNC_KEYS, hasCloudSettingChanges };
