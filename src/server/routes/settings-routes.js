// 编写人：Aurora
// 设置域路由：解析请求并返回应用操作结果。
'use strict';

const { sendJson } = require('../http-utils');
const { applySettingsPatch } = require('../settings-service');

const prefixes = ['/api/settings'];
const routes = {
  async 'POST /api/settings'(context, request, res) {
    const result = await applySettingsPatch({
      settings: context.settings,
      weSing: context.weSing,
      bilibili: context.bilibili,
      broadcastSnapshot: context.broadcastSnapshot,
      cloudSync: context.cloudSync,
    }, await request.body());
    if (result.error) {
      sendJson(res, 400, { ok: false, error: result.error });
      return;
    }
    sendJson(res, 200, { ok: true, data: context.system.getState() });
  },
};

module.exports = { prefixes, routes };
