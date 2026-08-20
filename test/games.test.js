'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNumberBombState, guessNumber, publicNumberBombState } = require('../src/games/number-bomb');
const { createGomokuState, parseCoordinate, placeStone } = require('../src/games/gomoku');
const {
  applyDrawOperation,
  createDrawGuessState,
  finishRound,
  publicDrawGuessState,
  startNextRound,
  submitGuess
} = require('../src/games/draw-guess');
const { createGameSessionService } = require('../src/games/game-session-service');

test('number bomb narrows range and alternates players without exposing bomb', () => {
  const state = createNumberBombState(() => 0.69);
  const first = guessNumber(state, 50, 'host');
  assert.equal(first.accepted, true);
  assert.deepEqual([first.state.min, first.state.max, first.state.turn], [51, 100, 'viewer']);
  assert.equal(Object.hasOwn(publicNumberBombState(first.state), 'bomb'), false);
});

test('number bomb ends when a player hits the bomb', () => {
  const state = createNumberBombState(() => 0);
  const result = guessNumber(state, 1, 'host');
  assert.equal(result.hit, true);
  assert.equal(result.state.winner, 'viewer');
});

test('gomoku parses viewer coordinates and detects five stones', () => {
  assert.deepEqual(parseCoordinate('b2'), { column: 1, row: 1 });
  let state = createGomokuState();
  for (let i = 0; i < 5; i += 1) {
    state = placeStone(state, `A${i + 1}`, 'host').state;
    if (i < 4) state = placeStone(state, `B${i + 1}`, 'viewer').state;
  }
  assert.equal(state.winner, 'host');
});

test('game session retains the viewer identity that wins', () => {
  const service = createGameSessionService();
  service.start({ game: 'gomoku', mode: 'multi' });
  const hostMoves = ['A1', 'C1', 'E1', 'G1', 'I1'];
  for (let index = 0; index < 5; index += 1) {
    service.move({ value: hostMoves[index] }, 'host');
    service.handleDanmaku({ uid: '42', userName: 'Alice', message: `B${index + 1}` });
  }

  assert.deepEqual(service.getSession().winner, { role: 'viewer', uid: '42', name: 'Alice' });
});

test('draw guess hides the answer while drawing and reveals it after the round', () => {
  const state = createDrawGuessState({
    words: [{ word: '苹果', category: '食物', aliases: ['蘋果'] }],
    random: () => 0,
    nowMs: 1000
  });
  const drawingView = publicDrawGuessState(state, { nowMs: 1000, serverNowMs: 5000 });

  assert.equal(drawingView.phase, 'drawing');
  assert.equal(drawingView.wordLength, 2);
  assert.equal(drawingView.remainingMs, 90000);
  assert.equal(JSON.stringify(drawingView).includes('苹果'), false);
  assert.equal(JSON.stringify(drawingView).includes('蘋果'), false);

  const resultView = publicDrawGuessState(finishRound(state, 91000), {
    nowMs: 91000,
    serverNowMs: 95000
  });
  assert.equal(resultView.phase, 'round-result');
  assert.equal(resultView.revealedAnswer, '苹果');
});

test('draw guess awards 10, 7, 5, then 3 points and scores each uid once per round', () => {
  let state = createDrawGuessState({
    words: [{ word: '冰淇淋', category: '食物', aliases: ['冰激凌'] }],
    random: () => 0,
    nowMs: 0
  });
  const expectedPoints = [10, 7, 5, 3];

  expectedPoints.forEach((points, index) => {
    const result = submitGuess(state, {
      uid: String(index + 1),
      userName: `观众${index + 1}`,
      message: index === 0 ? '答案是冰激凌！' : '冰淇淋'
    }, index + 1);
    assert.equal(result.accepted, true);
    assert.equal(result.award.points, points);
    state = result.state;
  });

  const duplicate = submitGuess(state, { uid: '1', userName: '观众1', message: '冰淇淋' }, 10);
  assert.equal(duplicate.accepted, false);
  assert.deepEqual(state.scores.map(item => item.score), expectedPoints);
});

