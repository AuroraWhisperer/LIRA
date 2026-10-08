'use strict';

const { pipeline } = require('node:stream/promises');
const { readJsonBody, sendJson, validateOrigin } = require('../http-utils');
const { resolveRequestPrincipal } = require('../access-policy');
const { createComponentStyleLibrary } = require('../component-style-library');
const { createComponentWebLibrary } = require('../component-web-library');
const { readWebUpload } = require('../component-web-files');

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
    else if (action === 'web') {
      const description = JSON.parse(url.searchParams.get('description') || '{}');
      data = await createComponentWebLibrary(context.system.dataDir).add(readWebUpload(req), description, authorize);
    } else if (action === 'pick-web') {
      const body = await readJsonBody(req, 4096);
      authorize();
      if (!context.system.pickComponentWebFile) return sendJson(res, 503, { ok: false, error: '请使用文件选择或素材文件夹导入。', code: 'FILE_PICKER_UNAVAILABLE' });
      const selected = await context.system.pickComponentWebFile(body?.kind);
      authorize();
      if (selected?.open) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': selected.size,
          'X-Lira-Filename': encodeURIComponent(selected.name) });
        await pipeline(selected.open(), res);
        return;
      }
      data = selected ? await createComponentWebLibrary(context.system.dataDir).add(selected.files, { ...body.description, entry: selected.entry }, authorize) : null;
    } else if (action === 'add') {
      const description = JSON.parse(url.searchParams.get('description') || '{}');
      data = await library.add(req, description, authorize);
    } else if (action === 'inspect') data = await library.inspect(req, authorize);
    else {
      const body = await readJsonBody(req, action === 'config' ? 64 * 1024 : 4096);
      authorize();
      if (!['install', 'remove', 'remove-pack', 'cancel', 'config'].includes(action)) return sendJson(res, 404, { ok: false });
      data = await library[action](action === 'config' ? body : body?.id, authorize);
    }
    if (action === 'config') context.broadcastSnapshot?.('component:styles');
    return sendJson(res, 200, { ok: true, data });
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    const status = [400, 403, 404, 409, 410, 413, 503].includes(error.statusCode) ? error.statusCode : 400;
    return sendJson(res, status, { ok: false, error: error.statusCode ? error.message : '素材或套装无法读取，请检查文件格式与清单。' });
  }
}

const actions = ['list', 'add', 'web', 'pick-web', 'inspect', 'install', 'remove', 'remove-pack', 'cancel', 'config'];
const routes = Object.fromEntries(actions.map(action => [`${action === 'list' ? 'GET' : 'POST'} /api/component-styles/${action}`,
  (context, request, res) => handleStyles(context, request.req, res, new URL(request.req.url, `http://${request.req.headers.host}`))]));
const publicRoutes = Object.fromEntries(actions.map(action => [`${action === 'list' ? 'GET' : 'POST'} /api/component-preview/styles/${action}`,
  (context, req, res, url) => handleStyles(context, req, res, url, true)]));

module.exports = { prefixes: ['/api/component-styles/'], routes, publicRoutes, handleStyles };
