'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const httpUtils = require('./http-utils');
const { SERVICE_ID } = require('./lifecycle');
const apiRoutes = require('./api-routes');
const { redactCredentials } = require('../shared/log-redaction');

/**
 * Build the HTTP/upgrade transport for one server runtime.
 * Domain state stays behind the explicitly supplied callbacks.
 */
function createHttpServer(options = {}) {
  const {
    host,
    startPort,
    dataDir,
    getPhase,
    getStartedPort,
    isLicenseAuthorized,
    inflightTracker,
    createApiContext,
    getSettings,
    servePageOrAsset,
    getWebSocketContext,
    getWebSocketHub,
  } = options;

  const serviceUnavailable = (res) => {
    httpUtils.sendJson(res, 503, {
      ok: false,
      error: 'Service is starting or shutting down.',
    });
  };

  const rejectUpgrade = (socket, status) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`, () => socket.destroy());
  };

  const server = http.createServer(async (req, res) => {
    let requestPath = '[invalid-url]';
    try {
      const phase = getPhase();
      const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${startPort}`}`);
      requestPath = requestUrl.pathname;

      const baseUrl = `http://${host}:${getStartedPort() || startPort}`;
      if (!httpUtils.validateRequestHost(req, baseUrl)) {
        httpUtils.sendJson(res, 400, {
          ok: false,
          error: 'Invalid Host header.',
        });
        return;
      }

      if (requestUrl.pathname === '/api/health' && phase !== 'ready') {
        httpUtils.sendJson(res, 200, {
          ok: true,
          data: {
            serviceId: SERVICE_ID,
            phase,
          },
        });
        return;
      }

      if (phase !== 'ready') {
        serviceUnavailable(res);
        return;
      }

      if (!isLicenseAuthorized()) {
        if (
          requestUrl.pathname === '/admin' ||
          requestUrl.pathname === '/' ||
          requestUrl.pathname === '/settings' ||
          requestUrl.pathname === '/songs'
        ) {
          res.writeHead(302, {
            Location: '/license',
            'Cache-Control': 'no-store',
          });
          res.end();
          return;
        }
        if (requestUrl.pathname.startsWith('/api/') && requestUrl.pathname !== '/api/health') {
          httpUtils.sendJson(res, 423, {
            ok: false,
            error: 'LICENSE_REQUIRED',
          });
          return;
        }
      }

      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        const opaqueApiRequest = req.headers.origin === 'null' && requestUrl.pathname.startsWith('/api/');
        if (!opaqueApiRequest && !httpUtils.validateOrigin(req, [baseUrl])) {
          httpUtils.sendJson(res, 403, {
            ok: false,
            error: 'Origin not allowed.',
          });
          return;
        }
      }

      if (requestUrl.pathname === '/ws') {
        httpUtils.sendJson(res, 400, {
          ok: false,
          error: 'Use a WebSocket client for /ws.',
        });
        return;
      }

      if (requestUrl.pathname.startsWith('/api/')) {
        await inflightTracker.run(() => apiRoutes.handleApi(createApiContext(), req, res, requestUrl));
        return;
      }

      if (requestUrl.pathname.startsWith('/opening-media/')) {
        httpUtils.serveOpeningMedia(dataDir, req, res, requestUrl, () => getSettings()?.openingAudioFile || '');
        return;
      }

      if (requestUrl.pathname.startsWith('/opening-character/')) {
        httpUtils.serveOpeningCharacter(dataDir, req, res, requestUrl, () => getSettings()?.openingCharacterFile || '');
        return;
      }

      if (requestUrl.pathname.startsWith('/overtime-gift-images/')) {
        httpUtils.serveOvertimeGiftImage(dataDir, req, res, requestUrl);
        return;
      }

      servePageOrAsset(req, res, requestUrl);
    } catch (error) {
      if (error?.code === 'SERVER_QUIESCING' || getPhase() !== 'ready') {
        if (!res.headersSent) serviceUnavailable(res);
        return;
      }

      console.error(
        '[Server] Request error:',
        redactCredentials({
          method: req.method,
          path: requestPath,
          error: error.message,
          stack: error.stack,
        }),
      );

      if (!res.headersSent) httpUtils.sendStableError(res, error);
    }
  });

  server.on('upgrade', (req, socket) => {
    if (getPhase() !== 'ready') {
      rejectUpgrade(socket, '503 Service Unavailable');
      return;
    }
    const baseUrl = `http://${host}:${getStartedPort() || startPort}`;
    if (!httpUtils.validateRequestHost(req, baseUrl)) {
      rejectUpgrade(socket, '400 Bad Request');
      return;
    }
    let requestUrl;
    try {
      requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${startPort}`}`);
    } catch (_) {
      rejectUpgrade(socket, '400 Bad Request');
      return;
    }
    if (requestUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isLicenseAuthorized()) {
      rejectUpgrade(socket, '423 Locked');
      return;
    }
    getWebSocketHub().handleUpgrade(getWebSocketContext(baseUrl), req, socket);
  });

  return server;
}

module.exports = { createHttpServer };