test('draw guess completes after the configured number of rounds and ranks total scores', () => {
  const words = [
    { word: '苹果', category: '食物' },
    { word: '月亮', category: '自然' }
  ];
  let state = createDrawGuessState({ words, totalRounds: 2, random: () => 0, nowMs: 0 });
  state = submitGuess(state, { uid: '1', userName: 'Alice', message: '苹果' }, 1).state;
  state = finishRound(state, 2);
  state = startNextRound(state, { random: () => 0, nowMs: 3 });
  state = submitGuess(state, { uid: '2', userName: 'Bob', message: '月亮' }, 4).state;
  state = submitGuess(state, { uid: '1', userName: 'Alice', message: '月亮' }, 5).state;
  state = finishRound(state, 6);

  assert.equal(state.phase, 'finished');
  assert.deepEqual(state.scores.map(item => [item.uid, item.score]), [['1', 17], ['2', 10]]);
});

test('draw guess validates incremental canvas operations and supports clearing', () => {
  let state = createDrawGuessState({
    words: [{ word: '苹果', category: '食物' }],
    random: () => 0,
    nowMs: 0
  });
  const drawn = applyDrawOperation(state, {
    action: 'append',
    clientId: 'page-1',
    strokeId: 'stroke-1',
    color: '#222034',
    width: 4,
    points: [{ x: 0.1, y: 0.2 }, { x: 0.15, y: 0.25 }]
  });
  assert.equal(drawn.accepted, true);
  assert.equal(drawn.operation.points.length, 2);
  assert.equal(drawn.state.canvas.strokes.length, 1);
  assert.equal(drawn.state.canvas.revision, 1);
  state = drawn.state;

  const invalid = applyDrawOperation(state, {
    action: 'append',
    clientId: 'page-1',
    strokeId: 'stroke-2',
    color: '#not-a-color',
    width: 4,
    points: [{ x: 0.2, y: 0.3 }]
  });
  assert.equal(invalid.accepted, false);

  const cleared = applyDrawOperation(state, { action: 'clear', clientId: 'page-1' });
  assert.equal(cleared.accepted, true);
  assert.deepEqual(cleared.state.canvas.strokes, []);
  assert.equal(cleared.state.canvas.revision, 2);
});

test('game session keeps draw guess secret, scores danmaku and publishes drawing operations', () => {
  const published = [];
  const service = createGameSessionService({
    broadcast: payload => published.push(payload),
    drawGuessWords: [{ word: '苹果', category: '食物' }],
    random: () => 0,
    monotonicNow: () => 0,
    wallNow: () => 1000
  });
  const started = service.start({ game: 'draw-guess', mode: 'multi' });

  assert.equal(started.game, 'draw-guess');
  assert.equal(JSON.stringify(started).includes('苹果'), false);
  assert.equal(service.getHostState().word, '苹果');
  const guess = service.handleDanmaku({ uid: '42', userName: 'Alice', message: '苹果' });
  assert.equal(guess.accepted, true);
  assert.equal(service.getSession().state.scores[0].score, 10);

  const draw = service.draw({
    action: 'append',
    clientId: 'page-1',
    strokeId: 'stroke-1',
    color: '#222034',
    width: 4,
    points: [{ x: 0.1, y: 0.2 }]
  });
  assert.equal(draw.accepted, true);
  assert.equal(published.at(-1).type, 'game:draw');
  assert.equal(published.at(-1).operation.clientId, 'page-1');
  service.dispose();
});

test('game session ends draw guess rounds on one server-owned timer and disposes it', () => {
  let nowMs = 100;
  let timerCallback = null;
  let cancelledTimer = null;
  const service = createGameSessionService({
    drawGuessWords: [{ word: '苹果', category: '食物' }],
    random: () => 0,
    monotonicNow: () => nowMs,
    wallNow: () => 1000 + nowMs,
    setTimeout(callback, delay) {
      assert.equal(delay, 90000);
      timerCallback = callback;
      return 7;
    },
    clearTimeout(timer) { cancelledTimer = timer; }
  });
  service.start({ game: 'draw-guess', mode: 'multi' });
  assert.equal(typeof timerCallback, 'function');

  nowMs += 90000;
  timerCallback();
  assert.equal(service.getSession().state.phase, 'round-result');
  assert.equal(service.getSession().state.revealedAnswer, '苹果');

  service.dispose();
  assert.equal(cancelledTimer, 7);
});
