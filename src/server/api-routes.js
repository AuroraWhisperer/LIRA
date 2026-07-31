// 编写人：Aurora
// HTTP API 前缀分发。业务状态留在 server.js，通过 context 注入，本模块保持无状态。
'use strict';

const { readJsonBody, sendJson } = require('./http-utils');

// 按前缀顺序匹配；每个模块只关心自己领域的路由表
const ROUTE_MODULES = [
  require('./routes/system-routes'),
  require('./routes/settings-routes'),
  require('./routes/music-routes'),
  require('./routes/playback-routes'),
  require('./routes/theme-routes'),
  require('./routes/song-routes'),
  require('./routes/queue-routes'),
  require('./routes/superchat-routes'),
  require('./routes/gift-routes'),
  require('./routes/debug-routes'),
  require('./routes/data-routes'),
  require('./routes/bilibili-routes')
];

function findRoute(pathName, method) {
  let pathExists = false;
  for (const routeModule of ROUTE_MODULES) {
    if (!routeModule.prefixes.some((prefix) => pathName.startsWith(prefix))) continue;
    const handler = routeModule.routes[`${method} ${pathName}`];
    if (handler) return { handler };
    // 路径存在但方法不匹配时要回 405，而不是 404
    pathExists = pathExists || Object.keys(routeModule.routes).some((key) => key.endsWith(` ${pathName}`));
  }
  return { pathExists };
}

// body 只在路由真正需要时读取一次，避免 GET 请求也等待请求体
function createBodyReader(req, maxBodyBytes) {
  let pending = null;
  return () => {
    if (!pending) pending = readJsonBody(req, maxBodyBytes).then((body) => body || {});
    return pending;
  };
}

async function handleApi(context, req, res, requestUrl) {
  const method = req.method || 'GET';
  const pathName = requestUrl.pathname;
  const { handler, pathExists } = findRoute(pathName, method);

  if (!handler) {
    if (pathExists) {
      sendJson(res, 405, { ok: false, error: '请求方法不支持', details: `该接口不支持 ${method} 请求` });
    } else {
      sendJson(res, 404, { ok: false, error: 'API 接口不存在', details: `未找到接口：${pathName}` });
    }
    return;
  }

  await handler(context, {
    method,
    pathName,
    query: requestUrl.searchParams,
    body: createBodyReader(req, context.maxBodyBytes)
  }, res);
}

module.exports = { handleApi };
