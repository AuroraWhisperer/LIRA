'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import { api, localOverlayOrigin, readJsonResponse, showError, toast } from '../shared/utils.js';
import { bindCopyUrl } from '../shared/copy-url.js';
import { createInteractionClient } from '../shared/interaction-client.js';
import { initWheelAdmin } from './games-wheel.js';
import { createDrawAdmin } from './games-draw-admin.js';

let initialized = false;
let interactionCollecting = false;
let activeGameSession = null;
let sessionRequest = 0;
let viewerRefreshPromise = null;
let viewerGeneration = 0;
let viewerRoomId = '';
let lastLiveConnectionKey = '';
let panelDataStale = false;
let drawAdmin = null;

const VIEWER_REFRESH_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

export function initGames() {
  if (initialized || !document.getElementById('gamesAdminPanel')) return;
  initialized = true;
  drawAdmin = createDrawAdmin({
    startSession,
    onSession: renderSession,
    onRefreshFailure: reportPanelRefreshFailure,
    onRefreshSuccess: clearPanelRefreshFailure,
  });
  bindCopyUrl(byId('gamesOverlayUrl'), {
    getUrl: overlayBaseUrl,
    onCopied: () => toast('游戏浏览器源地址已复制'),
    onError: showError,
  });
  byId('gamesOpenOverlayBtn').addEventListener('click', () => window.open(overlayBaseUrl(), '_blank', 'noopener'));
  byId('gamesRefreshViewersBtn').addEventListener('click', () => {
    requestViewerRefresh({ notify: true }).catch(showError);
  });
  byId('gamesStopBtn').addEventListener('click', () => stopGame().catch(showError));
  byId('numberBombMode').addEventListener('change', syncViewerMode);
  document.querySelectorAll('[data-start-game]').forEach((button) =>
    button.addEventListener('click', () => {
      startGame(button.dataset.startGame).catch(async () => {
        await refreshSession().catch(reportPanelRefreshFailure);
      });
    }),
  );
  const updateGame = event => {
    sessionRequest += 1;
    renderSession(event.detail);
    drawAdmin.refreshHostState().catch(reportPanelRefreshFailure);
  };
  const patchGame = event => {
    const patch = event.detail;
    if (patch.sessionId !== activeGameSession?.sessionId) {
      refreshSession().then(drawAdmin.refreshHostState).catch(reportPanelRefreshFailure);
      return;
    }
    if (patch.eventRevision <= activeGameSession.eventRevision) return;
    sessionRequest += 1;
    const phaseChanged = patch.state.phase !== activeGameSession.state.phase;
    renderSession({
      ...activeGameSession,
      eventRevision: patch.eventRevision,
      restartBlocked: patch.restartBlocked,
      state: { ...patch.state, canvas: activeGameSession.state.canvas },
    });
    if (phaseChanged) drawAdmin.refreshHostState().catch(reportPanelRefreshFailure);
  };
  window.addEventListener('app:game-update', updateGame);
  window.addEventListener('app:game-patch', patchGame);
  const offReconnect = eventBus.on('ws:connected', () => {
    drawAdmin.refreshCategories().catch(reportPanelRefreshFailure);
    refreshSession().then(drawAdmin.refreshHostState).catch(reportPanelRefreshFailure);
  });
  const offState = eventBus.on(Events.STATE_LOADED, ({ state }) => {
    const liveStatus = state?.liveStatus || {};
    const connectionKey = liveStatus.connected === true && liveStatus.roomId ? `${liveStatus.roomId}` : '';
    const connectionChanged = connectionKey !== lastLiveConnectionKey;
    lastLiveConnectionKey = connectionKey;
    if (connectionChanged) {
      viewerGeneration += 1;
      viewerRefreshPromise = null;
      viewerRoomId = '';
      for (const id of ['numberBombViewer', 'gomokuViewer']) renderViewerOptions(byId(id), []);
      byId('gamesViewerStatus').textContent = '暂无可选观众';
      byId('gamesRefreshViewersBtn').disabled = false;
      byId('gamesRefreshViewersBtn').classList.remove('is-loading');
      if (connectionKey) requestViewerRefresh({ notify: false }).catch(reportPanelRefreshFailure);
    }
  });
  const wheelRefresh = initWheelAdmin();
  const interactions = createInteractionClient({
    onState(state) {
      interactionCollecting = state.session?.phase === 'collecting';
      renderSession(activeGameSession);
      document.querySelectorAll('[data-start-game]').forEach((button) => {
        button.title = interactionCollecting ? '请先到「组件」结束投票或评分' : '';
      });
    },
    async fetchState() {
      const response = await fetch('/api/interactions/session', { cache: 'no-store' });
      const payload = await readJsonResponse(response, '读取互动状态失败');
      if (!payload.ok) throw new Error(payload.error || '读取互动状态失败');
      return payload.data;
    },
  });
  const receiveInteraction = (event) => interactions.receive(event.detail);
  window.addEventListener('app:interaction-update', receiveInteraction);
  const offInteractions = eventBus.on('ws:connected', () => {
    interactions.reset();
    interactions.load().catch(showError);
  });
  eventBus.once('app:shutdown', () => {
    window.removeEventListener('app:game-update', updateGame);
    window.removeEventListener('app:game-patch', patchGame);
    offReconnect();
    offState();
    drawAdmin.dispose();
    interactions.dispose();
    offInteractions?.();
    window.removeEventListener('app:interaction-update', receiveInteraction);
  });
  syncViewerMode();
  Promise.all([
    requestViewerRefresh({ notify: false }),
    refreshSession().then(drawAdmin.refreshHostState),
    drawAdmin.refreshCategories(),
    wheelRefresh,
    interactions.load(),
  ]).catch(showError);
}

