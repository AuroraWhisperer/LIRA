// 编写人：Aurora
// 主题预设域路由。应用预设会写回 settings，因此要广播快照让叠加层刷新。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/theme/'];

function themeRoute(run) {
  return async (context, request, res) => {
    try {
      sendJson(res, 200, { ok: true, data: await run(context, request) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || '主题预设操作失败。' });
    }
  };
}

const routes = {
  'GET /api/theme/presets': themeRoute((context) => ({
    presets: context.theme.list()
  })),

  'POST /api/theme/presets': themeRoute(async (context, request) => {
    const body = await request.body();
    return { preset: context.theme.saveCurrent(body) };
  }),

  'POST /api/theme/presets/apply': themeRoute(async (context, request) => {
    const body = await request.body();
    const result = context.theme.apply(body.id);
    context.broadcastSnapshot('theme:preset-applied');
    return result;
  }),

  'POST /api/theme/presets/rename': themeRoute(async (context, request) => {
    const body = await request.body();
    return { preset: context.theme.rename(body.id, body.name) };
  }),

  'POST /api/theme/presets/delete': themeRoute(async (context, request) => {
    const body = await request.body();
    return context.theme.remove(body.id);
  })
};

module.exports = { prefixes, routes };
