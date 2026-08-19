'use strict';

let session = null;
let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let snapshotRetryTimer = null;
let initialSnapshotLoaded = false;

const INITIAL_SNAPSHOT_RETRIES = 4;
const INITIAL_SNAPSHOT_RETRY_DELAY_MS = 350;

document.addEventListener('DOMContentLoaded', () => {
  loadSnapshot();
  connectSocket();
});

async function loadSnapshot(attempt = 0) {
  try {
    const token = window.__API_TOKEN__;
    const response = await fetch('/api/games/session', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '读取游戏状态失败');
    if (payload.data || attempt >= INITIAL_SNAPSHOT_RETRIES) {
      initialSnapshotLoaded = true;
      clearTimeout(snapshotRetryTimer);
      renderGame(payload.data);
      return;
    }
    scheduleSnapshotRetry(attempt + 1);
  } catch (_) {
    if (attempt >= INITIAL_SNAPSHOT_RETRIES) byId('gameTurn').textContent = '等待连接';
    else scheduleSnapshotRetry(attempt + 1);
  }
}

function scheduleSnapshotRetry(attempt) {
  clearTimeout(snapshotRetryTimer);
  snapshotRetryTimer = setTimeout(() => loadSnapshot(attempt), INITIAL_SNAPSHOT_RETRY_DELAY_MS);
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  socket = new WebSocket(`${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  socket.addEventListener('open', () => { reconnectAttempts = 0; });
  socket.addEventListener('message', event => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'game:update') {
      if (payload.session) {
        initialSnapshotLoaded = true;
        clearTimeout(snapshotRetryTimer);
      }
      renderGame(payload.session);
    }
    if (payload.type === 'snapshot') {
      const nextSession = payload.state?.games || null;
      if (nextSession) {
        initialSnapshotLoaded = true;
        clearTimeout(snapshotRetryTimer);
      }
      if (nextSession || initialSnapshotLoaded) renderGame(nextSession);
    }
  });
  socket.addEventListener('close', () => {
    const delay = Math.min(30000, 800 * (2 ** Math.min(reconnectAttempts, 6)));
    reconnectAttempts += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { loadSnapshot(); connectSocket(); }, delay);
  });
}

function renderGame(nextSession) {
  session = nextSession || null;
  const game = nextSession?.game || '';
  document.body.dataset.game = game;
  byId('gameEmptyView').hidden = Boolean(session);
  byId('numberBombView').hidden = game !== 'number-bomb' || !session;
  byId('gomokuView').hidden = game !== 'gomoku' || !session;
  if (!session) { byId('gameTurn').textContent = '等待开局'; hideGameResult(); return; }
  const state = session.state;
  byId('gameTurn').textContent = state.winner ? winnerLabel(state.winner) : `${turnLabel(state.turn)}的回合`;
  if (game === 'number-bomb') renderBomb(state);
  else renderGomoku(state);
  if (state.winner) showGameResult(state.winner);
  else hideGameResult();
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
  renderGomokuCoordinates(state.size);
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

function renderGomokuCoordinates(size) {
  const columns = byId('gomokuColumnLabels');
  const rows = byId('gomokuRowLabels');
  columns.replaceChildren();
  rows.replaceChildren();
  for (let index = 0; index < size; index += 1) {
    const column = document.createElement('span');
    column.textContent = String.fromCharCode(65 + index);
    columns.append(column);
    const row = document.createElement('span');
    row.textContent = String(index + 1);
    rows.append(row);
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

function showGameResult(winner) {
  const resultEl = byId('gameResult');
  const textEl = byId('gameResultText');
  resultEl.dataset.winner = winner;
  textEl.textContent = winnerLabel(winner);
  resultEl.hidden = false;
}

function hideGameResult() {
  byId('gameResult').hidden = true;
}
