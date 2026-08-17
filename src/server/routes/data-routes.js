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
  'POST /api/database/clear-gifts': clearRoute((context) => context.data.clearGifts(), 'database:clear-gifts'),

  // 清空全部：需要静默异步写入器并处理部分失败
  async 'POST /api/database/clear-all'(context, request, res) {
    const body = await request.body();
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }

    // 静默异步写入器，避免清空过程中的并发写入
    if (context.gifts && typeof context.gifts.pauseDetection === 'function') {
      context.gifts.pauseDetection();
    }
    if (context.overtime && typeof context.overtime.pauseRecovery === 'function') {
      context.overtime.pauseRecovery();
    }

    const result = context.data.clearAll();

    // 处理部分失败：某些数据库提交成功，某些失败
    if (result.partial === true) {
      sendJson(res, 500, {
        ok: false,
        partial: true,
        error: result.error,
        data: result
      });
      return;
    }

    // 成功后重置内存状态
    if (result.cleared && context.gifts && typeof context.gifts.resumeDetection === 'function') {
      context.gifts.resumeDetection();
    }
    if (result.cleared && context.overtime && typeof context.overtime.resumeRecovery === 'function') {
      context.overtime.resumeRecovery();
    }

    context.broadcastSnapshot('database:clear-all');
    sendJson(res, 200, { ok: true, data: result });
  },

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
