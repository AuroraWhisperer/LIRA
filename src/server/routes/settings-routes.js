// 编写人：Aurora
// 设置域路由：校验后原子提交，并通知相关消费者。
'use strict';

const { sendJson } = require('../http-utils');
const { normalizeSettingsPatch, hasCloudSettingChanges } = require('../settings-contract');
const { getClockConfig } = require('../clock-contract');
const { CLOCK_APPEARANCE_KEYS } = require('../../../public/js/shared/clock-settings.js');

const prefixes = ['/api/settings'];
const routes = {
  async 'POST /api/settings'(context, request, res) {
    const result = normalizeSettingsPatch(await request.body(), context.settings.defaults);
    if (result.error) {
      sendJson(res, 400, { ok: false, error: result.error });
      return;
    }
    const weSingSettings = {};
    if (Object.hasOwn(result.values, 'weSingCachePath')) weSingSettings.cachePath = result.values.weSingCachePath;
    if (Object.hasOwn(result.values, 'weSingLyricOffsetMs'))
      weSingSettings.lyricOffsetMs = result.values.weSingLyricOffsetMs;
    let preparedWeSing;
    if (Object.keys(weSingSettings).length > 0) {
      try {
        preparedWeSing = await context.weSing.prepareConfiguration(weSingSettings);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || String(error) });
        return;
      }
    }
    if (!Object.hasOwn(result.values, 'clockStyleOptions')
      && Object.values(CLOCK_APPEARANCE_KEYS).some(key => Object.hasOwn(result.values, key))) {
      const current = context.settings.get();
      const options = getClockConfig({ ...current, clockStyleOptions: current.clockStyleOptions || '{}' }).styleOptions;
      const changed = getClockConfig({ ...current, ...result.values, clockStyleOptions: undefined });
      const patch = Object.fromEntries(Object.entries(CLOCK_APPEARANCE_KEYS)
        .filter(([, key]) => Object.hasOwn(result.values, key)).map(([field]) => [field, changed[field]]));
      result.values.clockStyleOptions = JSON.stringify({ ...options, [changed.style]: { ...options[changed.style], ...patch } });
    }
    const changedKeys = context.settings.setMany(result.values);
    if (preparedWeSing) await preparedWeSing.apply();
    context.bilibili.configure();
    context.broadcastSnapshot('settings');
    if (hasCloudSettingChanges(changedKeys)) context.cloudSync?.request?.('settings');
    sendJson(res, 200, { ok: true, data: context.system.getState() });
  },
};

module.exports = { prefixes, routes };
