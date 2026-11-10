'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSessionInput, routes } = require('../../src/server/routes/game-routes');
const { createGameSessionService } = require('../../src/games/game-session-service');
const { createGameRuntime, createGameAudience } = require('../../src/server/game-runtime');

test('single-player game requires a selected numeric viewer uid', () => {
  assert.throws(() => normalizeSessionInput({ game: 'gomoku', mode: 'single' }));
  assert.deepEqual(
    normalizeSessionInput({
      game: 'number-bomb',
      mode: 'single',
      targetUid: '123',
      targetName: 'Alice',
    }),
    {
      game: 'number-bomb',
      mode: 'single',
      targetUid: '123',
      targetName: 'Alice',
    },
  );
  const drawGuess = normalizeSessionInput({ game: 'draw-guess' });
  assert.equal(drawGuess.mode, 'multi');
  assert.equal(drawGuess.targetUid, '');
});

test('games viewers include recent speakers outside the rank and deduplicate ranked speakers', async (t) => {
  const service = createGameSessionService();
  t.after(() => service.dispose());
  service.handleDanmaku({ uid: '123', userName: 'Alice', message: '一起玩' });
  service.handleDanmaku({ uid: '456', userName: 'Bob', message: '来了' });
  service.handleDanmaku({ userName: 'Anonymous', message: 'hello' });
  let ranked = [];
  const rankedLastSeenAt = Date.now() + 1000;
  const context = {
    games: createGameAudience({
      service,
      listOnlineViewers: () => ranked,
      refreshViewers: async () => {
        ranked = [{ uid: '456', userName: 'Ranked Bob', seenAt: rankedLastSeenAt }, { uid: '789', userName: 'Carol' }];
      },
    }),
  };
  let status;
  let payload;
  await routes['GET /api/games/viewers'](
    context,
    {},
    {
      writeHead(nextStatus) {
        status = nextStatus;
      },
      end(body) {
        payload = JSON.parse(body);
      },
    },
  );

  assert.equal(status, 200);
  assert.deepEqual(payload.data.map((viewer) => viewer.uid).sort(), ['123', '456', '789']);
  assert.equal(payload.data[0].uid, '456', 'the most recent appearance sorts first');
  assert.equal(payload.data[0].name, 'Bob', 'recent speaker names take precedence over ranked names');
  assert.equal(payload.data[0].lastSeenAt, rankedLastSeenAt);
  ranked = [];
  assert.deepEqual(context.games.listViewers().map((viewer) => viewer.uid).sort(), ['123', '456']);
});

test('games viewer refresh failure preserves known candidates but does not hide an empty failure', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const service = createGameSessionService();
  t.after(() => service.dispose());
  service.handleDanmaku({ uid: '123', userName: 'Alice', message: '一起玩' });
  const failure = new Error('synthetic rank failure');
  const context = { games: { ...service, refreshViewers: async () => { throw failure; } } };
  let payload;
  await routes['GET /api/games/viewers'](context, {}, {
    writeHead(status) { assert.equal(status, 200); },
    end(body) { payload = JSON.parse(body); },
  });
  assert.equal(payload.data[0].uid, '123');
  context.games.listViewers = () => [];
  await assert.rejects(routes['GET /api/games/viewers'](context, {}, {}), failure);
});

test('game runtime discards viewer candidates from a previous room or connection', (t) => {
  const source = { roomId: '100', accountUid: '200', connectionKey: '1' };
  const { games, interactions } = createGameRuntime({
    getSourceState: () => source,
    subscribe: () => () => {},
  });
  t.after(() => { games.dispose(); interactions.dispose(); });
  games.handleDanmaku({ uid: '123', userName: 'Alice' });
  source.configuredRoomChanged = true;
  games.handleDanmaku({ uid: '456', userName: 'Old room message' });
  assert.equal(games.listViewers().length, 0);
  source.configuredRoomChanged = false;
  source.roomId = '101';
  games.handleDanmaku({ uid: '456', userName: 'Bob' });
  assert.deepEqual(games.listViewers().map((viewer) => viewer.uid), ['456']);
  source.connectionKey = '2';
  assert.equal(games.listViewers().length, 0);
  games.handleDanmaku({ uid: '789', userName: 'Carol' });
  source.accountUid = '201';
  assert.equal(games.listViewers().length, 0);
});

test('draw guess route preserves round and duration configuration', () => {
  const input = normalizeSessionInput({
    game: 'draw-guess',
    totalRounds: 8,
    roundDurationSeconds: 120,
  });
  assert.equal(input.totalRounds, 8);
  assert.equal(input.roundDurationSeconds, 120);
});

test('draw guess session input normalizes category ids and rejects empty selections', () => {
  assert.deepEqual(
    normalizeSessionInput({
      game: 'draw-guess',
      categoryIds: ['animals', 'animals', 'food-drink'],
    }).categoryIds,
    ['animals', 'food-drink'],
  );
  assert.throws(() => normalizeSessionInput({ game: 'draw-guess', categoryIds: [] }));
  assert.throws(
    () =>
      normalizeSessionInput({
        game: 'draw-guess',
        categoryIds: ['animals', '../secret'],
      }),
  );
});

