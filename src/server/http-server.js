'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const httpUtils = require('./http-utils');
const { SERVICE_ID } = require('./lifecycle');
const apiRoutes = require('./api-routes');

/**
 * Build the HTTP/upgrade transport for one server runtime.
 * Domain state stays behind the explicitly supplied callbacks.
 */
function createHttpServer(options = {}) {
  const {
    host,
    startPort,
    rootDir,
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

  const server = http.createServer(async (req, res) => {
    try {
      const phase = getPhase();
      const requestUrl = new URL(
        req.url,
        `http://${req.headers.host || `${host}:${startPort}`}`,
      );

      if (requestUrl.pathname === '/api/health' && phase !== 'ready') {
        httpUtils.sendJson(res, 200, {
          ok: true,
          data: {
            serviceId: SERVICE_ID,
            rootDir,
            dataDir,
            pid: process.pid,
            phase,
          },
        });
        return;
      }

      if (phase !== 'ready') {
        serviceUnavailable(res);
        return;
      }

      const baseUrl = `http://${host}:${getStartedPort() || startPort}`;
      if (!httpUtils.validateRequestHost(req, baseUrl)) {
        httpUtils.sendJson(res, 400, {
          ok: false,
          error: 'Invalid Host header.',
        });
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
        if (
          requestUrl.pathname.startsWith('/api/') &&
          requestUrl.pathname !== '/api/health'
        ) {
          httpUtils.sendJson(res, 423, {
            ok: false,
            error: 'LICENSE_REQUIRED',
          });
          return;
        }
      }

      if (
        req.method !== 'GET' &&
        req.method !== 'HEAD' &&
        req.method !== 'OPTIONS'
      ) {
        if (!httpUtils.validateOrigin(req, [baseUrl])) {
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
        await inflightTracker.run(() =>
          apiRoutes.handleApi(createApiContext(), req, res, requestUrl),
        );
        return;
      }

      if (requestUrl.pathname.startsWith('/opening-media/')) {
        httpUtils.serveOpeningMedia(
          dataDir,
          req,
          res,
          requestUrl,
          () => getSettings()?.openingAudioFile || '',
        );
        return;
      }

      if (requestUrl.pathname.startsWith('/opening-character/')) {
        httpUtils.serveOpeningCharacter(
          dataDir,
          req,
          res,
          requestUrl,
          () => getSettings()?.openingCharacterFile || '',
        );
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

      console.error('[Server] Request error:', {
        method: req.method,
        path: req.url,
        error: error.message,
        stack: error.stack,
      });

      if (!res.headersSent) httpUtils.sendStableError(res, error);
    }
  });

  server.on('upgrade', (req, socket) => {
    if (getPhase() !== 'ready') {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || `${host}:${startPort}`}`,
    );
    if (requestUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isLicenseAuthorized()) {
      socket.end('HTTP/1.1 423 Locked\r\nConnection: close\r\n\r\n');
      return;
    }
    const baseUrl = `http://${host}:${getStartedPort() || startPort}`;
    getWebSocketHub().handleUpgrade(getWebSocketContext(baseUrl), req, socket);
  });

  return server;
}

module.exports = { createHttpServer };
