// 编写人：Aurora
// 礼物域路由：冲刺进度重置。
'use strict';

const { sendJson } = require('../http-utils');
const { GIFT_DISPLAY_SETTING, readGiftDisplaySettings, validateGiftDisplaySettings } = require('../../bilibili/gift/display-settings');
const {
  buildGiftFramePreviewEvent,
} = require('../../bilibili/gift/frame-config');

const prefixes = ['/api/gifts/'];

const routes = {
  ...require('./gift-wish-routes').routes,
  async 'GET /api/gifts/card-profiles'(context, request, res) {
    try {
      const data = await context.giftCards.getProfiles(request.query.get('viewRevision'));
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      if (!['GIFT_VIEW_STALE', 'GIFT_SOURCE_UNAVAILABLE'].includes(error.code)) throw error;
      sendJson(res, 409, { ok: false, error: error.message, code: error.code });
    }
  },
  'GET /api/gifts/display-settings'(context, _request, res) {
    sendJson(res, 200, { ok: true, data: readGiftDisplaySettings(context.settings.get()) });
  },
  async 'POST /api/gifts/display-settings'(context, request, res) {
    let config;
    try { config = validateGiftDisplaySettings(await request.body()); }
    catch (error) {
      if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
      return sendJson(res, 400, { ok: false, error: error.message });
    }
    context.settings.set(GIFT_DISPLAY_SETTING, JSON.stringify(config));
    context.broadcastSnapshot('settings');
    sendJson(res, 200, { ok: true, data: config });
  },
  'POST /api/gifts/sprint/reset'(context, request, res) {
    const result = context.gifts.resetSprint();
    context.broadcastSnapshot('gift:sprint:reset');
    sendJson(res, 200, { ok: true, data: result });
  },

  'GET /api/gifts/history'(context, request, res) {
    sendGiftLedgerResponse(context, request, res, 'getHistory');
  },

  async 'POST /api/gifts/selection'(context, request, res) {
    const body = await request.body();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendJson(res, 400, { ok: false, error: '礼物选择参数无效。', code: 'INVALID_GIFT_SELECTION' });
    }
    try {
      if (body.sourceId !== undefined || body.source_id !== undefined) {
        return sendJson(res, 400, { ok: false, error: '礼物来源不能由页面指定。' });
      }
      sendJson(res, 200, { ok: true, data: context.gifts.getSelection(body) });
    } catch (error) {
      if (!/^(INVALID_GIFT_|GIFT_VIEW_STALE|GIFT_SOURCE_UNAVAILABLE)/.test(error.code || '')) throw error;
      sendJson(res, error.code.startsWith('INVALID_') ? 400 : 409,
        { ok: false, error: error.message, code: error.code });
    }
  },

  'GET /api/gifts/statistics'(context, request, res) {
    sendGiftLedgerResponse(context, request, res, 'getStatistics');
  },

  'GET /api/gifts/blind-box-stats'(context, request, res) {
    const boxName = request.query.get('boxName') || '';
    const stats = context.gifts.getBlindBoxStats({ boxName });
    sendJson(res, 200, { ok: true, data: stats });
  },

  'GET /api/gifts/blind-box-analysis'(context, request, res) {
    const query = request.query;
    const data = context.gifts.getBlindBoxAnalysis({
      viewer: query.get('viewer') || '',
      box: query.get('box') || '',
      view: query.get('view') || 'users',
      page: query.get('page') || '1',
      limit: query.get('limit') || '25',
      sort: query.get('sort') || '',
      direction: query.get('direction') || 'desc',
    });
    sendJson(res, 200, { ok: true, data });
  },

  'GET /api/gifts/search'(context, request, res) {
    const query = request.query || new Map();
    const getParam = (name) => {
      const val = query.get ? query.get(name) : query[name];
      return val || '';
    };
    const from = getParam('from');
    const to = getParam('to');
    const limit = Math.min(Number(getParam('limit')) || 100, 500);
    const rows = context.gifts.search({ from, to, limit });
    sendJson(res, 200, { ok: true, data: rows });
  },

  async 'GET /api/gifts/effects/resolve'(context, request, res) {
    const giftId = parseGiftEffectId(request.query.get('giftId'));
    if (!giftId)
      return sendJson(res, 400, {
        ok: false,
        error: '礼物 ID 必须是 1 至 12 位正整数。',
      });

    const effect = await context.gifts.resolveEffect(giftId);
    if (!effect) {
      sendJson(res, 404, {
        ok: false,
        error: '这个礼物暂时没有可播放的 MP4 全屏特效。',
      });
      return;
    }
    sendJson(res, 200, { ok: true, data: { giftId, effect } });
  },

  async 'POST /api/gifts/effects/preview'(context, request, res) {
    const body = await request.body();
    const giftId = parseGiftEffectId(body.giftId);
    if (!giftId)
      return sendJson(res, 400, {
        ok: false,
        error: '礼物 ID 必须是 1 至 12 位正整数。',
      });

    const effect = await context.gifts.resolveEffect(giftId);
    if (!effect) {
      sendJson(res, 404, {
        ok: false,
        error: '这个礼物暂时没有可播放的 MP4 全屏特效。',
      });
      return;
    }
    context.gifts.previewEffect({
      type: 'gift:effect',
      eventId: 0,
      giftId,
      effect,
      preview: true,
    });
    sendJson(res, 200, { ok: true, data: { giftId, effect } });
  },

  async 'POST /api/gifts/frame/preview'(context, request, res) {
    const body = await request.body();
    let event;
    try {
      event = buildGiftFramePreviewEvent(body);
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message || '礼物边框预览参数无效。',
      });
      return;
    }
    context.gifts.previewFrame(event);
    sendJson(res, 200, { ok: true, data: event });
  },

  async 'POST /api/gifts/clear-recent'(context, request, res) {
    const body = await request.body();
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = context.gifts.clearRecent();
    context.broadcastSnapshot('gift:clear-recent');
    sendJson(res, 200, { ok: true, data: result });
  },
};

