'use strict';

const httpUtils = require('./http-utils');
const runtimeReporting = require('./runtime-reporting');
const { cleanText } = require('../shared/utils');
const { buildGiftFrameEvent } = require('../bilibili/gift/frame-config');

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

  function logGiftDelivery(trigger, item) {
    runtimeReporting.logGiftDelivery(trigger, item, cleanText);
  }

  function publishGiftFlushed(item) {
    logGiftDelivery('final', item);
    broadcastSnapshot('bilibili:gift');
    const frameEvent = buildGiftFrameEvent(item, getSettings());
    if (frameEvent) getWebSocketHub()?.broadcast(frameEvent);
  }

  function publishGiftCatalogUpdate(snapshot) {
    getWebSocketHub()?.broadcast({ type: 'gift-catalog:update', snapshot });
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
    logGiftDelivery,
    publishGiftFlushed,
    publishGiftCatalogUpdate,
    publishDanmaku,
    publishOvertimeUpdate,
    servePageOrAsset,
  };
}

module.exports = { createRuntimeTransport };
