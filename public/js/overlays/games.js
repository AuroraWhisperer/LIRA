import { createDanmakuFeed } from './danmaku-feed.js';
import { showConfirmationDialog } from '../shared/confirmation-dialog.js';

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
let drawDanmakuRenderTimer = null;
let pendingDrawDanmakuItems = null;
let drawDanmakuUpdateTimes = [];
let drawDanmakuLastRenderedAt = 0;
let drawDanmakuLastRenderDurationMs = 0;
let drawDanmakuFeed = null;

const drawClientId = `draw-${typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2)}`;

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
      medal: 'draw-danmaku-medal'
    }
  });
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
      initialSnapshotLoaded = true;
      clearTimeout(snapshotRetryTimer);
      renderGame(payload.session);
    }
    if (payload.type === 'game:draw') applyDrawBroadcast(payload.operation);
    if (payload.type === 'snapshot') {
      if (!payload.state || typeof payload.state !== 'object'
        || !Object.prototype.hasOwnProperty.call(payload.state, 'games')) return;
      initialSnapshotLoaded = true;
      clearTimeout(snapshotRetryTimer);
      renderGame(payload.state.games || null);
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
  if (!session || game !== 'draw-guess') resetDrawDanmakuRenderScheduler();
  byId('gameEmptyView').hidden = Boolean(session);
  byId('numberBombView').hidden = game !== 'number-bomb' || !session;
  byId('gomokuView').hidden = game !== 'gomoku' || !session;
  byId('drawGuessView').hidden = game !== 'draw-guess' || !session;
  if (!session) {
    setDrawToolsEnabled(false);
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
    const isPicked = value === state.lastGuess;
    button.className = `bomb-number ${isSafe ? 'is-safe' : 'is-unsafe'}${isPicked ? ' is-picked' : ''}`;
    button.textContent = String(value);
    button.disabled = value < state.min || value > state.max || Boolean(state.winner) || state.turn !== 'host';
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
  byId('drawMeta').textContent = '';
  byId('drawClue').textContent = state.phase === 'drawing'
    ? `${state.wordLength} 个字`
    : `答案 · ${state.revealedAnswer || '等待揭晓'}`;
  scheduleDrawDanmakuRender(session.danmaku || []);
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

function scheduleDrawDanmakuRender(items) {
  pendingDrawDanmakuItems = Array.isArray(items) ? items : [];
  const now = performance.now();
  drawDanmakuUpdateTimes.push(now);
  drawDanmakuUpdateTimes = drawDanmakuUpdateTimes.filter(timestamp => now - timestamp < 1000);
  if (drawDanmakuRenderTimer) return;
  const interval = getDrawDanmakuRenderInterval(now);
  const elapsed = drawDanmakuLastRenderedAt ? now - drawDanmakuLastRenderedAt : interval;
  const waitMs = Math.max(0, interval - elapsed);
  if (waitMs > 0) drawDanmakuRenderTimer = setTimeout(flushDrawDanmakuRender, waitMs);
  else flushDrawDanmakuRender();
}

function getDrawDanmakuRenderInterval(now = performance.now()) {
  const updatesPerSecond = drawDanmakuUpdateTimes.length;
  const renderWasRecentlySlow = drawDanmakuLastRenderedAt > 0
    && now - drawDanmakuLastRenderedAt < 1000;
  if (updatesPerSecond >= 20 || (renderWasRecentlySlow && drawDanmakuLastRenderDurationMs >= 16)) return 500;
  if (updatesPerSecond >= 8 || (renderWasRecentlySlow && drawDanmakuLastRenderDurationMs >= 8)) return 200;
  return 0;
}

function flushDrawDanmakuRender() {
  clearTimeout(drawDanmakuRenderTimer);
  drawDanmakuRenderTimer = null;
  if (!pendingDrawDanmakuItems) return;
  const items = pendingDrawDanmakuItems;
  pendingDrawDanmakuItems = null;
  const startedAt = performance.now();
  renderDrawDanmaku(items);
  drawDanmakuLastRenderedAt = performance.now();
  drawDanmakuLastRenderDurationMs = drawDanmakuLastRenderedAt - startedAt;
}

function resetDrawDanmakuRenderScheduler() {
  clearTimeout(drawDanmakuRenderTimer);
  drawDanmakuRenderTimer = null;
  pendingDrawDanmakuItems = null;
  drawDanmakuUpdateTimes = [];
  drawDanmakuLastRenderedAt = 0;
  drawDanmakuLastRenderDurationMs = 0;
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
    setActiveDrawTool(false);
    document.querySelectorAll('[data-draw-color]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  byId('drawPenBtn').addEventListener('click', () => setActiveDrawTool(false));
  byId('drawEraserBtn').addEventListener('click', () => setActiveDrawTool(true));
  document.querySelectorAll('[data-draw-width]').forEach(button => button.addEventListener('click', () => {
    setDrawWidth(Number(button.dataset.drawWidth));
  }));
  byId('drawUndoBtn').addEventListener('click', undoLastDrawStroke);
  byId('drawClearBtn').addEventListener('click', clearDrawCanvas);
  document.addEventListener('keydown', handleDrawShortcut);
  canvas.addEventListener('pointerdown', startDrawing);
  canvas.addEventListener('pointermove', continueDrawing);
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);
}

function setActiveDrawTool(useEraser) {
  drawEraser = Boolean(useEraser);
  byId('drawCanvas').classList.toggle('is-eraser', drawEraser);
  byId('drawPenBtn').setAttribute('aria-pressed', String(!drawEraser));
  byId('drawEraserBtn').setAttribute('aria-pressed', String(drawEraser));
}

function setDrawWidth(width) {
  const nextWidth = Number(width);
  if (![2, 4, 8, 12].includes(nextWidth)) return;
  drawWidth = nextWidth;
  document.querySelectorAll('[data-draw-width]').forEach(item => {
    item.setAttribute('aria-pressed', String(Number(item.dataset.drawWidth) === drawWidth));
  });
}

function stepDrawWidth(direction) {
  const widths = [...document.querySelectorAll('[data-draw-width]')]
    .map(button => Number(button.dataset.drawWidth))
    .filter(width => Number.isFinite(width));
  const currentIndex = Math.max(0, widths.indexOf(drawWidth));
  const nextIndex = Math.max(0, Math.min(widths.length - 1, currentIndex + direction));
  setDrawWidth(widths[nextIndex]);
}

function handleDrawShortcut(event) {
  if (!canDraw() || isDrawTextInput(event.target) || event.target?.closest?.('.lira-confirm-backdrop')) return;
  const key = String(event.key || '').toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z') {
    event.preventDefault();
    undoLastDrawStroke();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (key === 'b') {
    event.preventDefault();
    setActiveDrawTool(false);
  } else if (key === 'e') {
    event.preventDefault();
    setActiveDrawTool(true);
  } else if (key === '[') {
    event.preventDefault();
    stepDrawWidth(-1);
  } else if (key === ']') {
    event.preventDefault();
    stepDrawWidth(1);
  }
}

function isDrawTextInput(target) {
  const tagName = String(target?.tagName || '').toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || Boolean(target?.isContentEditable);
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
    color: drawEraser ? '#ffffff' : drawColor,
    width: drawWidth,
    lastPoint: point,
    pendingPoints: [point]
  };
  drawCanvasPoints([point], activeStroke.color, drawWidth);
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
  finalizeActiveStroke();
}

function finalizeActiveStroke() {
  if (!activeStroke) return;
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

async function clearDrawCanvas() {
  if (!canDraw()) return;
  finalizeActiveStroke();
  if (!session.state.canvas.strokes.length) return;
  const confirmed = await showConfirmationDialog({
    variant: 'caution',
    title: '清空当前画布？',
    description: '当前画布上的所有笔画都会被移除，且会同步到其他游戏网页。',
    confirmLabel: '清空画布',
    cancelLabel: '取消'
  });
  if (!confirmed || !canDraw()) return;
  const operation = { action: 'clear', clientId: drawClientId };
  mergeDrawOperation(operation, true);
  queueDrawOperation(operation);
}

function undoLastDrawStroke() {
  if (!canDraw()) return;
  finalizeActiveStroke();
  if (!session.state.canvas.strokes.length) return;
  const operation = { action: 'undo', clientId: drawClientId };
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
    syncDrawUndoState();
    return;
  }
  if (operation.action === 'undo') {
    const strokeIndex = canvasState.strokes.findIndex(stroke => stroke.id === operation.strokeId);
    if (strokeIndex >= 0) {
      canvasState.totalPoints = Math.max(0, canvasState.totalPoints - canvasState.strokes[strokeIndex].points.length);
      canvasState.strokes.splice(strokeIndex, 1);
      redrawCanvas(canvasState);
    }
    canvasState.revision = Number(operation.revision) || canvasState.revision;
    syncDrawUndoState();
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
  syncDrawUndoState();
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
  document.querySelectorAll('[data-draw-color], [data-draw-width], #drawClearBtn, #drawUndoBtn, #drawPenBtn, #drawEraserBtn').forEach(button => {
    button.disabled = !enabled;
  });
  syncDrawUndoState();
}

function syncDrawUndoState() {
  const button = byId('drawUndoBtn');
  if (!button) return;
  button.disabled = !canDraw() || !session?.state?.canvas?.strokes?.length;
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
    const token = window.__API_TOKEN__;
    const response = await fetch('/api/games/winner-profile', {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
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

function avatarSource(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const token = String(window.__API_TOKEN__ || '');
  return `/api/bilibili/avatar?url=${encodeURIComponent(source)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}
