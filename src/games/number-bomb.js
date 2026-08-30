'use strict';

const MIN_NUMBER = 1;
const MAX_NUMBER = 100;

function createNumberBombState(random = Math.random) {
  const bomb =
    Math.floor(random() * (MAX_NUMBER - MIN_NUMBER + 1)) + MIN_NUMBER;
  return {
    min: MIN_NUMBER,
    max: MAX_NUMBER,
    bomb,
    turn: 'host',
    winner: '',
    lastGuess: null,
    history: [],
  };
}

function guessNumber(state, guess, player) {
  if (!state || state.winner || !['host', 'viewer'].includes(player)) {
    return { accepted: false, reason: '游戏未在接受落子。', state };
  }
  if (state.turn !== player)
    return { accepted: false, reason: '还没轮到该玩家。', state };
  const value = Number(guess);
  if (!Number.isInteger(value) || value < state.min || value > state.max) {
    return {
      accepted: false,
      reason: `请输入 ${state.min}-${state.max} 之间的整数。`,
      state,
    };
  }

  const next = {
    ...state,
    lastGuess: value,
    history: [...state.history, { player, value }],
  };
  if (value === state.bomb) {
    next.winner = player === 'host' ? 'viewer' : 'host';
    next.turn = '';
  } else if (value < state.bomb) {
    next.min = value + 1;
    next.turn = player === 'host' ? 'viewer' : 'host';
  } else {
    next.max = value - 1;
    next.turn = player === 'host' ? 'viewer' : 'host';
  }
  return { accepted: true, state: next, hit: value === state.bomb };
}

function publicNumberBombState(state) {
  if (!state) return null;
  const { bomb, ...safeState } = state;
  return safeState;
}

module.exports = {
  MIN_NUMBER,
  MAX_NUMBER,
  createNumberBombState,
  guessNumber,
  publicNumberBombState,
};
