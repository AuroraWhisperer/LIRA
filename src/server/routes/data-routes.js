// 编写人：Aurora
// 数据清理域路由，全部要求显式 confirm。
'use strict';

const { sendJson } = require('../http-utils');
const { runClearAll } = require('../data-maintenance-runtime');

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
    if (reason === 'database:clear-gifts' && result?.projectionReset) {
      triggerGiftRebuild(context);
    }
    context.broadcastSnapshot(reason);
    if (reason === 'database:clear') context.cloudSync?.request?.('songs');
    sendJson(res, 200, { ok: true, data: result });
  };
}

async function clearGiftDatabases(context, request, res) {
  const body = await request.body();
  if (body.confirm !== true) {
    sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
    return;
  }
  if (typeof context.giftSync?.clearRemote !== 'function') {
    sendJson(res, 503, {
      ok: false,
      error: '服务器礼物流水清理不可用，本地数据未删除。',
    });
    return;
  }

  let remoteResult;
  try {
    remoteResult = await context.giftSync.clearRemote();
  } catch {
    sendJson(res, 502, {
      ok: false,
      error: '服务器礼物流水清理失败，本地数据未删除。',
    });
    return;
  }

  let result;
  try {
    result = context.data.clearGifts();
  } catch {
    triggerGiftRebuild(context);
    sendJson(res, 500, {
      ok: false,
      partial: true,
      error: '服务器礼物流水已清空，但本地清理失败，正在重新同步。',
    });
    return;
  }

  triggerGiftRebuild(context);
  context.broadcastSnapshot('database:clear-gifts');
  sendJson(res, 200, {
    ok: true,
    data: {
      ...result,
      remoteDeletedCounts: remoteResult.deletedCounts,
    },
  });
}

const routes = {
  'POST /api/database/clear': clearRoute((context) => context.data.clearSongLibrary(), 'database:clear'),
  'POST /api/database/clear-superchats': clearRoute(
    (context) => context.data.clearSuperChats(),
    'database:clear-superchats',
  ),
  'POST /api/database/clear-playback': clearRoute((context) => context.data.clearPlayback(), 'database:clear-playback'),
  'POST /api/database/clear-gifts': clearGiftDatabases,

  // 清空全部：需要静默异步写入器并处理部分失败
  async 'POST /api/database/clear-all'(context, request, res) {
    const body = await request.body();
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }

    const result = runClearAll({
      clearAll: () => context.data.clearAll(),
      pauseGifts: () => context.gifts.pauseDetection(),
      resumeGifts: () => context.gifts.resumeDetection(),
      pauseOvertime: () => context.overtime.pauseRecovery(),
      resumeOvertime: () => context.overtime.resumeRecovery(),
      clearMusicCache: () => {
        if (typeof context.music?.clearCache === 'function') context.music.clearCache();
      },
      rebuildGiftProjection: () => context.giftSync?.rebuild?.(),
    });

    // 处理部分失败：跨库提交、回滚或运行状态恢复未完全成功。
    if (result.partial === true) {
      sendJson(res, 500, {
        ok: false,
        partial: true,
        error: result.error,
        data: result,
      });
      return;
    }

    context.broadcastSnapshot('database:clear-all');
    context.cloudSync?.request?.('songs');
    sendJson(res, 200, { ok: true, data: result });
  },

  // 存储占用与各库 schema 版本，供管理页展示
  'GET /api/database/stats'(context, request, res) {
    sendJson(res, 200, {
      ok: true,
      data: {
        schemaVersions: context.data.getSchemaVersions(),
        tables: context.data.getRetentionStats(),
      },
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
    while (result.hasMoreGiftEvents) {
      await new Promise((resolve) => setImmediate(resolve));
      if (res.destroyed) return;
      const batch = context.data.runRetention({ policy: result.policy, ranAt: result.ranAt });
      for (const key of ['giftRawJsonCleared', 'giftEventsDeleted', 'requestsDeleted', 'superChatsDeleted',
        'aiRequestLogsDeleted', 'cooldownsDeleted', 'songCooldownsDeleted', 'importBatchesDeleted']) {
        result[key] += batch[key];
      }
      result.hasMoreGiftEvents = batch.hasMoreGiftEvents;
    }
    if (!dryRun) context.broadcastSnapshot('database:retention');
    sendJson(res, 200, { ok: true, data: result });
  },
};

function triggerGiftRebuild(context) {
  try {
    const pending = context.giftSync?.rebuild?.();
    pending?.catch?.(() => false);
    return true;
  } catch {
    return false;
  }
}

module.exports = { prefixes, routes };
