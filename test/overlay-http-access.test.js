'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createHttpServer } = require('../src/server/http-server');
const { servePageOrAsset } = require('../src/server/http-utils');
const { OVERLAY_PAGES, createOverlayToken, resolveRequestPrincipal } = require('../src/server/access-policy');

const ADMIN = 'synthetic-private-management-credential';
const SECRET = 'PRIVATE-SENTINEL';
const publicDir = path.resolve(__dirname, '../public');

test('page credentials are independent, revocable and fail closed', () => {
  const url = new URL('http://127.0.0.1/api/state');
  const tokens = new Set();
  for (const scope of Object.keys(OVERLAY_PAGES)) {
    const token = createOverlayToken(ADMIN, scope);
    tokens.add(token);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const principal = resolveRequestPrincipal({ sessionToken: ADMIN }, req, url);
    assert.deepEqual(principal, { type: 'overlay', scope });
    assert.ok(Object.isFrozen(principal));
    assert.equal(resolveRequestPrincipal({ sessionToken: 'rotated' }, req, url), null);
    assert.equal(resolveRequestPrincipal({}, req, url), null);
    const forged = token.replace(`:${scope}:`, ':settings:');
    assert.equal(resolveRequestPrincipal({ sessionToken: ADMIN }, { headers: { authorization: `Bearer ${forged}` } }, url), null);
  }
  assert.equal(tokens.size, 13);
  assert.throws(() => createOverlayToken(ADMIN, 'admin'));
  assert.throws(() => createOverlayToken('', 'lyrics'));
  url.searchParams.set('token', ADMIN);
  assert.equal(resolveRequestPrincipal({ sessionToken: ADMIN }, { headers: { authorization: 'Bearer invalid' } }, url), null);
  assert.equal(resolveRequestPrincipal({ sessionToken: ADMIN }, { headers: { authorization: '' } }, url), null);
  assert.deepEqual(resolveRequestPrincipal({ sessionToken: ADMIN }, { headers: {} }, url), { type: 'admin' });
  const lyrics = createOverlayToken(ADMIN, 'lyrics');
  assert.equal(resolveRequestPrincipal({ sessionToken: ADMIN }, { headers: { authorization: `Bearer ${lyrics.replace(':lyrics:', ':queue:')}` } }, url), null);
});

