// 编写人：Aurora
// 数据清理域路由，全部要求显式 confirm。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/database/'];

// 清空类操作统一走确认校验 + 快照广播
function clearRoute(clear, reason) {
  return async (context, request, res) => {
    const body = await request.body();
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = clear(context);
    context.broadcastSnapshot(reason);
    sendJson(res, 200, { ok: true, data: result });
  };
}

const routes = {
  'POST /api/database/clear': clearRoute((context) => context.data.clearSongLibrary(), 'database:clear'),
  'POST /api/database/clear-superchats': clearRoute((context) => context.data.clearSuperChats(), 'database:clear-superchats'),
  'POST /api/database/clear-playback': clearRoute((context) => context.data.clearPlayback(), 'database:clear-playback'),
  'POST /api/database/clear-all': clearRoute((context) => context.data.clearAll(), 'database:clear-all'),

  // 存储占用与各库 schema 版本，供管理页展示
  'GET /api/database/stats'(context, request, res) {
    sendJson(res, 200, {
      ok: true,
      data: {
        schemaVersions: context.data.getSchemaVersions(),
        tables: context.data.getRetentionStats()
      }
    });
  },

  // 保留期清理。dryRun=true 只统计不删除，不需要 confirm
  async 'POST /api/database/retention'(context, request, res) {
    const body = await request.body();
    const dryRun = body.dryRun === true;
    if (!dryRun && body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清理确认。' });
      return;
    }
    const result = context.data.runRetention({ dryRun, policy: body.policy });
    if (!dryRun) context.broadcastSnapshot('database:retention');
    sendJson(res, 200, { ok: true, data: result });
  }
};

module.exports = { prefixes, routes };
