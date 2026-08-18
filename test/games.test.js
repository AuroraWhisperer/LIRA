'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNumberBombState, guessNumber, publicNumberBombState } = require('../src/games/number-bomb');
const { createGomokuState, parseCoordinate, placeStone } = require('../src/games/gomoku');

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