async function fixture(t) {
  let boots = 0;
  const calls = [];
  const game = { game: 'number-bomb', state: { min: 1, max: 100, bomb: SECRET } };
  const state = {
    settings: { aiApiKey: SECRET, musicPath: SECRET, clockLabel: 'Clock' },
    private: SECRET, queue: { current: { song_name: 'Song', mediaPath: SECRET }, waiting: [] },
    lyricState: { lineText: 'Lyric', mediaPath: SECRET }, gifts: { viewRevision: 'revision', sourceId: SECRET },
  };
  const context = {
    sessionToken: ADMIN, maxBodyBytes: 256,
    system: { getState: () => state }, settings: { get: () => state.settings },
    songs: { list: (input) => { calls.push(['songs', input]); return [{ id: 1, name: 'Song', filePath: SECRET }]; } },
    gifts: {
      getBlindBoxStats: () => ({ summary: { boxCount: 1 }, secret: SECRET }),
      getHistory: (input) => { calls.push(['history', input]); return { items: [], viewRevision: 'revision', sourceId: SECRET }; },
    },
    giftCards: { getProfiles: async (viewRevision) => {
      calls.push(['card-profiles', viewRevision]);
      return { viewRevision: 'revision', day: '2026-09-19', partial: false, secret: SECRET,
        items: [{ eventId: 'one', senderId: '123', userName: '观众', guardLevel: 2, avatarUrl: null, createdAt: '2026-09-19T01:00:00Z', private: SECRET }] };
    } },
    overtime: { getGlobalGiftCatalog: () => ({ gifts: [{ id: 1, name: 'Gift', private: SECRET }] }) },
    bilibili: { fetchAvatarImage: async () => ({ data: Buffer.from('image'), contentType: 'image/png' }) },
    games: {
      getSession: () => game, getWinnerProfile: async () => ({ avatarUrl: 'https://example.test/avatar', private: SECRET }),
      stop: () => calls.push(['stop']), restart: () => { calls.push(['restart']); return game; },
      move: (input, role) => { calls.push(['move', input, role]); return { accepted: true, session: game }; },
      draw: (input) => { calls.push(['draw', input]); return { accepted: true, revision: 1, secret: SECRET }; },
    },
    wheel: {
      getState: () => ({ entries: [{ label: 'One', weight: 1 }], secret: SECRET }),
      spin: () => { calls.push(['spin']); return { spin: { id: 'spin', index: 0 }, secret: SECRET }; },
    },
  };
  const server = createHttpServer({
    host: '127.0.0.1', startPort: 0, getPhase: () => 'ready',
    getStartedPort: () => server.address()?.port, isLicenseAuthorized: () => true,
    inflightTracker: { run: (fn) => fn() }, createApiContext: () => context,
    getSettings: () => state.settings,
    servePageOrAsset: (req, res, url) => servePageOrAsset(publicDir, req, res, url, ADMIN,
      () => ({ generation: ++boots, writerId: 'synthetic-writer' })),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (pathname, token, options = {}) => fetch(`${base}${pathname}`, {
    ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  return { request, calls, boots: () => boots, state, context };
}

test('anonymous canonical and raw overlay HTML contains only its own capability and is isolated', async (t) => {
  const f = await fixture(t);
  for (const [scope, file] of Object.entries(OVERLAY_PAGES)) {
    for (const pathname of [`/${scope}`, `/pages/overlays/${file}`]) {
      const response = await f.request(pathname);
      const html = await response.text();
      assert.equal(response.status, 200, pathname);
      assert.equal(response.headers.get('content-security-policy'), 'sandbox allow-scripts', pathname);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal(html.includes(ADMIN), false);
      assert.ok(html.includes(createOverlayToken(ADMIN, scope)), pathname);
      assert.equal(html.includes('__PLAYBACK_SNAPSHOT_WRITER__'), false);
    }
  }
  for (const pathname of ['/', '/admin', '/settings', '/songs', '/pages/admin/shell-start.html', '/pages/admin/toolbox/settings.html']) {
    assert.equal((await f.request(pathname)).status, 401, pathname);
    assert.equal((await f.request(pathname, createOverlayToken(ADMIN, 'clock'))).status, 401, pathname);
  }
  assert.equal(f.boots(), 0);
  // NTFS alternate data streams otherwise read HTML under a non-HTML suffix.
  for (const pathname of ['/pages/admin/shell-start.html::$DATA', '/pages/overlays/clock.html::$data']) {
    assert.equal((await f.request(pathname)).status, 403, pathname);
  }
  const admin = await f.request('/admin', ADMIN);
  const html = await admin.text();
  assert.equal(admin.status, 200);
  assert.equal(html.includes(ADMIN), false);
  assert.equal(html.includes('lira-overlay-bootstrap'), false);
  assert.equal(html.includes('__PLAYBACK_SNAPSHOT_WRITER__'), true);
  assert.equal((await f.request('/admin', ADMIN, { method: 'HEAD' })).status, 200);
  assert.equal(f.boots(), 1);
  assert.equal((await f.request('/clock', undefined, { method: 'HEAD' })).status, 200);
  assert.equal((await f.request('/license')).status, 200);
  const script = await f.request('/js/overlays/clock.js');
  assert.equal(script.headers.get('access-control-allow-origin'), '*');
});

test('each overlay REST capability rejects management and other page routes, including opaque origins', async (t) => {
  const f = await fixture(t);
  for (const scope of Object.keys(OVERLAY_PAGES)) {
    const token = createOverlayToken(ADMIN, scope);
    const response = await f.request('/api/state', token, { headers: { Origin: 'null' } });
    assert.equal(response.status, 200, scope);
    assert.equal(response.headers.get('access-control-allow-origin'), 'null');
    assert.equal((await response.text()).includes(SECRET), false, scope);
    for (const pathname of ['/api/settings', '/api/games/host-state', '/api/games/viewers', '/api/gifts/selection', '/api/metrics']) {
      assert.equal((await f.request(pathname, token)).status, 403, `${scope} ${pathname}`);
    }
    if (scope !== 'wheel') assert.equal((await f.request('/api/wheel', token)).status, 403, scope);
    if (scope !== 'clock') assert.equal((await f.request('/api/clock/config', token)).status, 403, scope);
    if (scope !== 'games') assert.equal((await f.request('/api/games/session', token)).status, 403, scope);
  }
  assert.equal((await f.request('/api/state')).status, 401);
  assert.equal((await f.request('/api/clock/config')).status, 401);
  const admin = await f.request('/api/state', ADMIN);
  assert.equal((await admin.json()).data.private, SECRET);
  for (const pathname of ['/api/state', '/api/settings']) {
    assert.equal((await f.request(pathname, ADMIN, { headers: { Origin: 'null' } })).status, 403);
  }
  const expired = await f.request('/api/state', createOverlayToken('previous-runtime', 'lyrics'), { headers: { Origin: 'null' } });
  assert.equal(expired.status, 401);
  assert.equal(expired.headers.get('access-control-allow-origin'), 'null');
  const preflight = await f.request('/api/games/session/move', undefined, {
    method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  const denied = await f.request('/api/settings', undefined, {
    method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('allowed read APIs project data and force song visibility and today-only gift history', async (t) => {
  const f = await fixture(t);
  for (const [scope, pathname] of [
    ['songlist', '/api/songs?enabledOnly=false&category=Pop'],
    ['blindbox', '/api/gifts/blind-box-stats'],
    ['gift-feed', '/api/gifts/history?range=all&startDate=2000-01-01&sourceId=other&limit=999&userQuery=private&sortDirection=desc'],
    ['gift-feed', '/api/gifts/display-settings'], ['gift-feed', '/api/overtime/gifts/catalog'],
    ['gift-feed', '/api/gifts/card-profiles?viewRevision=revision&sourceId=other&day=2000-01-01'],
    ['games', '/api/games/session'], ['games', '/api/games/winner-profile'],
    ['wheel', '/api/wheel'], ['clock', '/api/clock/config'], ['opening', '/api/opening/config'],
  ]) {
    const response = await f.request(pathname, createOverlayToken(ADMIN, scope));
    assert.equal(response.status, 200, pathname);
    assert.equal((await response.text()).includes(SECRET), false, pathname);
  }
  assert.deepEqual(f.calls.find(([name]) => name === 'songs')[1], { enabledOnly: true, categories: ['Pop'] });
  const history = f.calls.find(([name]) => name === 'history')[1];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  assert.deepEqual(history, { range: 'today', startDate: today, endDate: today, limit: 100, sortField: 'created_at', sortDirection: 'asc', cursor: null });
  assert.deepEqual(f.calls.find(([name]) => name === 'card-profiles'), ['card-profiles', 'revision']);
  const config = await (await f.request('/api/gifts/display-settings', createOverlayToken(ADMIN, 'gift-feed'))).json();
  assert.equal(config.data.scrollSpeed, 1);
  assert.equal(Object.hasOwn(config.data, 'paused'), false);
  assert.equal((await f.request('/api/gifts/card-profiles', createOverlayToken(ADMIN, 'gift-export'))).status, 403);
  const avatar = await f.request('/api/bilibili/avatar?url=https://example.test/image', createOverlayToken(ADMIN, 'gift-export'));
  assert.equal(avatar.status, 200);
  assert.equal(await avatar.text(), 'image');
});

test('game and wheel display controls cannot start/configure games or invoke host answer actions', async (t) => {
  const f = await fixture(t);
  const token = createOverlayToken(ADMIN, 'games');
  const post = (pathname, body, credential = token, origin = 'null') => f.request(pathname, credential, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
  for (const action of ['stop', 'restart']) assert.equal((await post('/api/games/session', { action })).status, 200);
  for (const action of ['start', 'reveal-answer', undefined]) {
    assert.equal((await post('/api/games/session', { action, game: 'number-bomb' })).status, 403);
  }
  for (const value of [42, 'H8']) assert.equal((await post('/api/games/session/move', { value, role: 'admin' })).status, 200);
  for (const action of ['finish-round', 'reveal-answer', 'next-round']) {
    assert.equal((await post('/api/games/session/move', { value: { action } })).status, 403);
    assert.equal((await post('/api/games/session/draw', { action })).status, 403);
  }
  assert.equal(f.calls.filter(([name]) => name === 'move').length, 2);
  for (const action of ['append', 'undo', 'clear']) {
    assert.equal((await post('/api/games/session/draw', { action, clientId: 'canvas', points: [{ x: 1, y: 1 }] })).status, 200);
  }
  const wheel = createOverlayToken(ADMIN, 'wheel');
  assert.equal((await post('/api/wheel/spin', {}, wheel)).status, 200);
  assert.equal((await post('/api/wheel/config', {}, wheel)).status, 403);
  assert.equal((await post('/api/wheel/spin', {}, token)).status, 403);
  f.context.games.restart = () => { throw Object.assign(new Error('internal details'), { statusCode: 409 }); };
  const busy = await post('/api/games/session', { action: 'restart' });
  assert.equal(busy.status, 409);
  assert.equal((await busy.text()).includes('internal details'), false);
  assert.equal((await post('/api/games/session/move', { value: 42 }, token, 'https://foreign.test')).status, 403);
  assert.equal((await post('/api/games/session/draw', { action: 'append', points: 'x'.repeat(300) })).status, 413);
});
