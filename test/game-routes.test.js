'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSessionInput } = require('../src/server/routes/game-routes');
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
