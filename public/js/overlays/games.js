import { createDanmakuFeed } from './danmaku-feed.js';
import { createDrawController } from './games-drawing.js';

('use strict');

let session = null;
let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let snapshotRetryTimer = null;
let initialSnapshotLoaded = false;
let resultProfileRequest = 0;
let drawDanmakuFeed = null;
let drawController = null;

const INITIAL_SNAPSHOT_RETRIES = 4;
const INITIAL_SNAPSHOT_RETRY_DELAY_MS = 350;

document.addEventListener('DOMContentLoaded', () => {
  drawDanmakuFeed = createDanmakuFeed(byId('drawDanmakuFeed'), {
    offscreenViewports: 5,
    resolveAvatarUrl: avatarSource,
    getGuardLabel: guardLabel,
    classNames: {
      identity: 'draw-danmaku-identity',
      guard: 'draw-danmaku-guard',
      medal: 'draw-danmaku-medal',
    },
  });
  drawController = createDrawController({
    byId,
    canDraw,
    getSession: () => session,
    loadSnapshot,
    renderDanmaku: renderDrawDanmaku,
  });
  drawController.init();
  loadSnapshot();
  connectSocket();
  byId('gameResultAvatar').addEventListener('error', hideGameResultAvatar);
  byId('gameResultExit').addEventListener('click', () =>
    submitGameResultAction('stop'),
  );
  byId('gameResultNext').addEventListener('click', () =>
    submitGameResultAction('restart'),
  );
  window.addEventListener('resize', positionGameResult);
  setInterval(() => drawController?.updateCountdown(), 250);
});

async function loadSnapshot(attempt = 0) {
  try {
    const token = window.__API_TOKEN__;
    const response = await fetch('/api/games/session', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
    if (attempt >= INITIAL_SNAPSHOT_RETRIES)
      byId('gameTurn').textContent = '等待连接';
    else scheduleSnapshotRetry(attempt + 1);
  }
}

function scheduleSnapshotRetry(attempt) {
  clearTimeout(snapshotRetryTimer);
  snapshotRetryTimer = setTimeout(
    () => loadSnapshot(attempt),
    INITIAL_SNAPSHOT_RETRY_DELAY_MS,
  );
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  socket = new WebSocket(
    `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`,
  );
  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
  });
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'game:update') {
      initialSnapshotLoaded = true;
      clearTimeout(snapshotRetryTimer);
      renderGame(payload.session);
    }
    if (payload.type === 'game:draw')
      drawController?.applyBroadcast(payload.operation);
    if (payload.type === 'snapshot') {
      if (
        !payload.state ||
        typeof payload.state !== 'object' ||
        !Object.prototype.hasOwnProperty.call(payload.state, 'games')
      )
        return;
      initialSnapshotLoaded = true;
      clearTimeout(snapshotRetryTimer);
      renderGame(payload.state.games || null);
    }
  });
  socket.addEventListener('close', () => {
    const delay = Math.min(30000, 800 * 2 ** Math.min(reconnectAttempts, 6));
    reconnectAttempts += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      loadSnapshot();
      connectSocket();
    }, delay);
  });
}

function renderGame(nextSession) {
  session = nextSession || null;
  const game = nextSession?.game || '';
  document.body.dataset.game = game;
  if (!session || game !== 'draw-guess')
    drawController?.resetDanmakuRenderScheduler();
  byId('gameEmptyView').hidden = Boolean(session);
  byId('numberBombView').hidden = game !== 'number-bomb' || !session;
  byId('gomokuView').hidden = game !== 'gomoku' || !session;
  byId('drawGuessView').hidden = game !== 'draw-guess' || !session;
  if (!session) {
    drawController?.setToolsEnabled(false);
    byId('gameTurn').textContent = '等待开局';
    hideGameResult();
    return;
  }
  const state = session.state;
  if (game === 'draw-guess') {
    renderDrawGuess(state);
    hideGameResult();
    return;
  }
  byId('gameTurn').textContent = state.winner
    ? winnerLabel(state.winner)
    : `${turnLabel(state.turn)}的回合`;
  if (game === 'number-bomb') renderBomb(state);
  else renderGomoku(state);
  if (state.winner) showGameResult(state.winner, session.winner);
  else hideGameResult();
}

