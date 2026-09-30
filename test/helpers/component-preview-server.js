'use strict';

const path = require('node:path');
const { createHttpServer } = require('../../src/server/http-server');
const { servePageOrAsset } = require('../../src/server/http-utils');
const { createWebSocketHub } = require('../../src/server/ws');

async function startComponentPreviewServer({ getOwner = () => null, parentHtml, scenes, getState, readDanmakuDisplay } = {}) {
  const token = 'synthetic-desktop-component-preview-token';
  const publicDir = path.resolve(__dirname, '../../public');
  const hub = getState ? createWebSocketHub({ closeTimeoutMs: 20 }) : null;
  const server = createHttpServer({ host: '127.0.0.1', startPort: 0,
    getPhase: () => 'ready', getStartedPort: () => server.address()?.port,
    getPreviewOwner: getOwner, isLicenseAuthorized: () => true,
    inflightTracker: { run: (work) => work() }, createApiContext: () => ({ sessionToken: token, scenes, readDanmakuDisplay,
      system: { getState }, settings: { get: () => getState?.().settings } }),
    getSettings: () => getState?.().settings || {},
    getWebSocketHub: () => hub,
    getWebSocketContext: (base) => ({ sessionToken: token, allowedOrigins: [base], getState }),
    servePageOrAsset: (req, res, url) => {
      if (parentHtml && url.pathname === '/preview-test-host') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(parentHtml);
      } else servePageOrAsset(publicDir, req, res, url, token);
    } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function post(body, bearer = token, headers = {}) {
    const response = await fetch(`${origin}/api/component-preview`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, ...headers },
      body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  }
  return { origin, token, post, broadcast: () => hub?.broadcastSnapshot({ getState }, 'test'), close: () => new Promise((resolve) => {
    hub?.stop();
    server.closeAllConnections();
    server.close(resolve);
  }) };
}

module.exports = { startComponentPreviewServer };
