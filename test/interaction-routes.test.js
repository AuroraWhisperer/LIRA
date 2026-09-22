'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routes } = require('../src/server/routes/interaction-routes');
const { projectOverlayResponse, projectWebSocketPayload } = require('../src/server/overlay-projection');
const { OVERLAY_PAGES, isOverlayRequestAllowed } = require('../src/server/access-policy');

test('interaction routes require session identity and propagate conflict/validation statuses', async () => {
  let status, payload;
  const res = {
    writeHead(value) {
      status = value;
    },
    end(value) {
      payload = JSON.parse(value);
    },
  };
  const context = {
    interactions: {
      finish(id) {
        assert.equal(id, 'old');
        throw Object.assign(new Error('changed'), { statusCode: 409 });
      },
    },
  };
  await routes['POST /api/interactions/session/finish'](context, { body: async () => ({ sessionId: 'old' }) }, res);
  assert.equal(status, 409);
  assert.equal(payload.ok, false);
});

test('interaction projections remove secrets and suppress unrevealed rating even if owner accidentally includes fields', () => {
  const data = {
    runtimeId: 'r',
    revision: 1,
    cookie: 'secret',
    session: {
      kind: 'rating',
      phase: 'collecting',
      average: 8,
      sum: 80,
      participants: 10,
      uid: 'secret',
      options: [{ votes: 10 }],
    },
  };
  const expected = { runtimeId: 'r', revision: 1, session: { kind: 'rating', phase: 'collecting', average: null } };
  assert.deepEqual(projectOverlayResponse('interactions', '/api/interactions/session', data), expected);
  assert.deepEqual(
    projectWebSocketPayload({ type: 'overlay', scope: 'interactions' }, { type: 'interaction:update', state: data }),
    { type: 'interaction:update', state: expected },
  );
  assert.equal(
    projectWebSocketPayload({ type: 'overlay', scope: 'games' }, { type: 'interaction:update', state: data }),
    null,
  );
  assert.equal(projectOverlayResponse('games', '/api/interactions/session', data), null);
  assert.equal(projectOverlayResponse('interactions', '/api/interactions/host-state', data), null);
  assert.deepEqual(
    projectOverlayResponse('interactions', '/api/interactions/session', { runtimeId: 'r', revision: 2, session: null }),
    { runtimeId: 'r', revision: 2, session: null },
  );
  assert.equal(OVERLAY_PAGES.interactions, 'interactions.html');
});

test('interactions scope is read-only and independent of game privileges', () => {
  assert.equal(isOverlayRequestAllowed('interactions', 'GET', '/api/interactions/session'), true);
  for (const [method, path] of [
    ['POST', '/api/interactions/session'],
    ['POST', '/api/interactions/session/finish'],
    ['POST', '/api/interactions/session/clear'],
    ['GET', '/api/interactions/host-state'],
    ['GET', '/api/games/session'],
    ['POST', '/api/wheel/spin'],
  ]) {
    assert.equal(isOverlayRequestAllowed('interactions', method, path), false);
  }
  assert.equal(isOverlayRequestAllowed('games', 'GET', '/api/interactions/session'), false);
});