function renderBomb(state) {
  byId('bombHint').textContent = state.winner
    ? winnerLabel(state.winner)
    : `${turnLabel(state.turn)}先选一个数字`;
  byId('bombHistory').textContent = state.lastGuess
    ? `上次：${state.lastGuess}`
    : '尚未落子';
  const root = byId('bombNumbers');
  root.replaceChildren();
  for (let value = 1; value <= 100; value += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    const isSafe = value >= state.min && value <= state.max;
    const isPicked = value === state.lastGuess;
    button.className = `bomb-number ${isSafe ? 'is-safe' : 'is-unsafe'}${isPicked ? ' is-picked' : ''}`;
    button.textContent = String(value);
    button.disabled =
      value < state.min ||
      value > state.max ||
      Boolean(state.winner) ||
      state.turn !== 'host';
    if (isPicked) button.classList.add('last');
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
      button.disabled =
        Boolean(state.board[row][column]) ||
        Boolean(state.winner) ||
        state.turn !== 'host';
      button.addEventListener('click', () =>
        submitMove(coordinateLabel({ row, column })),
      );
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

function renderDrawGuess(state) {
  drawController?.setDrawingClock(
    state.phase === 'drawing'
      ? {
          remainingMs: Number(state.remainingMs) || 0,
          receivedAt: performance.now(),
        }
      : null,
  );
  byId('drawMeta').textContent = '';
  byId('drawRoundLabel').textContent =
    `第 ${state.round} / ${state.totalRounds} 局`;
  if (state.phase !== 'drawing') byId('drawCountdown').textContent = '00:00';
  byId('drawClue').textContent =
    state.phase === 'drawing'
      ? `${state.wordLength} 个字`
      : `答案 · ${state.revealedAnswer || '等待揭晓'}`;
  drawController?.scheduleDrawDanmakuRender(session.danmaku || []);
  byId('drawCorrectCount').textContent = `${state.correct.length} 人答对`;
  renderDrawScoreboard(state.scores || []);
  renderDrawCorrectFeed(state.correct || []);
  drawController?.redrawCanvas(state.canvas);
  const result = byId('drawRoundResult');
  result.hidden = state.phase === 'drawing' || !state.answerRevealed;
  byId('drawRevealedAnswer').textContent = state.revealedAnswer || '';
  drawController?.setToolsEnabled(state.phase === 'drawing');
  if (state.phase === 'round-result')
    byId('gameTurn').textContent = state.answerRevealed
      ? '答案已公布 · 等待下一题'
      : '时间到 · 等待主播公布答案';
  else if (state.phase === 'finished')
    byId('gameTurn').textContent = '五局结束 · 最终排行';
  else drawController?.updateCountdown();
}

function renderDrawDanmaku(items) {
  if (!drawDanmakuFeed) return;
  drawDanmakuFeed.render(items);
}

function guardLabel(level) {
  if (Number(level) === 3) return '舰长';
  if (Number(level) === 2) return '提督';
  if (Number(level) === 1) return '总督';
  return '';
}

function renderDrawScoreboard(scores) {
  const root = byId('drawScoreboard');
  root.replaceChildren();
  if (!scores.length) {
    root.append(createEmptyDrawItem('还没有观众得分'));
    return;
  }
  scores.slice(0, 6).forEach((player, index) => {
    root.append(
      createDrawListItem(index + 1, player.name, `${player.score} 分`),
    );
  });
}

function renderDrawCorrectFeed(correct) {
  const root = byId('drawCorrectFeed');
  root.replaceChildren();
  if (!correct.length) {
    root.append(createEmptyDrawItem('等待第一条正确弹幕'));
    return;
  }
  correct.slice(0, 6).forEach((item) => {
    root.append(createDrawListItem(item.rank, item.name, `+${item.points}`));
  });
}

function createDrawListItem(rank, name, score) {
  const item = document.createElement('li');
  const rankEl = document.createElement('span');
  rankEl.className = 'draw-rank';
  rankEl.textContent = `#${rank}`;
  const nameEl = document.createElement('span');
  nameEl.className = 'draw-player-name';
  nameEl.textContent = name;
  const scoreEl = document.createElement('strong');
  scoreEl.className = 'draw-player-score';
  scoreEl.textContent = score;
  item.append(rankEl, nameEl, scoreEl);
  return item;
}

function createEmptyDrawItem(message) {
  const item = document.createElement('li');
  item.className = 'draw-list-empty';
  item.textContent = message;
  return item;
}

function canDraw() {
  return session?.game === 'draw-guess' && session.state?.phase === 'drawing';
}

async function submitMove(value) {
  try {
    const response = await fetch('/api/games/session/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    const payload = await response.json();
    if (payload.ok) renderGame(payload.data);
  } catch (_) {
    byId('gameTurn').textContent = '操作失败';
  }
}

function coordinateLabel(move) {
  return `${String.fromCharCode(65 + Number(move.column))}${Number(move.row) + 1}`;
}
function turnLabel(turn) {
  return turn === 'viewer' ? '观众' : '主播';
}
function winnerLabel(winner) {
  return winner === 'draw'
    ? '和棋'
    : `${winner === 'viewer' ? '观众' : '主播'}获胜`;
}
function byId(id) {
  return document.getElementById(id);
}

function showGameResult(winner, winnerIdentity = {}) {
  const resultEl = byId('gameResult');
  const textEl = byId('gameResultText');
  const winnerUid = String(winnerIdentity.uid || '').trim();
  if (
    !resultEl.hidden &&
    resultEl.dataset.winner === winner &&
    resultEl.dataset.winnerUid === winnerUid
  )
    return;
  const requestId = ++resultProfileRequest;
  resultEl.dataset.winner = winner;
  resultEl.dataset.winnerUid = winnerUid;
  textEl.textContent = winnerLabel(winner);
  setGameResultActionsPending(false);
  setGameResultActionStatus('');
  resultEl.hidden = false;
  positionGameResult();
  hideGameResultAvatar();
  if (winner !== 'draw') void loadWinnerProfile(requestId, winner);
}

function positionGameResult() {
  const resultEl = byId('gameResult');
  if (!resultEl || resultEl.hidden) return;
  const target =
    document.body.dataset.game === 'gomoku'
      ? byId('gomokuBoard')
      : byId('bombNumbers');
  const stage = byId('gameStage');
  if (!target || !stage) return;
  const targetRect = target.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  if (targetRect.width <= 0 || targetRect.height <= 0) return;
  resultEl.style.left = `${targetRect.left - stageRect.left}px`;
  resultEl.style.top = `${targetRect.top - stageRect.top}px`;
  resultEl.style.width = `${targetRect.width}px`;
  resultEl.style.height = `${targetRect.height}px`;
}

async function loadWinnerProfile(requestId, winner) {
  try {
    const token = window.__API_TOKEN__;
    const response = await fetch('/api/games/winner-profile', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const payload = await response.json();
    if (!payload.ok || requestId !== resultProfileRequest) return;
    const profile = payload.data || {};
    const resultEl = byId('gameResult');
    if (resultEl.hidden || resultEl.dataset.winner !== winner) return;
    if (!profile.avatarUrl) return;
    const avatar = byId('gameResultAvatar');
    avatar.alt = `${turnLabel(winner)}头像`;
    avatar.src = avatarSource(profile.avatarUrl);
    avatar.hidden = false;
  } catch (_) {
    hideGameResultAvatar();
  }
}

async function submitGameResultAction(action) {
  const resultEl = byId('gameResult');
  if (resultEl.hidden || !['stop', 'restart'].includes(action)) return;
  setGameResultActionsPending(true, action);
  setGameResultActionStatus('');
  try {
    const token = window.__API_TOKEN__;
    const response = await fetch('/api/games/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok)
      throw new Error(payload.error || '操作失败');
    renderGame(payload.data);
  } catch (_) {
    if (resultEl.hidden) return;
    setGameResultActionsPending(false);
    setGameResultActionStatus('操作失败，请重试');
  }
}

function setGameResultActionsPending(pending, action = '') {
  const exitButton = byId('gameResultExit');
  const nextButton = byId('gameResultNext');
  exitButton.disabled = pending;
  nextButton.disabled = pending;
  exitButton.textContent = pending && action === 'stop' ? '退出中…' : '退出';
  nextButton.textContent =
    pending && action === 'restart' ? '开局中…' : '下一局';
}

function setGameResultActionStatus(message) {
  const status = byId('gameResultActionStatus');
  status.textContent = message;
  status.hidden = !message;
}

function hideGameResult() {
  resultProfileRequest += 1;
  const resultEl = byId('gameResult');
  resultEl.hidden = true;
  resultEl.removeAttribute('style');
  delete resultEl.dataset.winner;
  delete resultEl.dataset.winnerUid;
  hideGameResultAvatar();
  setGameResultActionsPending(false);
  setGameResultActionStatus('');
}

function hideGameResultAvatar() {
  const avatar = byId('gameResultAvatar');
  avatar.hidden = true;
  avatar.alt = '';
  avatar.removeAttribute('src');
}

function avatarSource(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const token = String(window.__API_TOKEN__ || '');
  return `/api/bilibili/avatar?url=${encodeURIComponent(source)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}
