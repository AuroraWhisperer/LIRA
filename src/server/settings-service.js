'use strict';

const { normalizeSettingsPatch } = require('./settings-contract');
const { needsClockStyleOptionsUpdate, mergeClockStyleOptions } = require('./clock-contract');

// The API context is rebuilt per request. Its setter belongs to the live settings store.
const updateWritersByStore = new WeakMap();
const MAX_RECENT_UPDATE_WRITERS = 32;

function updateWriteOrder(settings, values, edit) {
  if (!edit || !Object.hasOwn(values, 'enableAutoUpdate') || Object.keys(values).length !== 1) return;
  const match = /^([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\/([1-9]\d{0,14})$/.exec(edit);
  if (!match) return;
  let writers = updateWritersByStore.get(settings.setMany);
  if (!writers) {
    writers = new Map();
    updateWritersByStore.set(settings.setMany, writers);
  }
  return { writers, writer: match[1], revision: Number(match[2]) };
}

async function applySettingsPatch({ settings, weSing, bilibili, broadcastSnapshot, cloudSync, authorize = () => {}, updateEdit }, patch) {
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

  authorize();
  const values = needsClockStyleOptionsUpdate(result.values)
    ? mergeClockStyleOptions(settings.get(), result.values) : result.values;
  const order = updateWriteOrder(settings, values, updateEdit);
  if (order && order.writers.get(order.writer) >= order.revision) return { changedKeys: [] };
  let cloudChanged = false;
  const changedKeys = settings.setMany(values, { onCloudChange() { cloudChanged = true; } });
  if (order) {
    order.writers.delete(order.writer);
    order.writers.set(order.writer, order.revision);
    // Only overlapping requests from recent admin documents can still arrive.
    if (order.writers.size > MAX_RECENT_UPDATE_WRITERS) order.writers.delete(order.writers.keys().next().value);
  }
  if (preparedWeSing) await preparedWeSing.apply();
  authorize();
  bilibili.configure();
  broadcastSnapshot('settings');
  if (cloudChanged) cloudSync?.request?.('settings');
  return { changedKeys };
}

module.exports = { applySettingsPatch };
