'use strict';

const BOARD_SIZE = 15;
const COLUMN_LABELS = 'ABCDEFGHIJKLMNO';

function createGomokuState() {
  return {
    size: BOARD_SIZE,
    board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill('')),
    turn: 'host',
    winner: '',
    lastMove: null,
    history: []
  };
}

function parseCoordinate(input) {
  const match = String(input || '').trim().toUpperCase().match(/^([A-O])(1[0-5]|[1-9])$/);
  if (!match) return null;
  return { column: COLUMN_LABELS.indexOf(match[1]), row: Number(match[2]) - 1 };
}

function placeStone(state, input, player) {
  if (!state || state.winner || !['host', 'viewer'].includes(player)) {
    return { accepted: false, reason: '游戏未在接受落子。', state };
  }
  if (state.turn !== player) return { accepted: false, reason: '还没轮到该玩家。', state };
  const coordinate = typeof input === 'string' ? parseCoordinate(input) : input;
  if (!coordinate || coordinate.row < 0 || coordinate.row >= BOARD_SIZE || coordinate.column < 0 || coordinate.column >= BOARD_SIZE) {
    return { accepted: false, reason: '坐标格式应为 A1-O15。', state };
  }
  if (state.board[coordinate.row][coordinate.column]) return { accepted: false, reason: '这个位置已经有棋子。', state };

  const board = state.board.map(row => [...row]);
  const mark = player === 'host' ? 'black' : 'white';
  board[coordinate.row][coordinate.column] = mark;
  const next = {
    ...state,
    board,
    lastMove: { ...coordinate, player, mark },
    history: [...state.history, { ...coordinate, player, mark }],
    turn: player === 'host' ? 'viewer' : 'host'
  };
  if (hasFive(board, coordinate.row, coordinate.column, mark)) {
    next.winner = player;
    next.turn = '';
  } else if (next.history.length >= BOARD_SIZE * BOARD_SIZE) {
    next.winner = 'draw';
    next.turn = '';
  }
  return { accepted: true, state: next };
}

function hasFive(board, row, column, mark) {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  return directions.some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = column + dc * sign;
      while (board[r]?.[c] === mark) {
        count += 1;
        r += dr * sign;
        c += dc * sign;
      }
    }
    return count >= 5;
  });
}

module.exports = { BOARD_SIZE, COLUMN_LABELS, createGomokuState, parseCoordinate, placeStone, hasFive };