function parseGiftEffectId(value) {
  const rawGiftId = String(value || '').trim();
  if (!/^\d{1,12}$/.test(rawGiftId)) return 0;
  const giftId = Number(rawGiftId);
  return Number.isSafeInteger(giftId) && giftId > 0 ? giftId : 0;
}

function sendGiftLedgerResponse(context, request, res, operation) {
  const query = request.query;
  if (query?.has?.('sourceId') || query?.has?.('source_id')) {
    sendJson(res, 400, {
      ok: false,
      error: '礼物来源不能由页面指定。',
      code: 'GIFT_SOURCE_SELECTOR_FORBIDDEN',
    });
    return;
  }
  try {
    const data = context.gifts[operation]({
      query: query?.has?.('query') ? query.get('query') : undefined,
      range: query?.get?.('range') || '30d',
      limit: query?.get?.('limit') || undefined,
      cursor: query?.get?.('cursor') || null,
      ...(operation === 'getHistory'
        ? {
            ...(query?.has?.('startDate') ? { startDate: query.get('startDate') } : {}),
            ...(query?.has?.('endDate') ? { endDate: query.get('endDate') } : {}),
            ...(query?.has?.('userQuery') ? { userQuery: query.get('userQuery') } : {}),
            ...(query?.has?.('giftQuery') ? { giftQuery: query.get('giftQuery') } : {}),
            ...(query?.has?.('amountAbove') ? { amountAbove: query.get('amountAbove') } : {}),
            ...(query?.has?.('viewRevision') ? { viewRevision: query.get('viewRevision') } : {}),
            sortField: query?.has?.('sortField')
              ? query.get('sortField')
              : undefined,
            sortDirection: query?.has?.('sortDirection')
              ? query.get('sortDirection')
              : undefined,
          }
        : {}),
    });
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    if (error?.code === 'GIFT_SOURCE_UNAVAILABLE' || error?.code === 'GIFT_VIEW_STALE') {
      sendJson(res, 409, {
        ok: false,
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (
      error?.code === 'INVALID_GIFT_QUERY' ||
      error?.code === 'INVALID_GIFT_FILTER' ||
      error?.code === 'INVALID_GIFT_RANGE' ||
      error?.code === 'INVALID_GIFT_LIMIT' ||
      error?.code === 'INVALID_GIFT_CURSOR' ||
      error?.code === 'INVALID_GIFT_SORT_FIELD' ||
      error?.code === 'INVALID_GIFT_SORT_DIRECTION'
    ) {
      sendJson(res, 400, {
        ok: false,
        error: error.message,
        code: error.code,
      });
      return;
    }
    throw error;
  }
}

module.exports = { prefixes, routes };
