'use strict';

import { api, copyText, localOverlayOrigin, readJsonResponse, showError, toast } from '../shared/utils.js';

let initialized = false;
let currentSession = null;

export function initGames() {
  if (initialized || !document.getElementById('gamesAdminPanel')) return;
  initialized = true;
  byId('gamesOverlayUrl').value = overlayBaseUrl();
  byId('gamesCopyBaseUrlBtn').addEventListener('click', () => copyUrl(overlayBaseUrl()));
  byId('gamesOpenOverlayBtn').addEventListener('click', () => window.open(overlayUrl(currentSession?.game || 'number-bomb'), '_blank', 'noopener'));
  byId('gamesRefreshViewersBtn').addEventListener('click', () => refreshViewers().catch(showError));
  byId('gamesStopBtn').addEventListener('click', () => stopGame().catch(showError));
  byId('numberBombMode').addEventListener('change', syncViewerMode);
  document.querySelectorAll('[data-start-game]').forEach(button => button.addEventListener('click', () => {
    startGame(button.dataset.startGame).catch(showError);
  }));
  document.querySelectorAll('[data-copy-game]').forEach(button => button.addEventListener('click', () => {
    copyUrl(overlayUrl(button.dataset.copyGame));
  }));
  window.addEventListener('app:game-update', event => renderSession(event.detail));
  syncViewerMode();
  Promise.all([refreshViewers(), refreshSession()]).catch(showError);
}

async function refreshViewers() {
  const response = await fetch('/api/games/viewers');
  const payload = await readJsonResponse(response, '读取在线观众失败');
  if (!payload.ok) throw new Error(payload.error || '读取在线观众失败');
  for (const id of ['numberBombViewer', 'gomokuViewer']) renderViewerOptions(byId(id), payload.data || []);
  toast(`已找到 ${(payload.data || []).length} 位最近在线观众`);
}

function renderViewerOptions(select, viewers) {
  const previous = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = viewers.length ? '请选择观众' : '暂无可选观众（等待弹幕）';
  select.append(placeholder);
  for (const viewer of viewers) {
    const option = document.createElement('option');
    option.value = viewer.uid;
    option.dataset.name = viewer.name;
    option.textContent = `${viewer.name} · UID ${viewer.uid}`;
    select.append(option);
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

async function refreshSession() {
  const response = await fetch('/api/games/session');
  const payload = await readJsonResponse(response, '读取游戏状态失败');
  if (!payload.ok) throw new Error(payload.error || '读取游戏状态失败');
  renderSession(payload.data);
}

async function startGame(game) {
  const isBomb = game === 'number-bomb';
  const mode = isBomb ? byId('numberBombMode').value : 'single';
  const select = byId(isBomb ? 'numberBombViewer' : 'gomokuViewer');
  const option = select.selectedOptions[0];
  const result = await api('/api/games/session', {
    game,
    mode,
    targetUid: mode === 'multi' ? '' : select.value,
    targetName: mode === 'multi' ? '直播间观众' : (option?.dataset.name || '')
  });
  renderSession(result.data);
  window.open(overlayUrl(game), '_blank', 'noopener');
  toast(`${game === 'gomoku' ? '五子棋' : '数字炸弹'}已开始`);
}

async function stopGame() {
  await api('/api/games/session', { action: 'stop' });
  renderSession(null);
  toast('游戏已结束');
}

function renderSession(session) {
  currentSession = session || null;
  const status = byId('gamesSessionStatus');
  const stop = byId('gamesStopBtn');
  stop.disabled = !session;
  document.querySelectorAll('[data-game-card]').forEach(card => {
    card.classList.toggle('is-running', card.dataset.gameCard === session?.game);
  });
  if (!session) {
    status.textContent = '当前没有进行中的游戏';
    return;
  }
  const gameName = session.game === 'gomoku' ? '五子棋' : '数字炸弹';
  const opponent = session.mode === 'multi' ? '不限观众' : (session.targetName || `UID ${session.targetUid}`);
  status.textContent = `${gameName}进行中 · ${opponent}`;
}

function syncViewerMode() {
  const multi = byId('numberBombMode').value === 'multi';
  const picker = document.querySelector('[data-viewer-picker="number-bomb"]');
  picker.classList.toggle('is-disabled', multi);
  byId('numberBombViewer').disabled = multi;
}

async function copyUrl(url) {
  await copyText(url);
  toast('游戏网页地址已复制');
}

function overlayUrl(game) {
  return `${localOverlayOrigin()}/games?game=${encodeURIComponent(game)}`;
}

function overlayBaseUrl() {
  return `${localOverlayOrigin()}/games`;
}

function byId(id) { return document.getElementById(id); }
