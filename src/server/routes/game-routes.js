'use strict';

const { sendJson, sendStableError } = require('../http-utils');
const { createPublicError } = require('../../shared/public-error');

const prefixes = ['/api/games', '/api/wheel'];

const routes = {
  async 'GET /api/games/viewers'(context, request, res) {
    try {
      await context.games.refreshViewers();
    } catch (error) {
      if (!context.games.listViewers().length) {
        throw Object.assign(createPublicError('观众名单刷新失败，请检查直播间连接后重试。', 503), { cause: error });
      }
      console.warn('[Games] Online rank refresh failed; using known viewer candidates.');
    }
    sendJson(res, 200, { ok: true, data: context.games.listViewers() });
  },
  'GET /api/games/draw-guess/categories'(context, request, res) {
    sendJson(res, 200, {
      ok: true,
      data: context.games.listDrawGuessCategories(),
    });
  },
  'GET /api/games/session'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.games.getSession() });
  },
  'GET /api/games/host-state'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.games.getHostState() });
  },
  async 'GET /api/games/winner-profile'(context, request, res) {
    sendJson(res, 200, {
      ok: true,
      data: await context.games.getWinnerProfile(),
    });
  },
  async 'POST /api/games/session'(context, request, res) {
    try {
      const body = await request.body();
      if (body.action === 'stop') {
        context.games.stop();
        sendJson(res, 200, { ok: true, data: null });
        return;
      }
      if (body.action === 'restart') {
        sendJson(res, 200, { ok: true, data: context.games.restart() });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        data: context.games.start(normalizeSessionInput(body)),
      });
    } catch (error) {
      if (!error?.publicMessage) throw error;
      sendStableError(res, error);
    }
  },
  async 'POST /api/games/session/move'(context, request, res) {
    const body = await request.body();
    const result = context.games.move({ value: body.value }, 'host');
    sendJson(res, result.accepted ? 200 : 400, {
      ok: result.accepted,
      ...(result.accepted ? { data: result.session } : { error: result.reason || '落子无效。' }),
    });
  },
  async 'POST /api/games/session/draw'(context, request, res) {
    const result = context.games.draw(await request.body());
    sendJson(res, result.accepted ? 200 : 400, {
      ok: result.accepted,
      ...(result.accepted ? { data: { revision: result.revision } } : { error: result.reason || '绘画操作无效。' }),
    });
  },
  'GET /api/wheel'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.wheel.getState() });
  },
  async 'POST /api/wheel/config'(context, request, res) {
    try {
      const body = await request.body();
      sendJson(res, 200, {
        ok: true,
        data: context.wheel.configure(normalizeWheelConfigInput(body)),
      });
    } catch (error) {
      if (!error?.publicMessage) throw error;
      sendStableError(res, error);
    }
  },
  async 'POST /api/wheel/spin'(context, request, res) {
    try {
      sendJson(res, 200, { ok: true, data: context.wheel.spin() });
    } catch (error) {
      if (!error?.publicMessage) throw error;
      sendStableError(res, error);
    }
  },
};

function normalizeSessionInput(input = {}) {
  const game = String(input.game || '');
  if (!['number-bomb', 'gomoku', 'draw-guess'].includes(game)) throw createPublicError('不支持这个游戏。');
  if (game === 'draw-guess') {
    const result = {
      game,
      mode: 'multi',
      targetUid: '',
      targetName: '直播间观众',
    };
    if (Object.hasOwn(input, 'totalRounds')) result.totalRounds = Number(input.totalRounds);
    if (Object.hasOwn(input, 'roundDurationSeconds')) result.roundDurationSeconds = Number(input.roundDurationSeconds);
    if (Object.hasOwn(input, 'categoryIds')) result.categoryIds = normalizeDrawGuessCategoryIds(input.categoryIds);
    return result;
  }
  const mode = input.mode === 'multi' ? 'multi' : 'single';
  const targetUid = String(input.targetUid || '').trim();
  const targetName = String(input.targetName || '')
    .trim()
    .slice(0, 80);
  if (mode === 'single' && !/^\d{1,20}$/.test(targetUid)) throw createPublicError('请选择一位观众。');
  return { game, mode, targetUid, targetName };
}

function normalizeDrawGuessCategoryIds(value) {
  if (!Array.isArray(value) || value.length < 1) throw createPublicError('请至少选择一个词库分类。');
  if (value.length > 16) throw createPublicError('词库分类数量过多。');
  const categoryIds = [
    ...new Set(
      value.map((item) =>
        String(item || '')
          .trim()
          .toLowerCase(),
      ),
    ),
  ];
  if (categoryIds.some((id) => !/^[a-z0-9-]{1,32}$/.test(id))) throw createPublicError('词库分类无效。');
  return categoryIds;
}

function normalizeWheelConfigInput(input = {}) {
  if (!Array.isArray(input.entries)) throw createPublicError('请至少配置两个转盘选项。');
  return input.entries.map((entry) => ({
    label: String(entry?.label || '').trim(),
    weight: entry?.weight,
  }));
}

module.exports = {
  prefixes,
  routes,
  normalizeSessionInput,
  normalizeWheelConfigInput,
};
