'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const OVERLAY_PAGES = Object.freeze({
  queue: 'queue.html',
  songlist: 'songs.html',
  blindbox: 'blindbox.html',
  overtime: 'overtime.html',
  'gift-effects': 'gift-effects.html',
  'gift-feed': 'gift-feed.html',
  'gift-export': 'gift-export.html',
  lyrics: 'lyric-window.html',
  games: 'games.html',
  danmaku: 'danmaku.html',
  wheel: 'wheel.html',
  opening: 'opening.html',
  clock: 'clock.html',
});

const OVERLAY_ROUTES = {
  songlist: ['GET /api/songs'],
  blindbox: ['GET /api/gifts/blind-box-stats'],
  'gift-feed': [
    'GET /api/gifts/display-settings', 'GET /api/gifts/history',
    'GET /api/overtime/gifts/catalog', 'GET /api/bilibili/avatar',
  ],
  'gift-export': ['GET /api/bilibili/avatar'],
  games: [
    'GET /api/games/session', 'GET /api/games/winner-profile',
    'GET /api/bilibili/avatar', 'POST /api/games/session',
    'POST /api/games/session/move', 'POST /api/games/session/draw',
  ],
  danmaku: ['GET /api/bilibili/avatar'],
  wheel: ['GET /api/wheel', 'POST /api/wheel/spin'],
  opening: ['GET /api/opening/config'],
  clock: ['GET /api/clock/config'],
};

function hasScope(scope) {
  return Object.hasOwn(OVERLAY_PAGES, scope);
}

function getOverlayScope(pathname) {
  for (const [scope, file] of Object.entries(OVERLAY_PAGES)) {
    if (pathname === `/${scope}` || pathname === `/pages/overlays/${file}`) return scope;
  }
  return null;
}

function createOverlayToken(sessionToken, scope) {
  if (typeof sessionToken !== 'string' || !sessionToken || !hasScope(scope)) {
    throw new Error('Overlay credentials require a runtime key and known scope.');
  }
  const signature = createHmac('sha256', sessionToken)
    .update(`lira-overlay:v1:${scope}`).digest('hex');
  return `ov1:${scope}:${signature}`;
}

function equalToken(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function resolveRequestPrincipal(context, req, requestUrl) {
  const sessionToken = context?.sessionToken;
  if (typeof sessionToken !== 'string' || !sessionToken) return null;
  const authorization = req.headers?.authorization;
  // An explicit invalid credential must not fall back to a query credential.
  const token = authorization !== undefined
    ? (typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice(7) : '')
    : requestUrl.searchParams.get('token');
  if (typeof token !== 'string' || !token) return null;
  if (equalToken(token, sessionToken)) return Object.freeze({ type: 'admin' });
  const match = /^ov1:([a-z-]+):[a-f0-9]{64}$/.exec(token);
  if (!match || !hasScope(match[1])) return null;
  const scope = match[1];
  return equalToken(token, createOverlayToken(sessionToken, scope))
    ? Object.freeze({ type: 'overlay', scope }) : null;
}

function isOverlayRequestAllowed(scope, method, pathname) {
  if (!hasScope(scope)) return false;
  if (method === 'GET' && pathname === '/api/state') return true;
  return OVERLAY_ROUTES[scope]?.includes(`${method} ${pathname}`) || false;
}

function isOverlayRoute(method, pathname) {
  return Object.keys(OVERLAY_PAGES).some((scope) => isOverlayRequestAllowed(scope, method, pathname));
}

module.exports = {
  OVERLAY_PAGES,
  getOverlayScope,
  createOverlayToken,
  resolveRequestPrincipal,
  isOverlayRequestAllowed,
  isOverlayRoute,
};
