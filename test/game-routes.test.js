'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSessionInput, routes } = require('../src/server/routes/game-routes');
const { createGameSessionService } = require('../src/games/game-session-service');

test('single-player game requires a selected numeric viewer uid', () => {
  assert.throws(() => normalizeSessionInput({ game: 'gomoku', mode: 'single' }), /请选择一位在线观众/);
  assert.deepEqual(normalizeSessionInput({
    game: 'number-bomb', mode: 'single', targetUid: '123', targetName: 'Alice'
  }), { game: 'number-bomb', mode: 'single', targetUid: '123', targetName: 'Alice' });
});

test('game session accepts only selected viewer danmaku in single mode', () => {
  const service = createGameSessionService();
  service.start({ game: 'number-bomb', mode: 'single', targetUid: '1', targetName: 'Alice' });
  service.move({ value: 50 }, 'host');
  assert.equal(service.handleDanmaku({ uid: '2', userName: 'Bob', message: '60' }).accepted, false);
  const result = service.handleDanmaku({ uid: '1', userName: 'Alice', message: '60' });
  assert.equal(typeof result.accepted, 'boolean');
});

test('game session refuses replacing an active game until it is stopped', () => {
  const service = createGameSessionService();
  service.start({ game: 'number-bomb', mode: 'multi' });

  assert.throws(
    () => service.start({ game: 'gomoku', mode: 'single', targetUid: '2', targetName: 'Bob' }),
    error => error.statusCode === 409 && /请先结束当前游戏/.test(error.message)
  );
  assert.equal(service.getSession().game, 'number-bomb');

  service.stop();
  assert.equal(service.start({ game: 'gomoku', mode: 'single', targetUid: '2', targetName: 'Bob' }).game, 'gomoku');
});

test('game session route returns conflict for a second start request', async () => {
  const service = createGameSessionService();
  service.start({ game: 'number-bomb', mode: 'multi' });
  let status;
  let payload;
  await routes['POST /api/games/session'](
    { games: { start: service.start, stop: service.stop, getSession: service.getSession } },
    { body: async () => ({ game: 'gomoku', mode: 'multi' }) },
    {
      writeHead(nextStatus) { status = nextStatus; },
      end(body) { payload = JSON.parse(body); }
    }
  );

  assert.equal(status, 409);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /请先结束当前游戏/);
  assert.equal(service.getSession().game, 'number-bomb');
});

test('game winner profile route returns transient avatar data', async () => {
  let status;
  let payload;
  await routes['GET /api/games/winner-profile'](
    { games: { getWinnerProfile: async () => ({ avatarUrl: 'https://i0.hdslb.com/bfs/face/test.jpg', name: 'Alice' }) } },
    {},
    {
      writeHead(nextStatus) { status = nextStatus; },
      end(body) { payload = JSON.parse(body); }
    }
  );

  assert.equal(status, 200);
  assert.deepEqual(payload, {
    ok: true,
    data: { avatarUrl: 'https://i0.hdslb.com/bfs/face/test.jpg', name: 'Alice' }
  });
});
