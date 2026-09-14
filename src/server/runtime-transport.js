'use strict';

const httpUtils = require('./http-utils');
const { buildGiftFrameEvent } = require('../bilibili/gift/frame-config');
const { normalizeGiftEffectEvent } = require('../bilibili/gift/effect-event');

function createRuntimeTransport({
  publicDir,
  defaultPort,
  getHost,
  getStartedPort,
  getSessionToken,
  getWebSocketHub,
  getState,
  getSettings,
  getDanmakuFeedBuffer,
  resolveGiftEffect,
}) {
  function getWebSocketContext(baseUrl) {
    return {
      getState,
      sessionToken: getSessionToken(),
      allowedOrigins: baseUrl ? [baseUrl] : [],
    };
  }

  function broadcastSnapshot(reason) {
    const baseUrl = `http://${getHost()}:${getStartedPort() || defaultPort}`;
    getWebSocketHub()?.broadcastSnapshot(getWebSocketContext(baseUrl), reason);
  }

  function publishGiftFlushed(item) {
    broadcastSnapshot('bilibili:gift');
    const frameEvent = buildGiftFrameEvent(item, getSettings());
    if (frameEvent) getWebSocketHub()?.broadcast(frameEvent);
  }

  function publishGiftCatalogUpdate(snapshot) {
    getWebSocketHub()?.broadcast({ type: 'gift-catalog:update', snapshot });
  }

  async function publishGiftEffect(input, isCurrent) {
    const event = normalizeGiftEffectEvent(input);
    if (!event || !isCurrent() || getSettings()?.giftEffectDanmakuEnabled !== 'true') return false;
    let effect;
    try {
      effect = await resolveGiftEffect(Number(event.giftId));
    } catch { return false; }
    if (!effect || !isCurrent() || getSettings()?.giftEffectDanmakuEnabled !== 'true') return false;
    getWebSocketHub()?.broadcast({ ...event, giftId: Number(event.giftId), effect });
    return true;
  }

  function publishDanmaku(danmaku) {
    const item = getDanmakuFeedBuffer().push(danmaku);
    if (item) {
      getWebSocketHub()?.broadcast(
        { type: 'danmaku:message', item },
        { topic: 'danmaku' },
      );
    }
  }

  function publishOvertimeUpdate(update) {
    getWebSocketHub().broadcast({
      type: 'overtime:update',
      reason: update.reason,
      state: update.state,
      ...(update.adjustment ? { adjustment: update.adjustment } : {}),
    });
  }

  function servePageOrAsset(req, res, requestUrl) {
    httpUtils.servePageOrAsset(
      publicDir,
      req,
      res,
      requestUrl,
      getSessionToken(),
    );
  }

  return {
    getWebSocketContext,
    broadcastSnapshot,
    publishGiftFlushed,
    publishGiftCatalogUpdate,
    publishGiftEffect,
    publishDanmaku,
    publishOvertimeUpdate,
    servePageOrAsset,
  };
}

module.exports = { createRuntimeTransport };
