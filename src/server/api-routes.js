// 编写人：Aurora
// HTTP API 前缀分发。业务状态留在 server.js，通过 context 注入，本模块保持无状态。
'use strict';

const { readJsonBody, sendJson } = require('./http-utils');
const { resolveRequestPrincipal, isOverlayRequestAllowed, isOverlayRoute } = require('./access-policy');
const { handleOverlayApi } = require('./overlay-http');

// 按前缀顺序匹配；每个模块只关心自己领域的路由表
const ROUTE_MODULES = [
  require('./routes/system-routes'),
  require('./routes/settings-routes'),
  require('./routes/clock-routes'),
  require('./routes/opening-routes'),
  require('./routes/wesing-routes'),
  require('./routes/music-routes'),
  require('./routes/playback-routes'),
  require('./routes/theme-routes'),
  require('./routes/song-routes'),
  require('./routes/queue-routes'),
  require('./routes/superchat-routes'),
  require('./routes/gift-routes'),
  require('./routes/overtime-routes'),
  require('./routes/data-routes'),
  require('./routes/ai-routes'),
  require('./routes/game-routes'),
  require('./routes/interaction-routes'),
  require('./routes/dynamic-lottery-routes'),
  require('./routes/bilibili-routes'),
];

function findRoute(pathName, method) {
  let pathExists = false;
  for (const routeModule of ROUTE_MODULES) {
    if (!routeModule.prefixes.some((prefix) => pathName.startsWith(prefix)))
      continue;
    const handler = routeModule.routes[`${method} ${pathName}`];
    if (handler) return { handler };
    // 路径存在但方法不匹配时要回 405，而不是 404
    pathExists =
      pathExists ||
      Object.keys(routeModule.routes).some((key) =>
        key.endsWith(` ${pathName}`),
      );
  }
  return { pathExists };
}

// body 只在路由真正需要时读取一次，避免 GET 请求也等待请求体
function createBodyReader(req, maxBodyBytes) {
  let pending = null;
  return () => {
    if (!pending)
      pending = readJsonBody(req, maxBodyBytes).then((body) => body || {});
    return pending;
  };
}

async function handleApi(context, req, res, requestUrl) {
  const method = req.method || 'GET';
  const pathName = requestUrl.pathname;
  const principal = resolveRequestPrincipal(context, req, requestUrl);
  const origin = req.headers?.origin;
  if (origin === 'null') {
    // Opaque origin is not an identity. Preflight exposes no data; every actual
    // operation below still requires a verified, matching page capability.
    const requestedMethod = method === 'OPTIONS'
      ? req.headers['access-control-request-method'] : method;
    if (!isOverlayRoute(requestedMethod, pathName) || principal?.type === 'admin') {
      return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
    }
    res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('Vary', 'Origin');
    if (method === 'OPTIONS') {
      const headers = String(req.headers['access-control-request-headers'] || '')
        .toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
      if (headers.some((value) => !['authorization', 'content-type'].includes(value))) {
        return sendJson(res, 403, { ok: false, error: 'Request headers not allowed.' });
      }
      res.writeHead(204, {
        'Access-Control-Allow-Methods': requestedMethod,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
  }
  if (!(method === 'GET' && pathName === '/api/health') && !principal) {
    sendJson(res, 401, {
      ok: false,
      error: '未授权访问。请重新打开页面。',
    });
    return;
  }

  const request = {
    method, pathName, query: requestUrl.searchParams, req,
    body: createBodyReader(req, pathName.startsWith('/api/interactions/') ? 16 * 1024 : context.maxBodyBytes),
  };
  if (principal?.type === 'overlay' && pathName !== '/api/health') {
    if (!isOverlayRequestAllowed(principal.scope, method, pathName)) {
      return sendJson(res, 403, { ok: false, error: '该页面无权访问此接口。' });
    }
    return handleOverlayApi(context, principal, request, res);
  }

  const { handler, pathExists } = findRoute(pathName, method);

  if (!handler) {
    if (pathExists) {
      sendJson(res, 405, {
        ok: false,
        error: '请求方法不支持',
        details: `该接口不支持 ${method} 请求`,
      });
    } else {
      sendJson(res, 404, {
        ok: false,
        error: 'API 接口不存在',
        details: `未找到接口：${pathName}`,
      });
    }
    return;
  }

  await handler(context, request, res);
}

module.exports = { handleApi };
