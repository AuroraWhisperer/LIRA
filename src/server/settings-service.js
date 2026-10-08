'use strict';

const { normalizeSettingsPatch, hasCloudSettingChanges } = require('./settings-contract');
const { needsClockStyleOptionsUpdate, mergeClockStyleOptions } = require('./clock-contract');

async function applySettingsPatch({ settings, weSing, bilibili, broadcastSnapshot, cloudSync }, patch) {
  const result = normalizeSettingsPatch(patch, settings.defaults);
  if (result.error) return result;

  const weSingSettings = {};
  if (Object.hasOwn(result.values, 'weSingCachePath')) weSingSettings.cachePath = result.values.weSingCachePath;
  if (Object.hasOwn(result.values, 'weSingLyricOffsetMs')) {
    weSingSettings.lyricOffsetMs = result.values.weSingLyricOffsetMs;
  }
  let preparedWeSing;
  if (Object.keys(weSingSettings).length > 0) {
    try {
      preparedWeSing = await weSing.prepareConfiguration(weSingSettings);
    } catch (error) {
      return { error: error.message || String(error) };
    }
  }

  const values = needsClockStyleOptionsUpdate(result.values)
    ? mergeClockStyleOptions(settings.get(), result.values) : result.values;
  const changedKeys = settings.setMany(values);
  if (preparedWeSing) await preparedWeSing.apply();
  bilibili.configure();
  broadcastSnapshot('settings');
  if (hasCloudSettingChanges(changedKeys)) cloudSync?.request?.('settings');
  return { changedKeys };
}

module.exports = { applySettingsPatch };
