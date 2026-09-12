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
    if (reason === 'database:clear-gifts' && result?.projectionReset) {
      triggerGiftRebuild(context);
    }
    context.broadcastSnapshot(reason);
    if (reason === 'database:clear') context.cloudSync?.request?.('songs');
    sendJson(res, 200, { ok: true, data: result });
  };
}

function resumeClearAllWriters(context, { gifts = true, overtime = true } = {}) {
  try {
    // 先准备结算消费者，再恢复可能立即派发礼物的检测器。
    if (overtime) context.overtime.resumeRecovery();
    if (gifts) context.gifts.resumeDetection();
  } catch (error) {
    context.gifts.pauseDetection();
    context.overtime.pauseRecovery();
    throw error;
  }
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
  'POST /api/database/clear': clearRoute(
    (context) => context.data.clearSongLibrary(),
    'database:clear',
  ),
  'POST /api/database/clear-superchats': clearRoute(
    (context) => context.data.clearSuperChats(),
    'database:clear-superchats',
  ),
  'POST /api/database/clear-playback': clearRoute(
    (context) => context.data.clearPlayback(),
    'database:clear-playback',
  ),
  'POST /api/database/clear-gifts': clearGiftDatabases,

  // 清空全部：需要静默异步写入器并处理部分失败
  async 'POST /api/database/clear-all'(context, request, res) {
    const body = await request.body();
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }

    // 静默异步写入器，避免清空过程中的并发写入
    const acquired = { gifts: false, overtime: false };
    let result;
    try {
      acquired.gifts = context.gifts.pauseDetection() !== false;
      acquired.overtime = context.overtime.pauseRecovery() !== false;
      result = context.data.clearAll();
    } catch (error) {
      try {
        resumeClearAllWriters(context, acquired);
      } catch (resumeError) {
        error.cause = resumeError;
      }
      throw error;
    }

    // 清空全部数据时同步清理音乐 API / 歌词缓存；缓存失败不影响数据库清理结果。
    if (context.music && typeof context.music.clearCache === 'function') {
      try {
        context.music.clearCache();
      } catch (_) {
        /* cache cleanup is best-effort */
      }
    }

    if (result.cleared && !result.partial) {
      try {
        resumeClearAllWriters(context);
      } catch (error) {
        result = {
          ...result,
          ok: false,
          cleared: false,
          partial: true,
          phase: 'resume',
          failed: [],
          error: `数据已清空，但写入恢复失败：${error.message}`,
        };
      }
    }

    // 处理部分失败：跨库提交、回滚或运行状态恢复未完全成功。
    if (result.partial === true) {
      if (
        result.giftProjectionReset &&
        result.committed?.includes('giftDb')
      ) {
        triggerGiftRebuild(context);
      }
      sendJson(res, 500, {
        ok: false,
        partial: true,
        error: result.error,
        data: result,
      });
      return;
    }

    // 成功后重建已清空的礼物投影
    if (result.cleared) {
      if (result.giftProjectionReset) triggerGiftRebuild(context);
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
