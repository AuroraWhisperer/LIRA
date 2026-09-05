// 编写人：Aurora
// 设置域路由：校验后原子提交，并通知相关消费者。
'use strict';

const { sendJson } = require('../http-utils');
const { normalizeSettingsPatch, hasCloudSettingChanges } = require('../settings-contract');

const prefixes = ['/api/settings'];
const routes = {
  async 'POST /api/settings'(context, request, res) {
    const result = normalizeSettingsPatch(await request.body(), context.settings.defaults);
    if (result.error) {
      sendJson(res, 400, { ok: false, error: result.error });
      return;
    }
    const changedKeys = context.settings.setMany(result.values);
    context.bilibili.configure();
    context.broadcastSnapshot('settings');
    if (hasCloudSettingChanges(changedKeys)) context.cloudSync?.request?.('settings');
    sendJson(res, 200, { ok: true, data: context.system.getState() });
  },
};

module.exports = { prefixes, routes };
