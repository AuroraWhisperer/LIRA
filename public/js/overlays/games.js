'use strict';

let session = null;
let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let snapshotRetryTimer = null;
let initialSnapshotLoaded = false;
let resultProfileRequest = 0;
let drawColor = '#222034';
let drawWidth = 4;
let drawEraser = false;
let drawClock = null;
let activeStroke = null;
let drawFlushTimer = null;
let drawSendChain = Promise.resolve();

const drawClientId = `draw-${typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2)}`;

const INITIAL_SNAPSHOT_RETRIES = 4;
const INITIAL_SNAPSHOT_RETRY_DELAY_MS = 350;

document.addEventListener('DOMContentLoaded', () => {
  initDrawCanvas();
  loadSnapshot();
  connectSocket();
  byId('gameResultAvatar').addEventListener('error', hideGameResultAvatar);
  window.addEventListener('resize', positionGameResult);
  setInterval(updateDrawCountdown, 250);
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
    if (payload.type === 'game:draw') applyDrawBroadcast(payload.operation);
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
  byId('drawGuessView').hidden = game !== 'draw-guess' || !session;
  if (!session) { byId('gameTurn').textContent = '等待开局'; hideGameResult(); return; }
  const state = session.state;
  if (game === 'draw-guess') {
    renderDrawGuess(state);
    hideGameResult();
    return;
  }
  byId('gameTurn').textContent = state.winner ? winnerLabel(state.winner) : `${turnLabel(state.turn)}的回合`;
  if (game === 'number-bomb') renderBomb(state);
  else renderGomoku(state);
  if (state.winner) showGameResult(state.winner, session.winner);
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

function renderDrawGuess(state) {
  drawClock = state.phase === 'drawing'
    ? { remainingMs: Number(state.remainingMs) || 0, receivedAt: performance.now() }
    : null;
  byId('drawMeta').textContent = `第 ${state.round} / ${state.totalRounds} 局 · ${state.category}`;
  byId('drawClue').textContent = state.phase === 'drawing'
    ? `${state.category} · ${state.wordLength} 个字`
    : `答案 · ${state.revealedAnswer || '等待揭晓'}`;
  renderDrawDanmaku(session.danmaku || []);
  byId('drawCorrectCount').textContent = `${state.correct.length} 人答对`;
  renderDrawScoreboard(state.scores || []);
  renderDrawCorrectFeed(state.correct || []);
  redrawCanvas(state.canvas);
  const result = byId('drawRoundResult');
  result.hidden = state.phase === 'drawing' || !state.answerRevealed;
  byId('drawRevealedAnswer').textContent = state.revealedAnswer || '';
  setDrawToolsEnabled(state.phase === 'drawing');
  if (state.phase === 'round-result') byId('gameTurn').textContent = state.answerRevealed ? '答案已公布 · 等待下一题' : '时间到 · 等待主播公布答案';
  else if (state.phase === 'finished') byId('gameTurn').textContent = '五局结束 · 最终排行';
  else updateDrawCountdown();
}

function renderDrawDanmaku(items) {
  const root = byId('drawDanmakuFeed');
  if (!root) return;
  root.replaceChildren();
  const messages = Array.isArray(items) ? items : [];
  byId('drawDanmakuCount').textContent = `${messages.length} 条`;
  if (!messages.length) {
    root.append(createEmptyDrawItem('等待直播间弹幕…'));
    return;
  }
  messages.slice(-120).forEach(item => {
    const row = document.createElement('article');
    row.className = 'draw-danmaku-item';
    const avatar = document.createElement('div');
    avatar.className = 'draw-danmaku-avatar';
    if (item.avatarUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = item.avatarUrl;
      image.addEventListener('error', () => { image.remove(); avatar.textContent = String(item.name || '观').slice(0, 1); });
      avatar.append(image);
    } else avatar.textContent = String(item.name || '观').slice(0, 1);
    const body = document.createElement('div');
    body.className = 'draw-danmaku-body';
    const name = document.createElement('strong');
    name.textContent = item.name || '观众';
    const message = document.createElement('p');
    message.textContent = item.message || '';
    body.append(name, message);
    row.append(avatar, body);
    root.append(row);
  });
  root.scrollTop = root.scrollHeight;
}

function renderDrawScoreboard(scores) {
  const root = byId('drawScoreboard');
  root.replaceChildren();
  if (!scores.length) {
    root.append(createEmptyDrawItem('还没有观众得分'));
    return;
  }
  scores.slice(0, 6).forEach((player, index) => {
    root.append(createDrawListItem(index + 1, player.name, `${player.score} 分`));
  });
}

function renderDrawCorrectFeed(correct) {
  const root = byId('drawCorrectFeed');
  root.replaceChildren();
  if (!correct.length) {
    root.append(createEmptyDrawItem('等待第一条正确弹幕'));
    return;
  }
  correct.slice(0, 6).forEach(item => {
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

function updateDrawCountdown() {
  if (session?.game !== 'draw-guess' || session.state?.phase !== 'drawing' || !drawClock) return;
  const remaining = Math.max(0, drawClock.remainingMs - (performance.now() - drawClock.receivedAt));
  const seconds = Math.ceil(remaining / 1000);
  byId('gameTurn').textContent = `第 ${session.state.round} / ${session.state.totalRounds} 局 · ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function initDrawCanvas() {
  const canvas = byId('drawCanvas');
  redrawCanvas({ strokes: [] });
  document.querySelectorAll('[data-draw-color]').forEach(button => button.addEventListener('click', () => {
    drawColor = button.dataset.drawColor;
    drawEraser = false;
    byId('drawEraserBtn').setAttribute('aria-pressed', 'false');
    document.querySelectorAll('[data-draw-color]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  byId('drawEraserBtn').addEventListener('click', () => {
    drawEraser = !drawEraser;
    if (drawEraser) drawColor = '#ffffff';
    byId('drawEraserBtn').setAttribute('aria-pressed', String(drawEraser));
  });
  document.querySelectorAll('[data-draw-width]').forEach(button => button.addEventListener('click', () => {
    drawWidth = Number(button.dataset.drawWidth);
    document.querySelectorAll('[data-draw-width]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  byId('drawClearBtn').addEventListener('click', clearDrawCanvas);
  canvas.addEventListener('pointerdown', startDrawing);
  canvas.addEventListener('pointermove', continueDrawing);
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);
}

function startDrawing(event) {
  if (!canDraw() || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  const canvas = byId('drawCanvas');
  canvas.setPointerCapture(event.pointerId);
  const point = drawPointFromEvent(event);
  activeStroke = {
    pointerId: event.pointerId,
    strokeId: `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    color: drawColor,
    width: drawWidth,
    lastPoint: point,
    pendingPoints: [point]
  };
  drawCanvasPoints([point], drawColor, drawWidth);
  scheduleDrawFlush();
}

function continueDrawing(event) {
  if (!activeStroke || activeStroke.pointerId !== event.pointerId || !canDraw()) return;
  event.preventDefault();
  const point = drawPointFromEvent(event);
  if (Math.abs(point.x - activeStroke.lastPoint.x) + Math.abs(point.y - activeStroke.lastPoint.y) < 0.001) return;
  drawCanvasPoints([activeStroke.lastPoint, point], activeStroke.color, activeStroke.width);
  activeStroke.lastPoint = point;
  activeStroke.pendingPoints.push(point);
  if (activeStroke.pendingPoints.length >= 16) flushActiveStroke();
  else scheduleDrawFlush();
}

function stopDrawing(event) {
  if (!activeStroke || activeStroke.pointerId !== event.pointerId) return;
  event.preventDefault();
  flushActiveStroke();
  clearTimeout(drawFlushTimer);
  drawFlushTimer = null;
  activeStroke = null;
}

function scheduleDrawFlush() {
  clearTimeout(drawFlushTimer);
  drawFlushTimer = setTimeout(flushActiveStroke, 40);
}

function flushActiveStroke() {
  if (!activeStroke?.pendingPoints.length) return;
  clearTimeout(drawFlushTimer);
  drawFlushTimer = null;
  while (activeStroke?.pendingPoints.length) {
    const operation = {
      action: 'append',
      clientId: drawClientId,
      strokeId: activeStroke.strokeId,
      color: activeStroke.color,
      width: activeStroke.width,
      points: activeStroke.pendingPoints.splice(0, 32)
    };
    mergeDrawOperation(operation, false);
    queueDrawOperation(operation);
  }
}

function clearDrawCanvas() {
  if (!canDraw()) return;
  const operation = { action: 'clear', clientId: drawClientId };
  mergeDrawOperation(operation, true);
  queueDrawOperation(operation);
}

function queueDrawOperation(operation) {
  drawSendChain = drawSendChain.then(async () => {
    const response = await fetch('/api/games/session/draw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation)
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '画笔同步失败');
  }).catch(() => {
    byId('gameTurn').textContent = '画笔同步失败 · 正在恢复';
    loadSnapshot();
  });
}

function applyDrawBroadcast(operation) {
  if (!operation || session?.game !== 'draw-guess') return;
  if (operation.clientId === drawClientId) {
    if (session.state?.canvas) session.state.canvas.revision = operation.revision;
    return;
  }
  mergeDrawOperation(operation, true);
}

function mergeDrawOperation(operation, drawIncrement) {
  if (!session?.state?.canvas) return;
  const canvasState = session.state.canvas;
  if (operation.action === 'clear') {
    canvasState.strokes = [];
    canvasState.totalPoints = 0;
    canvasState.revision = Number(operation.revision) || canvasState.revision;
    redrawCanvas(canvasState);
    return;
  }
  if (operation.action !== 'append' || !Array.isArray(operation.points)) return;
  let stroke = canvasState.strokes.find(item => item.id === operation.strokeId);
  const previous = stroke?.points.at(-1) || null;
  if (!stroke) {
    stroke = { id: operation.strokeId, color: operation.color, width: operation.width, points: [] };
    canvasState.strokes.push(stroke);
  }
  stroke.points.push(...operation.points.map(point => ({ x: Number(point.x), y: Number(point.y) })));
  canvasState.totalPoints = (Number(canvasState.totalPoints) || 0) + operation.points.length;
  canvasState.revision = Number(operation.revision) || canvasState.revision;
  if (drawIncrement) drawCanvasPoints(previous ? [previous, ...operation.points] : operation.points, operation.color, operation.width);
}

function redrawCanvas(canvasState = {}) {
  const canvas = byId('drawCanvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of canvasState.strokes || []) drawCanvasPoints(stroke.points, stroke.color, stroke.width);
}

function drawCanvasPoints(points, color, width) {
  if (!Array.isArray(points) || !points.length) return;
  const canvas = byId('drawCanvas');
  const context = canvas.getContext('2d');
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Number(width) * 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x * canvas.width, points[0].y * canvas.height, Number(width), 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x * canvas.width, points[index].y * canvas.height);
  }
  context.stroke();
}

function drawPointFromEvent(event) {
  const rect = byId('drawCanvas').getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function setDrawToolsEnabled(enabled) {
  if (!enabled) {
    clearTimeout(drawFlushTimer);
    drawFlushTimer = null;
    activeStroke = null;
  }
  byId('drawCanvas').classList.toggle('is-disabled', !enabled);
  document.querySelectorAll('[data-draw-color], [data-draw-width], #drawClearBtn, #drawEraserBtn').forEach(button => {
    button.disabled = !enabled;
  });
}

function canDraw() {
  return session?.game === 'draw-guess' && session.state?.phase === 'drawing';
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

function showGameResult(winner, winnerIdentity = {}) {
  const resultEl = byId('gameResult');
  const textEl = byId('gameResultText');
  const winnerUid = String(winnerIdentity.uid || '').trim();
  if (!resultEl.hidden && resultEl.dataset.winner === winner && resultEl.dataset.winnerUid === winnerUid) return;
  const requestId = ++resultProfileRequest;
  resultEl.dataset.winner = winner;
  resultEl.dataset.winnerUid = winnerUid;
  textEl.textContent = winnerLabel(winner);
  resultEl.hidden = false;
  positionGameResult();
  hideGameResultAvatar();
  if (winner !== 'draw') void loadWinnerProfile(requestId, winner);
}

function positionGameResult() {
  const resultEl = byId('gameResult');
  if (!resultEl || resultEl.hidden) return;
  const target = document.body.dataset.game === 'gomoku'
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
    const response = await fetch('/api/games/winner-profile', { cache: 'no-store' });
    const payload = await response.json();
    if (!payload.ok || requestId !== resultProfileRequest) return;
    const profile = payload.data || {};
    const resultEl = byId('gameResult');
    if (resultEl.hidden || resultEl.dataset.winner !== winner) return;
    if (!profile.avatarUrl) return;
    const avatar = byId('gameResultAvatar');
    avatar.alt = `${turnLabel(winner)}头像`;
    avatar.src = profile.avatarUrl;
    avatar.hidden = false;
  } catch (_) {
    hideGameResultAvatar();
  }
}

function hideGameResult() {
  resultProfileRequest += 1;
  const resultEl = byId('gameResult');
  resultEl.hidden = true;
  resultEl.removeAttribute('style');
  delete resultEl.dataset.winner;
  delete resultEl.dataset.winnerUid;
  hideGameResultAvatar();
}

function hideGameResultAvatar() {
  const avatar = byId('gameResultAvatar');
  avatar.hidden = true;
  avatar.alt = '';
  avatar.removeAttribute('src');
}
