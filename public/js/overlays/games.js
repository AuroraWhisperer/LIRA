'use strict';

const params = new URLSearchParams(location.search);
const game = params.get('game') === 'gomoku' ? 'gomoku' : 'number-bomb';
let session = null;
let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

document.addEventListener('DOMContentLoaded', () => {
  document.body.dataset.game = game;
  renderGame(session);
  loadSnapshot();
  connectSocket();
});

async function loadSnapshot() {
  try {
    const response = await fetch('/api/games/session');
    const payload = await response.json();
    if (payload.ok) renderGame(payload.data);
  } catch (_) { byId('gameTurn').textContent = '等待连接'; }
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  socket = new WebSocket(`${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  socket.addEventListener('open', () => { reconnectAttempts = 0; });
  socket.addEventListener('message', event => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'game:update') renderGame(payload.session);
    if (payload.type === 'snapshot') renderGame(payload.state?.games || session);
  });
  socket.addEventListener('close', () => {
    const delay = Math.min(30000, 800 * (2 ** Math.min(reconnectAttempts, 6)));
    reconnectAttempts += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { loadSnapshot(); connectSocket(); }, delay);
  });
}

function renderGame(nextSession) {
  session = nextSession && nextSession.game === game ? nextSession : null;
  byId('gameEmptyView').hidden = Boolean(session);
  byId('numberBombView').hidden = game !== 'number-bomb' || !session;
  byId('gomokuView').hidden = game !== 'gomoku' || !session;
  if (!session) { byId('gameTurn').textContent = '等待开局'; return; }
  const state = session.state;
  byId('gameTurn').textContent = state.winner ? winnerLabel(state.winner) : `${turnLabel(state.turn)}的回合`;
  if (game === 'number-bomb') renderBomb(state);
  else renderGomoku(state);
}

function renderBomb(state) {
  byId('bombHint').textContent = state.winner ? winnerLabel(state.winner) : `${turnLabel(state.turn)}先选一个数字`;
  byId('bombHistory').textContent = state.lastGuess ? `上次：${state.lastGuess}` : '尚未落子';
  const root = byId('bombNumbers');
  root.replaceChildren();
  for (let value = 1; value <= 100; value += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    const isSafe = value >= state.min && value <= state.max;
    button.className = `bomb-number ${isSafe ? 'is-safe' : 'is-unsafe'}`;
    button.textContent = String(value);
    button.disabled = value < state.min || value > state.max || Boolean(state.winner) || state.turn !== 'host';
    if (value === state.lastGuess) button.classList.add('last');
    button.addEventListener('click', () => submitMove(value));
    root.append(button);
  }
}

function renderGomoku(state) {
  byId('gomokuHint').textContent = state.winner ? winnerLabel(state.winner) : `${turnLabel(state.turn)}先落子`;
  byId('gomokuLastMove').textContent = state.lastMove ? `最近：${coordinateLabel(state.lastMove)}` : '尚未落子';
  const root = byId('gomokuBoard');
  root.replaceChildren();
  for (let row = 0; row < state.size; row += 1) {
    for (let column = 0; column < state.size; column += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `gomoku-cell${state.board[row][column] ? ` has-${state.board[row][column]}` : ''}`;
      button.setAttribute('aria-label', coordinateLabel({ row, column }));
      button.disabled = Boolean(state.board[row][column]) || Boolean(state.winner) || state.turn !== 'host';
      button.addEventListener('click', () => submitMove(coordinateLabel({ row, column })));
      root.append(button);
    }
  }
}

async function submitMove(value) {
  try {
    const response = await fetch('/api/games/session/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
    const payload = await response.json();
    if (payload.ok) renderGame(payload.data);
  } catch (_) { byId('gameTurn').textContent = '操作失败'; }
}

function coordinateLabel(move) { return `${String.fromCharCode(65 + Number(move.column))}${Number(move.row) + 1}`; }
function turnLabel(turn) { return turn === 'viewer' ? '观众' : '主播'; }
function winnerLabel(winner) { return winner === 'draw' ? '和棋' : `${winner === 'viewer' ? '观众' : '主播'}获胜`; }
function byId(id) { return document.getElementById(id); }
