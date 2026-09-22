'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameSessionService } = require('../src/games/game-session-service');

test('streamer danmaku and automatic replies cannot join or take a viewer turn', (t) => {
  t.mock.method(Math, 'random', () => 0.69);
  for (const mode of ['single', 'multi']) {
    for (const game of ['gomoku', 'number-bomb']) {
      const service = createGameSessionService();
      try {
        service.start({ game, mode, targetUid: 'host' });
        service.move({ value: game === 'gomoku' ? 'A1' : 50 }, 'host');
        const before = JSON.stringify(service.getSession());
        const value = game === 'gomoku' ? 'B1' : String(service.getSession().state.min);
        const result = service.handleDanmaku({
          uid: 'host',
          userName: '主播',
          isStreamer: true,
          message: value,
        });
        assert.equal(result.accepted, false);
        assert.equal(JSON.stringify(service.getSession()), before);
        assert.equal(service.listViewers().length, 0);
        if (mode === 'multi') {
          assert.equal(
            service.handleDanmaku({
              uid: 'viewer',
              userName: '观众',
              message: value,
            }).accepted,
            true,
          );
        }
      } finally {
        service.dispose();
      }
    }
  }
});

test('streamer draw-guess messages remain visible but never score or enter viewer selection', () => {
  const service = createGameSessionService({
    drawGuessWords: [{ word: '苹果', category: '食物' }],
    random: () => 0,
  });
  try {
    service.start({ game: 'draw-guess' });
    assert.equal(
      service.handleDanmaku({
        uid: 'host',
        userName: '主播',
        isStreamer: true,
        message: '苹果',
      }).accepted,
      false,
    );
    assert.equal(service.getSession().danmaku.length, 1);
    assert.equal(service.getSession().state.scores.length, 0);
    assert.equal(service.listViewers().length, 0);
    assert.equal(
      service.handleDanmaku({
        uid: 'viewer',
        userName: '观众',
        message: '苹果',
      }).accepted,
      true,
    );
    assert.equal(service.listViewers()[0].uid, 'viewer');
  } finally {
    service.dispose();
  }
});
