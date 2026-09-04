// 编写人：Aurora
// 礼物域路由：冲刺进度重置。
'use strict';

const { sendJson } = require('../http-utils');
const {
  buildGiftFramePreviewEvent,
} = require('../../bilibili/gift/frame-config');

const prefixes = ['/api/gifts/'];

const routes = {
  'POST /api/gifts/sprint/reset'(context, request, res) {
    const result = context.gifts.resetSprint();
    context.broadcastSnapshot('gift:sprint:reset');
    sendJson(res, 200, { ok: true, data: result });
  },

  'GET /api/gifts/history'(context, request, res) {
    sendGiftLedgerResponse(context, request, res, 'getHistory');
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
    });
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    if (error?.code === 'GIFT_SOURCE_UNAVAILABLE') {
      sendJson(res, 409, {
        ok: false,
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (
      error?.code === 'INVALID_GIFT_QUERY' ||
      error?.code === 'INVALID_GIFT_RANGE' ||
      error?.code === 'INVALID_GIFT_LIMIT' ||
      error?.code === 'INVALID_GIFT_CURSOR'
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