function requestViewerRefresh(options = {}) {
  if (viewerRefreshPromise) return viewerRefreshPromise;
  const button = byId('gamesRefreshViewersBtn');
  const status = byId('gamesViewerStatus');
  button.disabled = true;
  button.classList.add('is-loading');
  status.textContent = '正在刷新观众名单…';
  const generation = viewerGeneration;
  viewerRefreshPromise = refreshViewers(options, generation).catch((error) => {
    if (generation !== viewerGeneration) return;
    const message = '观众名单刷新失败，请检查直播间连接后重试。';
    status.textContent = message;
    for (const id of ['numberBombViewer', 'gomokuViewer']) {
      const select = byId(id);
      if (select.options.length <= 1) {
        renderViewerOptions(select, []);
        select.options[0].textContent = '名单刷新失败，请重试';
      }
    }
    throw new Error(message, { cause: error });
  }).finally(() => {
    if (generation !== viewerGeneration) return;
    button.disabled = false;
    button.classList.remove('is-loading');
    viewerRefreshPromise = null;
  });
  return viewerRefreshPromise;
}

async function refreshViewers(options, generation) {
  const notify = options.notify === true;
  let viewers = [];
  let roomId;
  for (let attempt = 0; attempt <= VIEWER_REFRESH_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await wait(VIEWER_REFRESH_RETRY_DELAYS_MS[attempt - 1]);
    if (generation !== viewerGeneration) return;
    const response = await fetch('/api/games/viewers');
    const payload = await readJsonResponse(response, '读取观众名单失败');
    if (generation !== viewerGeneration) return;
    if (!payload.ok) throw new Error(payload.error || '读取观众名单失败');
    viewers = payload.data || [];
    roomId = payload.roomId ?? lastLiveConnectionKey;
    if (viewers.length > 0 || attempt === VIEWER_REFRESH_RETRY_DELAYS_MS.length) break;
  }
  for (const id of ['numberBombViewer', 'gomokuViewer']) {
    const select = byId(id);
    if (roomId !== viewerRoomId) select.value = '';
    renderViewerOptions(select, viewers);
  }
  viewerRoomId = roomId;
  byId('gamesViewerStatus').textContent = viewers.length ? `可选观众 ${viewers.length} 位` : '暂无可选观众';
  clearPanelRefreshFailure();
  if (notify) toast(`已找到 ${viewers.length} 位可选观众`);
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function renderViewerOptions(select, viewers) {
  const previous = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = viewers.length ? '请选择观众' : '暂无可选观众，请发弹幕后刷新';
  select.append(placeholder);
  for (const viewer of viewers) {
    const option = document.createElement('option');
    option.value = viewer.uid;
    option.dataset.name = viewer.name;
    option.textContent = viewer.name;
    select.append(option);
  }
  select.value = [...select.options].some((option) => option.value === previous) ? previous : '';
}

async function refreshSession() {
  const request = ++sessionRequest;
  const response = await fetch('/api/games/session');
  const payload = await readJsonResponse(response, '读取游戏状态失败');
  if (!payload.ok) throw new Error(payload.error || '读取游戏状态失败');
  if (request === sessionRequest) {
    renderSession(payload.data);
    clearPanelRefreshFailure();
  }
}

async function startGame(game) {
  if (game === 'draw-guess') return drawAdmin.start();
  const isBomb = game === 'number-bomb';
  const mode = isBomb ? byId('numberBombMode').value : 'single';
  const select = byId(isBomb ? 'numberBombViewer' : 'gomokuViewer');
  const option = select.selectedOptions[0];
  if (mode === 'single' && !select.value) return showError(new Error('请选择一位观众。'));
  return startSession({
    game,
    mode,
    ...(mode === 'single' && { viewerRoomId }),
    targetUid: mode === 'multi' ? '' : select.value,
    targetName: mode === 'multi' ? '直播间观众' : option?.dataset.name || '',
  });
}

async function startSession(config) {
  const request = ++sessionRequest;
  const result = await api('/api/games/session', config);
  // The start broadcast may arrive first, but its newer state must not be rolled back.
  if (request !== sessionRequest
    && (activeGameSession?.sessionId !== result.data.sessionId
      || activeGameSession.eventRevision > result.data.eventRevision)) return;
  renderSession(result.data);
  return result.data;
}

async function stopGame() {
  const request = ++sessionRequest;
  await api('/api/games/session', { action: 'stop', sessionId: activeGameSession.sessionId });
  if (request === sessionRequest) renderSession(null);
}

function renderSession(session) {
  if (session && session.sessionId === activeGameSession?.sessionId && session.eventRevision < activeGameSession.eventRevision) return;
  activeGameSession = session || null;
  const running = Boolean(session);
  const stop = byId('gamesStopBtn');
  stop.disabled = !running;
  stop.hidden = !running;
  const statusBar = byId('gamesStatusBar');
  if (statusBar) statusBar.classList.toggle('is-active', running);
  const badge = byId('gamesRunningBadge');
  if (badge) {
    badge.hidden = !running;
    if (running) badge.textContent = session.state?.winner || session.state?.phase === 'finished' ? '本局结束' : '进行中';
  }
  document.querySelectorAll('[data-start-game]').forEach((button) => {
    button.disabled = Boolean(session) || interactionCollecting;
    button.setAttribute('aria-disabled', String(button.disabled));
  });
  document.querySelectorAll('[data-game-card]').forEach((card) => {
    card.classList.toggle('is-running', card.dataset.gameCard === session?.game);
  });
  drawAdmin.syncSession(activeGameSession, interactionCollecting);
  renderDataFreshnessHint();
}

function sessionStatusText(session) {
  if (!session) return '当前没有进行中的游戏';
  const gameName = session.game === 'gomoku' ? '五子棋' : session.game === 'draw-guess' ? '你画我猜' : '数字炸弹';
  const opponent = session.mode === 'multi' ? '不限观众' : session.targetName || '指定观众';
  if (session.game === 'draw-guess' && session.state.phase === 'finished') return '你画我猜 · 本局结束';
  if (session.game === 'draw-guess' && session.state.phase === 'choosing') return '你画我猜 · 等待主播挑选题词';
  if (session.state.winner) {
    const result = session.state.winner === 'draw' ? '和棋' : session.state.winner === 'host' ? '主播获胜' : '观众获胜';
    return `${gameName} · ${result} · ${opponent}`;
  }
  return `${gameName}进行中 · ${opponent}`;
}

// 自动刷新失败时给出可恢复提示：同一次故障只改一次文案，成功后自行消失，不弹窗刷屏。
function renderDataFreshnessHint() {
  const status = byId('gamesSessionStatus');
  if (!status) return;
  const base = sessionStatusText(activeGameSession);
  status.textContent = panelDataStale ? `${base} · 数据可能已过期，正在重试` : base;
}

function reportPanelRefreshFailure() {
  if (panelDataStale) return;
  panelDataStale = true;
  renderDataFreshnessHint();
}

function clearPanelRefreshFailure() {
  if (!panelDataStale) return;
  panelDataStale = false;
  renderDataFreshnessHint();
}

function syncViewerMode() {
  const multi = byId('numberBombMode').value === 'multi';
  const picker = document.querySelector('[data-viewer-picker="number-bomb"]');
  picker.classList.toggle('is-disabled', multi);
  byId('numberBombViewer').disabled = multi;
}

function overlayBaseUrl() {
  return `${localOverlayOrigin()}/games`;
}

function byId(id) {
  return document.getElementById(id);
}
