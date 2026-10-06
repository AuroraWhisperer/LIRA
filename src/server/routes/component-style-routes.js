'use strict';

const { readJsonBody, sendJson, validateOrigin } = require('../http-utils');
const { resolveRequestPrincipal } = require('../access-policy');
const { createComponentStyleLibrary } = require('../component-style-library');

async function handleStyles(context, req, res, url, canvas = false) {
  const authorize = () => {
    if (req.aborted || res.destroyed) throw Object.assign(new Error('操作已取消。'), { statusCode: 400 });
    if (canvas) {
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
      context.componentPreviews.authorizeCanvasMedia({ id: url.searchParams.get('id'), attachmentId: url.searchParams.get('attachmentId') }, token);
    } else if (resolveRequestPrincipal(context, req, url)?.type !== 'admin') {
      throw Object.assign(new Error('请从客户端重新打开。'), { statusCode: 403 });
    }
  };
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!validateOrigin(req, [url.origin])) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
    authorize();
    const library = createComponentStyleLibrary(context.system.dataDir);
    const action = url.pathname.split('/').at(-1);
    let data;
    if (action === 'list' && req.method === 'GET') data = library.list();
    else if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '不支持的操作。' });
    else if (action === 'add') {
      const description = JSON.parse(url.searchParams.get('description') || '{}');
      data = await library.add(req, description, authorize);
    } else if (action === 'inspect') data = await library.inspect(req, authorize);
    else {
      const body = await readJsonBody(req, 4096);
      authorize();
      if (!['install', 'remove', 'cancel'].includes(action)) return sendJson(res, 404, { ok: false });
      data = library[action](body?.id);
    }
    return sendJson(res, 200, { ok: true, data });
  } catch (error) {
    const status = [400, 403, 404, 409, 410, 413, 503].includes(error.statusCode) ? error.statusCode : 400;
    return sendJson(res, status, { ok: false, error: error.statusCode ? error.message : '素材或套装无法读取，请检查文件格式与清单。' });
  }
}

const actions = ['list', 'add', 'inspect', 'install', 'remove', 'cancel'];
const routes = Object.fromEntries(actions.map(action => [`${action === 'list' ? 'GET' : 'POST'} /api/component-styles/${action}`,
  (context, request, res) => handleStyles(context, request.req, res, new URL(request.req.url, `http://${request.req.headers.host}`))]));
const publicRoutes = Object.fromEntries(actions.map(action => [`${action === 'list' ? 'GET' : 'POST'} /api/component-preview/styles/${action}`,
  (context, req, res, url) => handleStyles(context, req, res, url, true)]));

module.exports = { prefixes: ['/api/component-styles/'], routes, publicRoutes, handleStyles };
