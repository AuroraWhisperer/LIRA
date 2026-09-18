'use strict';

const { sendJson } = require('./http-utils');
const { projectOverlayResponse } = require('./overlay-projection');
const { getClockConfig } = require('./clock-contract');
const { getOpeningConfig } = require('./routes/opening-routes');
const { readGiftDisplaySettings } = require('../bilibili/gift/display-settings');
const { routes: bilibiliRoutes } = require('./routes/bilibili-routes');

// Called only after exact scope/method/path authorization. Domain services still
// validate moves, drawing, cursors and input sizes; this boundary limits purpose.
async function handleOverlayApi(context, principal, request, res) {
  const { method, pathName, query } = request;
  const reply = (data) => sendJson(res, 200, {
    ok: true, data: projectOverlayResponse(principal.scope, pathName, data),
  });
  if (method === 'GET') {
    switch (pathName) {
      case '/api/state': return reply(context.system.getState());
      case '/api/songs':
        return reply(context.songs.list({ enabledOnly: true, categories: query.getAll('category') }));
      case '/api/gifts/blind-box-stats':
        return reply(context.gifts.getBlindBoxStats({ boxName: query.get('boxName') || '' }));
      case '/api/gifts/display-settings':
        return reply(readGiftDisplaySettings(context.settings.get()));
      case '/api/gifts/history': {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
        try {
          return reply(context.gifts.getHistory({
            range: 'today', startDate: today, endDate: today, limit: 100,
            sortField: 'created_at', sortDirection: 'asc',
            cursor: query.get('cursor') || null,
            ...(query.has('viewRevision') ? { viewRevision: query.get('viewRevision') } : {}),
          }));
        } catch (error) {
          if (/^(INVALID_GIFT_|GIFT_VIEW_STALE|GIFT_SOURCE_UNAVAILABLE)/.test(error.code || '')) {
            return sendJson(res, error.code.startsWith('INVALID_') ? 400 : 409, {
              ok: false, error: error.message, code: error.code,
            });
          }
          throw error;
        }
      }
      case '/api/overtime/gifts/catalog': return reply(context.overtime.getGlobalGiftCatalog());
      case '/api/games/session': return reply(context.games.getSession());
      case '/api/games/winner-profile': return reply(await context.games.getWinnerProfile());
      case '/api/wheel': return reply(context.wheel.getState());
      case '/api/clock/config': return reply(getClockConfig(context.settings.get()));
      case '/api/opening/config': return reply(getOpeningConfig(context));
      case '/api/bilibili/avatar':
        return bilibiliRoutes['GET /api/bilibili/avatar'](context, request, res);
    }
  }
  if (method === 'POST') {
    const body = await request.body();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, { ok: false, error: '请求参数无效。' });
    }
    switch (pathName) {
      case '/api/games/session':
        if (body.action === 'stop') {
          context.games.stop();
          return reply(null);
        }
        if (body.action !== 'restart') return forbidden(res);
        return runAction(() => context.games.restart(), reply, res);
      case '/api/games/session/move': {
        // Draw-guess host controls also enter move() through value.action.
        // Overlay moves are only the existing number/coordinate inputs.
        if (!['string', 'number'].includes(typeof body.value)) return forbidden(res);
        const result = context.games.move({ value: body.value }, 'host');
        return result.accepted ? reply(result.session)
          : sendJson(res, 400, { ok: false, error: result.reason || '落子无效。' });
      }
      case '/api/games/session/draw': {
        if (!['append', 'undo', 'clear'].includes(body.action)) return forbidden(res);
        const result = context.games.draw({
          action: body.action, clientId: body.clientId, strokeId: body.strokeId,
          color: body.color, width: body.width, points: body.points,
        });
        return result.accepted ? reply({ revision: result.revision })
          : sendJson(res, 400, { ok: false, error: result.reason || '绘画操作无效。' });
      }
      case '/api/wheel/spin': return runAction(() => context.wheel.spin(), reply, res);
    }
  }
  return forbidden(res);
}

function runAction(action, reply, res) {
  try { return reply(action()); }
  catch (error) {
    return sendJson(res, error.statusCode === 409 ? 409 : 400, { ok: false, error: '当前状态无法执行此操作。' });
  }
}

function forbidden(res) {
  return sendJson(res, 403, { ok: false, error: '该页面无权执行此操作。' });
}

module.exports = { handleOverlayApi };
