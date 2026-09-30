'use strict';

const { sendJson } = require('../http-utils');

function reply(res, action) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return sendJson(res, 200, { ok: true, data: action() });
  } catch (error) {
    const status = [400, 401, 403, 404, 409, 503].includes(error.statusCode) ? error.statusCode : 500;
    return sendJson(res, status, { ok: false, code: error.code || 'SCENE_UNAVAILABLE',
      error: status === 500 ? '场景暂时不可用，请重试。' : error.message });
  }
}

const prefixes = ['/api/scenes/'];
const routes = {
  async 'POST /api/scenes/validate'(context, request, res) {
    const body = await request.body();
    return reply(res, () => context.scenes.validate(body));
  },
  'GET /api/scenes/list': (context, request, res) => reply(res, () => context.scenes.list()),
  'GET /api/scenes/document': (context, request, res) => reply(res, () => context.scenes.get(request.query.get('id'))),
  'GET /api/scenes/source': (context, request, res) => reply(res, () => context.scenes.getSource(request.query.get('id'))),
  async 'POST /api/scenes/create'(context, request, res) {
    const body = await request.body();
    return reply(res, () => context.scenes.create(body));
  },
  async 'POST /api/scenes/save'(context, request, res) {
    const body = await request.body();
    return reply(res, () => context.scenes.save(body));
  },
  async 'POST /api/scenes/publish'(context, request, res) {
    const body = await request.body();
    return reply(res, () => context.scenes.publish(body));
  },
  async 'POST /api/scenes/rotate'(context, request, res) {
    const body = await request.body();
    return reply(res, () => context.scenes.rotate(body.id));
  },
};

function handleSceneOutput(context, req, res, requestUrl) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (origin === 'null') {
    res.setHeader('Access-Control-Allow-Origin', 'null');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
    if (origin !== 'null' || req.headers['access-control-request-method'] !== 'GET'
      || headers.some((header) => header !== 'authorization')) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization' });
    return res.end();
  }
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: '场景来源只允许读取。' });
  const authorization = req.headers.authorization;
  const token = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return reply(res, () => context.scenes.getOutput({ id: requestUrl.searchParams.get('id'), token,
    version: Number(requestUrl.searchParams.get('version')), epoch: requestUrl.searchParams.get('epoch'),
    cursor: requestUrl.searchParams.get('cursor') }));
}

const publicRoutes = { 'GET /api/scene/output': handleSceneOutput, 'OPTIONS /api/scene/output': handleSceneOutput };

module.exports = { prefixes, routes, publicRoutes, handleSceneOutput };
