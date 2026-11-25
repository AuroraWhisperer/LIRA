'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameSessionService } = require('../../src/games/game-session-service');

test('a viewer guesses a complete integer without taking a turn on fractions or negative numbers', (t) => {
  t.mock.method(Math, 'random', () => 0.495);
  const service = createGameSessionService();
  t.after(() => service.dispose());
  service.start({ game: 'number-bomb', mode: 'single', targetUid: '42' });
  service.move({ value: 47 }, 'host');
  const guess = (message) => service.handleDanmaku({ uid: '42', message });
  const revision = service.getSession().eventRevision;
  for (const message of ['50.5', '0.50', '50．５', '50.５', '０．50', '-50', '我猜 −50！']) {
    assert.equal(guess(message).accepted, false, message);
  }
  assert.equal(service.getSession().eventRevision, revision);
  assert.equal(guess('我猜 48！').accepted, true);
  service.move({ value: 49 }, 'host');
  assert.equal(guess('我猜...50').hit, true);
  assert.equal(service.getSession().winner.role, 'host');
});
