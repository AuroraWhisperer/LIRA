'use strict';

const httpUtils = require('./http-utils');
const runtimeReporting = require('./runtime-reporting');
const { cleanText } = require('../shared/utils');

function createRuntimeTransport({
  publicDir,
  defaultPort,
  getHost,
  getStartedPort,
  getSessionToken,
  getWebSocketHub,
  getState,
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
    servePageOrAsset,
  };
}

module.exports = { createRuntimeTransport };