test('game session accepts only selected viewer danmaku in single mode', () => {
  const service = createGameSessionService();
  service.start({
    game: 'number-bomb',
    mode: 'single',
    targetUid: '1',
    targetName: 'Alice',
  });
  service.move({ value: 50 }, 'host');
  assert.equal(service.handleDanmaku({ uid: '2', userName: 'Bob', message: '60' }).accepted, false);
  const result = service.handleDanmaku({
    uid: '1',
    userName: 'Alice',
    message: '60',
  });
  assert.equal(typeof result.accepted, 'boolean');
});

test('game session refuses replacing an active game until it is stopped', () => {
  const service = createGameSessionService();
  service.start({ game: 'number-bomb', mode: 'multi' });

  assert.throws(
    () =>
      service.start({
        game: 'gomoku',
        mode: 'single',
        targetUid: '2',
        targetName: 'Bob',
      }),
    { statusCode: 409 },
  );
  assert.equal(service.getSession().game, 'number-bomb');

  service.stop();
  assert.equal(
    service.start({
      game: 'gomoku',
      mode: 'single',
      targetUid: '2',
      targetName: 'Bob',
    }).game,
    'gomoku',
  );
});

test('game session route returns conflict for a second start request', async () => {
  const service = createGameSessionService();
  service.start({ game: 'number-bomb', mode: 'multi' });
  let status;
  let payload;
  await routes['POST /api/games/session'](
    {
      games: {
        start: service.start,
        stop: service.stop,
        getSession: service.getSession,
      },
    },
    { body: async () => ({ game: 'gomoku', mode: 'multi' }) },
    {
      writeHead(nextStatus) {
        status = nextStatus;
      },
      end(body) {
        payload = JSON.parse(body);
      },
    },
  );

  assert.equal(status, 409);
  assert.equal(payload.ok, false);
  assert.equal(service.getSession().game, 'number-bomb');
});

test('game session route restarts a finished game without an empty-session response', async () => {
  let status;
  let payload;
  let restarts = 0;
  await routes['POST /api/games/session'](
    {
      games: {
        restart: () => {
          restarts += 1;
          return { game: 'gomoku', state: { winner: '' } };
        },
      },
    },
    { body: async () => ({ action: 'restart' }) },
    {
      writeHead(nextStatus) {
        status = nextStatus;
      },
      end(body) {
        payload = JSON.parse(body);
      },
    },
  );

  assert.equal(status, 200);
  assert.equal(restarts, 1);
  assert.deepEqual(payload, {
    ok: true,
    data: { game: 'gomoku', state: { winner: '' } },
  });
});

test('gomoku draw stays consistent across move, snapshot and broadcast projections', async () => {
  const published = [];
  const service = createGameSessionService({
    broadcast: (message) => published.push(message),
  });
  service.start({ game: 'gomoku', mode: 'multi' });
  const moves = { host: [], viewer: [] };
  // Shift BBWW by two columns each row: no line can contain five equal stones.
  for (let row = 0; row < 15; row += 1) {
    for (let column = 0; column < 15; column += 1) {
      const player = (row * 2 + column) % 4 < 2 ? 'host' : 'viewer';
      moves[player].push(`${String.fromCharCode(65 + column)}${row + 1}`);
    }
  }
  for (let index = 0; index < moves.viewer.length; index += 1) {
    for (const player of ['host', 'viewer']) {
      service.move({ value: moves[player][index] }, player);
    }
  }

  let status;
  let payload;
  const response = {
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(body) {
      payload = JSON.parse(body);
    },
  };
  await routes['POST /api/games/session/move'](
    { games: service },
    { body: async () => ({ value: moves.host.at(-1) }) },
    response,
  );

  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  const drawnSession = payload.data;
  assert.equal(drawnSession.state.history.length, 225);
  assert.equal(drawnSession.state.board.flat().every(Boolean), true);
  assert.equal(drawnSession.state.winner, 'draw');
  assert.equal(drawnSession.state.turn, '');
  assert.equal(Object.hasOwn(drawnSession, 'winner'), false);
  assert.deepEqual(service.getSession(), drawnSession);
  assert.deepEqual(published.at(-1), {
    type: 'game:update',
    session: drawnSession,
  });

  routes['GET /api/games/session']({ games: service }, {}, response);
  assert.equal(status, 200);
  assert.deepEqual(payload, { ok: true, data: drawnSession });
  assert.equal(service.move({ value: 'A1' }, 'host').accepted, false);
  const restarted = service.restart();
  assert.equal(restarted.state.winner, '');
  assert.equal(restarted.state.history.length, 0);
  assert.equal(Object.hasOwn(restarted, 'winner'), false);
});

test('draw guess drawing route validates through the game service and returns revision', async () => {
  let status;
  let payload;
  await routes['POST /api/games/session/draw'](
    { games: { draw: () => ({ accepted: true, revision: 4 }) } },
    { body: async () => ({ action: 'clear', clientId: 'page-1' }) },
    {
      writeHead(nextStatus) {
        status = nextStatus;
      },
      end(body) {
        payload = JSON.parse(body);
      },
    },
  );

  assert.equal(status, 200);
  assert.deepEqual(payload, { ok: true, data: { revision: 4 } });
});
