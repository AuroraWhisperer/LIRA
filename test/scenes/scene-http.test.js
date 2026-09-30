'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createCipheriv, createDecipheriv, randomBytes, randomUUID } = require('node:crypto');
const { createSceneStore } = require('../../src/storage/scene-store');
const { migrateScenes } = require('../../src/storage/scene-migration');
const { createSceneService } = require('../../src/scenes/scene-service');
const { createSceneComponentPorts } = require('../../src/server/scene-components');
const { createHttpServer } = require('../../src/server/http-server');
const { servePageOrAsset } = require('../../src/server/http-utils');
const { createWebSocketHub } = require('../../src/server/ws');
const { createOverlayToken, resolveRequestPrincipal } = require('../../src/server/access-policy');

const ADMIN = 'scene-http-synthetic-admin-credential';
const PRIVATE = 'SCENE-HTTP-PRIVATE-SENTINEL';
const PUBLIC_DIRECTORY = path.resolve(__dirname, '../../public');

function secretCodec() {
  const key = randomBytes(32);
  return {
    isAvailable: () => true,
    encrypt(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64');
    },
    decrypt(value) {
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  migrateScenes(db);
  const state = { owner: { scope: 'https://server.test/streamer-a', epoch: 1 }, licensed: true };
  const display = {
    settings: { clockLabel: 'HTTP clock', aiApiKey: PRIVATE },
    queue: { current: { song_name: 'Public song', filePath: PRIVATE }, waiting: [] },
    secret: PRIVATE,
  };
  const service = createSceneService({
    store: createSceneStore(db), getOwner: () => state.owner, secretCodec: secretCodec(),
    ...createSceneComponentPorts({ getState: () => display, cloud: { getSnapshot: () => ({ events: [] }) } }),
  });
  const context = {
    sessionToken: ADMIN, scenes: service, maxBodyBytes: 300 * 1024,
    system: { getState: () => display }, settings: { get: () => display.settings },
  };
  const hub = createWebSocketHub({ closeTimeoutMs: 20 });
  const connections = new Set();
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0,
    getStartedPort: () => server.address()?.port,
    getPhase: () => 'ready', isLicenseAuthorized: () => state.licensed,
    inflightTracker: { run: (work) => work() }, createApiContext: () => context,
    getSettings: () => display.settings,
    servePageOrAsset: (req, res, url) => servePageOrAsset(PUBLIC_DIRECTORY, req, res, url, ADMIN),
    getWebSocketHub: () => hub,
    getWebSocketContext: (base) => ({ sessionToken: ADMIN, allowedOrigins: [base], getState: () => display }),
  });
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  t.after(async () => {
    hub.stop();
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { token, method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${base}${route}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text,
      body: text && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
  }
  function upgrade(route, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(`${base}${route}`, { headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'), ...headers,
      } });
      req.setTimeout(5000, () => req.destroy(new Error('Synthetic WebSocket handshake timed out')));
      req.once('error', reject);
      req.once('response', (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      req.once('upgrade', (response, socket) => {
        socket.destroy();
        resolve(response.statusCode);
      });
      req.end();
    });
  }
  function publishedScene() {
    const created = service.create({ title: 'HTTP scene', canvas: { width: 1920, height: 1080 } });
    service.publish({ id: created.document.id, expectedRevision: created.revision });
    return { ...created, source: service.getSource(created.document.id) };
  }
  return { request, upgrade, service, state, context, base, publishedScene };
}

function assertNoStore(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

function outputRoute(id, suffix = '') {
  return `/api/scene/output?id=${id}${suffix}`;
}

test('admin HTTP operations create, save, publish and explicitly disclose or rotate a source', async (t) => {
  const fixtureState = await fixture(t);
  const { request } = fixtureState;
  const call = async (route, options = {}) => {
    const response = await request(route, { token: ADMIN, ...options });
    assert.equal(response.status, 200, route);
    assertNoStore(response);
    assert.equal(response.body.ok, true);
    return response.body.data;
  };
  const created = await call('/api/scenes/create', { method: 'POST', body: { title: 'HTTP draft', canvas: { width: 1920, height: 1080 } } });
  const id = created.document.id;
  assert.deepEqual(await call('/api/scenes/list'), [created]);
  assert.deepEqual(await call(`/api/scenes/document?id=${id}`), created);
  const source = await call(`/api/scenes/source?id=${id}`);
  assert.match(source.token, /^[0-9a-f]{64}$/);
  const nextDocument = { ...created.document, items: [{
    id: randomUUID(), type: 'queue', name: 'Queue', x: 0, y: 0, width: 640, height: 480,
    visible: true, locked: false, appearance: { mode: 'shared' },
  }] };
  const saved = await call('/api/scenes/save', { method: 'POST', body: { id, expectedRevision: 1, document: nextDocument } });
  assert.equal(saved.revision, 2);
  const published = await call('/api/scenes/publish', { method: 'POST', body: { id, expectedRevision: 2 } });
  assert.equal(published.publishedVersion, 1);
  assert.equal(published.revision, 2);
  assert.equal(published.document.items[0].appearance.mode, 'shared');
  const output = await request(outputRoute(id), { token: source.token });
  assert.equal(output.status, 200);
  assert.equal(output.body.data.document.items[0].appearance.mode, 'independent');
  assert.equal(output.body.data.data.queue.queue.current.song_name, 'Public song');
  const latest = await request(outputRoute(id, '&version=1&epoch=previous&cursor=3'), { token: source.token });
  assert.equal(latest.status, 200);
  assert.equal(latest.body.data.document, null);
  assert.ok(latest.body.data.data.queue);
  for (const value of [created, saved, published, output.body]) {
    assert.doesNotMatch(JSON.stringify(value), /capability|encrypted|SCENE-HTTP-PRIVATE-SENTINEL/);
    assert.equal(JSON.stringify(value).includes(source.token), false);
  }
  const rotated = await call('/api/scenes/rotate', { method: 'POST', body: { id } });
  assert.notEqual(rotated.token, source.token);
  assert.equal((await request(outputRoute(id), { token: source.token })).status, 403);
  assert.equal((await request(outputRoute(id), { token: rotated.token })).status, 200);
});

test('every management route requires an admin principal and rejects opaque admin origins', async (t) => {
  const { request, publishedScene } = await fixture(t);
  const scene = publishedScene();
  const id = scene.document.id;
  const routes = [
    ['/api/scenes/list', 'GET'], [`/api/scenes/document?id=${id}`, 'GET'], [`/api/scenes/source?id=${id}`, 'GET'],
    ['/api/scenes/create', 'POST'], ['/api/scenes/save', 'POST'], ['/api/scenes/publish', 'POST'], ['/api/scenes/rotate', 'POST'],
    ['/api/scenes/validate', 'POST'],
  ];
  for (const [route, method] of routes) {
    for (const [token, expected] of [[undefined, 401], [scene.source.token, 401], ['forged', 401], [createOverlayToken(ADMIN, 'clock'), 403]]) {
      const response = await request(route, { token, method, ...(method === 'POST' ? { body: { id, expectedRevision: 1 } } : {}) });
      assert.equal(response.status, expected, `${method} ${route}`);
      assertNoStore(response);
      assert.equal(response.text.includes(scene.source.token), false);
    }
    const opaque = await request(route, { token: ADMIN, method, headers: { Origin: 'null' },
      ...(method === 'POST' ? { body: { id } } : {}) });
    assert.equal(opaque.status, 403, route);
    assert.equal(opaque.headers.get('access-control-allow-origin'), null);
  }
});

test('scene capability never becomes a common HTTP principal or authorizes an admin URL fallback', async (t) => {
  const { request, context, base, publishedScene } = await fixture(t);
  const { token } = publishedScene().source;
  assert.equal(resolveRequestPrincipal(context, { headers: { authorization: `Bearer ${token}` } }, new URL(`${base}/api/state`)), null);
  assert.equal(resolveRequestPrincipal(context, { headers: {} }, new URL(`${base}/api/state?token=${token}`)), null);
  for (const route of ['/api/state', '/api/settings', '/api/scenes/list', '/admin']) {
    assert.equal((await request(route, { token })).status, 401, route);
    assert.equal((await request(`${route}?token=${token}`)).status, 401, route);
    assert.equal((await request(`${route}?token=${ADMIN}`, { token })).status, 401, route);
  }
});

test('only exact output GET accepts the matching scene Bearer; query, admin and overlay credentials do not', async (t) => {
  const { request, publishedScene } = await fixture(t);
  const { id, token } = publishedScene().source;
  assert.equal((await request(outputRoute(id), { token })).status, 200);
  for (const candidate of [undefined, ADMIN, createOverlayToken(ADMIN, 'clock'), 'invalid']) {
    const denied = await request(outputRoute(id), { token: candidate, headers: { Origin: 'null' } });
    assert.equal(denied.status, 403);
    assertNoStore(denied);
  }
  assert.equal((await request(outputRoute(id, `&token=${token}`))).status, 403);
  assert.equal((await request(outputRoute(id, `&token=${token}`), { token: ADMIN })).status, 403);
  for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const denied = await request(outputRoute(id), { token, method, headers: { Origin: 'null' } });
    assert.equal(denied.status, 405, method);
    assertNoStore(denied);
  }
  for (const route of ['/api/scene/output/', '/api/scene/output-extra', '/api/scenes/output', '/api/scene/Output', '/api/scene/%6futput']) {
    assert.equal((await request(`${route}?id=${id}`, { token })).status, 401, route);
  }
});

test('HTTP scene output rejects cross-scene access, previous rotation, owner changes and logout', async (t) => {
  const { request, publishedScene, state } = await fixture(t);
  const first = publishedScene().source;
  const second = publishedScene().source;
  assert.equal((await request(outputRoute(second.id), { token: first.token })).status, 403);
  const rotation = await request('/api/scenes/rotate', { token: ADMIN, method: 'POST', body: { id: first.id } });
  assert.equal(rotation.status, 200);
  assert.equal((await request(outputRoute(first.id), { token: first.token })).status, 403);
  const source = rotation.body.data;
  assert.equal((await request(outputRoute(source.id), { token: source.token })).status, 200);
  for (const owner of [{ scope: 'https://server.test/streamer-b', epoch: 2 }, { scope: 'https://other.test/streamer-a', epoch: 3 }]) {
    state.owner = owner;
    assert.equal((await request(outputRoute(source.id), { token: source.token })).status, 404);
    assert.deepEqual((await request('/api/scenes/list', { token: ADMIN })).body.data, []);
  }
  state.owner = null;
  assert.equal((await request(outputRoute(source.id), { token: source.token })).status, 403);
  state.owner = { scope: 'https://server.test/streamer-a', epoch: 4 };
  assert.equal((await request(outputRoute(source.id), { token: source.token })).status, 200);
  state.licensed = false;
  const locked = await request(outputRoute(source.id), { token: source.token });
  assert.equal(locked.status, 423);
  assertNoStore(locked);
});

test('opaque preflight permits only exact output GET and Authorization, and never authorizes a read', async (t) => {
  const { request, publishedScene, base } = await fixture(t);
  const { id, token } = publishedScene().source;
  const headers = { Origin: 'null', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' };
  const preflight = await request(outputRoute(id), { method: 'OPTIONS', headers });
  assert.equal(preflight.status, 204);
  assertNoStore(preflight);
  assert.equal(preflight.text, '');
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'null');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Authorization');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  assert.match(preflight.headers.get('vary'), /Origin/);
  for (const changes of [{ Origin: 'https://untrusted.test' }, { 'Access-Control-Request-Method': 'POST' },
    { 'Access-Control-Request-Headers': 'Authorization, X-Admin-Token' }, { 'Access-Control-Request-Headers': 'Content-Type' }]) {
    assert.equal((await request(outputRoute(id), { method: 'OPTIONS', headers: { ...headers, ...changes } })).status, 403);
  }
  for (const route of ['/api/scenes/list', '/api/scenes/publish', '/api/scene/output/']) {
    const denied = await request(route, { method: 'OPTIONS', headers });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  const anonymous = await request(outputRoute(id), { headers: { Origin: 'null' } });
  assert.equal(anonymous.status, 403);
  const allowed = await request(outputRoute(id), { token, headers: { Origin: 'null' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'null');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
  const external = await request(outputRoute(id), { token, headers: { Origin: 'https://untrusted.test' } });
  assert.equal(external.headers.get('access-control-allow-origin'), null);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(`${base}${outputRoute(id)}`, {
      headers: { Host: 'untrusted.test', Authorization: `Bearer ${token}` },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    req.setTimeout(5000, () => req.destroy(new Error('Synthetic Host check timed out')));
    req.once('error', reject);
  });
  assert.equal(invalidHostStatus, 400);
});

test('real WebSocket upgrade rejects scene tokens in headers and query while old principals still work', async (t) => {
  const { upgrade, publishedScene, base } = await fixture(t);
  const { token } = publishedScene().source;
  for (const headers of [{}, { Origin: 'null' }, { Origin: base }]) {
    assert.equal(await upgrade('/ws', { ...headers, Authorization: `Bearer ${token}` }), 401);
    assert.equal(await upgrade(`/ws?token=${token}&type=admin&scope=clock`, headers), 401);
  }
  assert.equal(await upgrade(`/ws?token=${ADMIN}`, { Authorization: `Bearer ${token}` }), 401);
  assert.equal(await upgrade('/ws', { Authorization: `Bearer ${ADMIN}`, Origin: base }), 101);
  const overlay = createOverlayToken(ADMIN, 'clock');
  assert.equal(await upgrade(`/ws?token=${overlay}`, { Origin: 'null' }), 101);
  assert.equal(await upgrade('/ws', { Authorization: `Bearer ${ADMIN}`, Origin: 'null' }), 403);
});

test('scene shell is anonymous, credential free and sandboxed on canonical and raw paths', async (t) => {
  const { request, publishedScene } = await fixture(t);
  const { id, token } = publishedScene().source;
  for (const route of [`/scene?id=${id}#token=${token}`, `/pages/overlays/scene.html?id=${id}#token=${token}`]) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assertNoStore(response);
    assert.equal(response.headers.get('content-security-policy'), 'sandbox allow-scripts');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.doesNotMatch(response.text, /__API_TOKEN__|lira-overlay-bootstrap|__PLAYBACK_SNAPSHOT_WRITER__/);
    assert.equal(response.text.includes(ADMIN), false);
    assert.equal(response.text.includes(token), false);
    assert.match(response.text, /src="\/js\/overlays\/scene\.js"/);
    assert.match(response.text, /name="referrer" content="no-referrer"/);
  }
  const head = await request('/scene', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(head.headers.get('content-security-policy'), 'sandbox allow-scripts');
});

test('preview and scene child pages never receive standalone credentials; ordinary overlays retain compatibility', async (t) => {
  const { request } = await fixture(t);
  for (const type of ['danmaku', 'clock', 'queue', 'overtime']) {
    const overlay = createOverlayToken(ADMIN, type);
    for (const route of [`/${type}`, `/pages/overlays/${type}.html`]) {
      for (const flags of ['componentPreview=1', 'componentPreview=1&sceneComponent=1']) {
        const preview = await request(`${route}?${flags}`);
        assert.equal(preview.status, 200);
        assert.equal(preview.headers.get('content-security-policy'), 'sandbox allow-scripts');
        assert.doesNotMatch(preview.text, /__API_TOKEN__|lira-overlay-bootstrap/);
        assert.equal(preview.text.includes(ADMIN), false);
        assert.equal(preview.text.includes(overlay), false);
      }
      const standalone = await request(route);
      assert.equal(standalone.status, 200);
      assert.equal(standalone.headers.get('content-security-policy'), 'sandbox allow-scripts');
      assert.ok(standalone.text.includes(overlay));
      assert.equal(standalone.text.includes(ADMIN), false);
    }
    const oldApi = await request('/api/state', { token: overlay, headers: { Origin: 'null' } });
    assert.equal(oldApi.status, 200);
    assert.equal(oldApi.headers.get('access-control-allow-origin'), 'null');
    assert.equal(oldApi.text.includes(PRIVATE), false);
  }
});

test('HTTP optimistic conflicts and invalid documents preserve prior output without exposing store details', async (t) => {
  const { request, publishedScene } = await fixture(t);
  const scene = publishedScene();
  const id = scene.document.id;
  const before = await request(outputRoute(id), { token: scene.source.token });
  const changed = { ...scene.document, title: 'new draft' };
  const saved = await request('/api/scenes/save', { token: ADMIN, method: 'POST', body: { id, expectedRevision: 1, document: changed } });
  assert.equal(saved.status, 200);
  for (const route of ['/api/scenes/save', '/api/scenes/publish']) {
    const response = await request(route, { token: ADMIN, method: 'POST', body: { id, expectedRevision: 1, document: scene.document } });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'SCENE_CONFLICT');
    assertNoStore(response);
    assert.doesNotMatch(response.text, /SELECT|sqlite|capability_hash|encrypted/);
  }
  const invalid = await request('/api/scenes/save', { token: ADMIN, method: 'POST',
    body: { id, expectedRevision: 2, document: { ...changed, token: 'must not persist' } } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'SCENE_INVALID_DOCUMENT');
  const after = await request(outputRoute(id), { token: scene.source.token });
  assert.deepEqual(after.body, before.body);
});

test('template validation checks component configurations before any scene is created or changed', async (t) => {
  const { request, service, publishedScene } = await fixture(t);
  const scene = publishedScene();
  const before = service.list();
  const invalid = structuredClone(scene.document);
  invalid.items.push({ id: randomUUID(), type: 'clock', name: 'Invalid clock', x: 0, y: 0,
    width: 200, height: 100, visible: true, locked: false,
    appearance: { mode: 'independent', config: { style: 'not-a-clock' } } });
  const rejected = await request('/api/scenes/validate', { token: ADMIN, method: 'POST', body: { document: invalid } });
  assert.equal(rejected.status, 400);
  const accepted = await request('/api/scenes/validate', { token: ADMIN, method: 'POST', body: { document: scene.document } });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body.data, scene.document);
  assert.deepEqual(service.list(), before);
});
