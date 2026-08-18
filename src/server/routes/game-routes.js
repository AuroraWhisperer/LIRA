'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/games'];

const routes = {
  'GET /api/games/viewers'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.games.listViewers() });
  },
  'GET /api/games/session'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.games.getSession() });
  },
  async 'POST /api/games/session'(context, request, res) {
    try {
      const body = await request.body();
      if (body.action === 'stop') {
        context.games.stop();
        sendJson(res, 200, { ok: true, data: null });
        return;
      }
      sendJson(res, 200, { ok: true, data: context.games.start(normalizeSessionInput(body)) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || '无法开始游戏。' });
    }
  },
  async 'POST /api/games/session/move'(context, request, res) {
    const body = await request.body();
    const result = context.games.move({ value: body.value }, 'host');
    sendJson(res, result.accepted ? 200 : 400, {
      ok: result.accepted,
      ...(result.accepted ? { data: result.session } : { error: result.reason || '落子无效。' })
    });
  }
};

function normalizeSessionInput(input = {}) {
  const game = String(input.game || '');
  if (!['number-bomb', 'gomoku'].includes(game)) throw new Error('不支持这个游戏。');
  const mode = input.mode === 'multi' ? 'multi' : 'single';
  const targetUid = String(input.targetUid || '').trim();
  const targetName = String(input.targetName || '').trim().slice(0, 80);
  if (mode === 'single' && !/^\d{1,20}$/.test(targetUid)) throw new Error('请选择一位在线观众。');
  return { game, mode, targetUid, targetName };
}

module.exports = { prefixes, routes, normalizeSessionInput };
