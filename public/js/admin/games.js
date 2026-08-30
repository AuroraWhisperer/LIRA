'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import {
  api,
  copyText,
  localOverlayOrigin,
  readJsonResponse,
  showError,
  toast,
} from '../shared/utils.js';
import { initWheelAdmin } from './games-wheel.js';

let initialized = false;
let activeGameSession = null;
let drawClock = null;
let drawClockTimer = null;
let drawWordCategories = [];
let activeDrawCategoryIds = null;
let viewerRefreshPromise = null;
let lastLiveConnectionKey = '';

const VIEWER_REFRESH_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

export function initGames() {
  if (initialized || !document.getElementById('gamesAdminPanel')) return;
  initialized = true;
  byId('gamesOverlayUrl').value = overlayBaseUrl();
  byId('gamesCopyBaseUrlBtn').addEventListener('click', () =>
    copyUrl(overlayBaseUrl()),
  );
  byId('gamesOpenOverlayBtn').addEventListener('click', () =>
    window.open(overlayBaseUrl(), '_blank', 'noopener'),
  );
  byId('gamesRefreshViewersBtn').addEventListener('click', () => {
    requestViewerRefresh({ notify: true }).catch(showError);
  });
  byId('gamesStopBtn').addEventListener('click', () =>
    stopGame().catch(showError),
  );
  byId('drawCardTrigger').addEventListener('click', toggleDrawDetails);
  byId('drawFinishRoundBtn').addEventListener('click', () =>
    controlDrawRound('finish-round').catch(showError),
  );
  byId('drawRevealAnswerBtn').addEventListener('click', () =>
    controlDrawRound('reveal-answer').catch(showError),
  );
  byId('drawNextRoundBtn').addEventListener('click', () =>
    controlDrawRound('next-round').catch(showError),
  );
  byId('drawSelectAllCategoriesBtn').addEventListener('click', () =>
    setAllDrawCategories(true),
  );
  byId('drawClearCategoriesBtn').addEventListener('click', () =>
    setAllDrawCategories(false),
  );
  byId('numberBombMode').addEventListener('change', syncViewerMode);
  document.querySelectorAll('[data-start-game]').forEach((button) =>
    button.addEventListener('click', () => {
      startGame(button.dataset.startGame).catch(async () => {
        await refreshSession().catch(() => {});
      });
    }),
  );
  window.addEventListener('app:game-update', (event) => {
    renderSession(event.detail);
    refreshHostState().catch(() => {});
  });
  eventBus.on(Events.STATE_LOADED, ({ state }) => {
    const liveStatus = state?.liveStatus || {};
    const connectionKey =
      liveStatus.connected === true && liveStatus.roomId
        ? `${liveStatus.roomId}`
        : '';
    const connectionChanged = connectionKey !== lastLiveConnectionKey;
    lastLiveConnectionKey = connectionKey;
    if (connectionChanged && connectionKey) {
      requestViewerRefresh({ notify: false }).catch(() => {});
    }
  });
  const wheelRefresh = initWheelAdmin();
  syncViewerMode();
  window.addEventListener('app:shutdown', stopDrawClockTimer, { once: true });
  Promise.all([
    requestViewerRefresh({ notify: false }),
    refreshSession(),
    refreshHostState(),
    refreshDrawCategories(),
    wheelRefresh,
  ]).catch(showError);
}

function requestViewerRefresh(options = {}) {
  if (viewerRefreshPromise) return viewerRefreshPromise;
  viewerRefreshPromise = refreshViewers(options).finally(() => {
    viewerRefreshPromise = null;
  });
  return viewerRefreshPromise;
}

async function refreshViewers(options = {}) {
  const notify = options.notify === true;
  let viewers = [];
  for (
    let attempt = 0;
    attempt <= VIEWER_REFRESH_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    if (attempt > 0) await wait(VIEWER_REFRESH_RETRY_DELAYS_MS[attempt - 1]);
    const response = await fetch('/api/games/viewers');
    const payload = await readJsonResponse(response, '读取在线观众失败');
    if (!payload.ok) throw new Error(payload.error || '读取在线观众失败');
    viewers = payload.data || [];
    if (viewers.length > 0 || attempt === VIEWER_REFRESH_RETRY_DELAYS_MS.length)
      break;
  }
  for (const id of ['numberBombViewer', 'gomokuViewer'])
    renderViewerOptions(byId(id), viewers);
  if (notify) toast(`已找到 ${viewers.length} 位当前在线观众`);
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function renderViewerOptions(select, viewers) {
  const previous = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = viewers.length ? '请选择观众' : '暂无当前在线观众';
  select.append(placeholder);
  for (const viewer of viewers) {
    const option = document.createElement('option');
    option.value = viewer.uid;
    option.dataset.name = viewer.name;
    option.textContent = viewer.name;
    select.append(option);
  }
  if ([...select.options].some((option) => option.value === previous))
    select.value = previous;
}

async function refreshSession() {
  const response = await fetch('/api/games/session');
  const payload = await readJsonResponse(response, '读取游戏状态失败');
  if (!payload.ok) throw new Error(payload.error || '读取游戏状态失败');
  renderSession(payload.data);
}

async function refreshHostState() {
  const response = await fetch('/api/games/host-state', { cache: 'no-store' });
  const payload = await readJsonResponse(response, '读取你画我猜题词失败');
  if (!payload.ok) throw new Error(payload.error || '读取你画我猜题词失败');
  renderHostState(payload.data);
}

async function refreshDrawCategories() {
  const response = await fetch('/api/games/draw-guess/categories', {
    cache: 'no-store',
  });
  const payload = await readJsonResponse(response, '读取你画我猜词库失败');
  if (!payload.ok) throw new Error(payload.error || '读取你画我猜词库失败');
  renderDrawCategories(payload.data || []);
}

function renderDrawCategories(categories) {
  drawWordCategories = categories.filter(
    (category) => category?.id && category?.label && Number(category.count) > 0,
  );
  const root = byId('drawWordCategories');
  root.replaceChildren();
  const selected = activeDrawCategoryIds
    ? new Set(activeDrawCategoryIds)
    : null;
  for (const category of drawWordCategories) {
    const label = document.createElement('label');
    label.className = 'draw-word-category';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(category.id);
    input.checked = selected ? selected.has(input.value) : true;
    input.dataset.drawCategory = '';
    input.addEventListener('change', updateDrawCategoryStatus);
    const name = document.createElement('strong');
    name.textContent = String(category.label);
    const count = document.createElement('span');
    count.textContent = `${Number(category.count)} 词`;
    label.append(input, name, count);
    root.append(label);
  }
  setDrawCategoryControlsDisabled(Boolean(activeGameSession));
  updateDrawCategoryStatus();
}

function readSelectedDrawCategoryIds() {
  return [...document.querySelectorAll('[data-draw-category]:checked')].map(
    (input) => input.value,
  );
}

function setAllDrawCategories(selected) {
  document.querySelectorAll('[data-draw-category]').forEach((input) => {
    input.checked = selected;
  });
  updateDrawCategoryStatus();
}

function updateDrawCategoryStatus() {
  const selectedIds = new Set(readSelectedDrawCategoryIds());
  const wordCount = drawWordCategories.reduce(
    (total, category) =>
      selectedIds.has(String(category.id))
        ? total + Number(category.count)
        : total,
    0,
  );
  byId('drawWordCategoryStatus').textContent = drawWordCategories.length
    ? `已选 ${selectedIds.size} / ${drawWordCategories.length} 类 · ${wordCount} 词`
    : '暂时没有可用分类';
  syncDrawStartAvailability();
}

function setDrawCategoryControlsDisabled(disabled) {
  document.querySelectorAll('[data-draw-category]').forEach((input) => {
    input.disabled = disabled;
    input
      .closest('.draw-word-category')
      ?.classList.toggle('is-disabled', disabled);
  });
  byId('drawSelectAllCategoriesBtn').disabled = disabled;
  byId('drawClearCategoriesBtn').disabled = disabled;
}

function syncDrawStartAvailability() {
  const button = document.querySelector('[data-start-game="draw-guess"]');
  if (!button) return;
  const disabled =
    Boolean(activeGameSession) ||
    !drawWordCategories.length ||
    !readSelectedDrawCategoryIds().length;
  button.disabled = disabled;
  button.setAttribute('aria-disabled', String(disabled));
}

async function startGame(game) {
  if (game === 'draw-guess') {
    const categoryIds = readSelectedDrawCategoryIds();
    if (!categoryIds.length) throw new Error('请至少选择一个词库分类。');
    const result = await api('/api/games/session', {
      game,
      totalRounds: Number(byId('drawTotalRounds').value),
      roundDurationSeconds: Number(byId('drawRoundDuration').value),
      categoryIds,
    });
    renderSession(result.data);
    await refreshHostState();
    setDrawDetails(true);
    toast('你画我猜已开始');
    return;
  }
  const isBomb = game === 'number-bomb';
  const mode = isBomb ? byId('numberBombMode').value : 'single';
  const select = byId(isBomb ? 'numberBombViewer' : 'gomokuViewer');
  const option = select.selectedOptions[0];
  const result = await api('/api/games/session', {
    game,
    mode,
    targetUid: mode === 'multi' ? '' : select.value,
    targetName: mode === 'multi' ? '直播间观众' : option?.dataset.name || '',
  });
  renderSession(result.data);
  toast(`${game === 'gomoku' ? '五子棋' : '数字炸弹'}已开始`);
}

async function stopGame() {
  await api('/api/games/session', { action: 'stop' });
  renderSession(null);
  renderHostState(null);
  toast('游戏已结束');
}

async function controlDrawRound(action) {
  const result = await api('/api/games/session/move', { value: { action } });
  renderSession(result.data);
  await refreshHostState();
  toast(
    action === 'finish-round'
      ? '作画已结束，请公布答案'
      : action === 'reveal-answer'
        ? '答案已公布'
        : '下一题已开始',
  );
}

function toggleDrawDetails() {
  setDrawDetails(byId('drawCardDetails').hidden);
}

function setDrawDetails(expanded) {
  const card = document.querySelector('[data-draw-card]');
  const details = byId('drawCardDetails');
  details.hidden = !expanded;
  card.classList.toggle('is-collapsed', !expanded);
  byId('drawCardTrigger').setAttribute('aria-expanded', String(expanded));
}

function renderSession(session) {
  activeGameSession = session || null;
  syncDrawClockTimer();
  const status = byId('gamesSessionStatus');
  const stop = byId('gamesStopBtn');
  stop.disabled = !session;
  document.querySelectorAll('[data-start-game]').forEach((button) => {
    button.disabled = Boolean(session);
    button.setAttribute('aria-disabled', String(Boolean(session)));
  });
  document.querySelectorAll('[data-draw-setting]').forEach((label) => {
    label.classList.toggle('is-disabled', Boolean(session));
    label.querySelector('input').disabled = Boolean(session);
  });
  setDrawCategoryControlsDisabled(Boolean(session));
  document.querySelectorAll('[data-game-card]').forEach((card) => {
    card.classList.toggle(
      'is-running',
      card.dataset.gameCard === session?.game,
    );
  });
  syncDrawStartAvailability();
  renderDrawSession(session);
  if (!session) {
    status.textContent = '当前没有进行中的游戏';
    return;
  }
  const gameName =
    session.game === 'gomoku'
      ? '五子棋'
      : session.game === 'draw-guess'
        ? '你画我猜'
        : '数字炸弹';
  const opponent =
    session.mode === 'multi' ? '不限观众' : session.targetName || '指定观众';
  status.textContent = `${gameName}进行中 · ${opponent}`;
}

function renderDrawSession(session) {
  const drawSession = session?.game === 'draw-guess' ? session : null;
  const state = drawSession?.state;
  byId('drawFinishRoundBtn').disabled = state?.phase !== 'drawing';
  byId('drawRevealAnswerBtn').disabled =
    state?.phase !== 'round-result' || Boolean(state.answerRevealed);
  byId('drawNextRoundBtn').disabled =
    state?.phase !== 'round-result' || !state.answerRevealed;
  if (!state) {
    drawClock = null;
    byId('drawCardStatus').textContent = '自定义赛制 · 1–12 局 · 15–300 秒';
    byId('drawHostRound').textContent = '等待开局';
    byId('drawHostStatus').textContent = '开始游戏后即可作画';
    byId('drawHostClock').textContent = '01:30';
    return;
  }
  setDrawDetails(true);
  byId('drawTotalRounds').value = String(state.totalRounds);
  byId('drawRoundDuration').value = String(
    Math.round(state.roundDurationMs / 1000),
  );
  drawClock = {
    remainingMs: Number(state.remainingMs) || 0,
    receivedAt: performance.now(),
  };
  byId('drawHostRound').textContent =
    `第 ${state.round} / ${state.totalRounds} 局 · ${state.category} · ${state.wordLength} 个字`;
  if (state.phase === 'drawing') {
    byId('drawCardStatus').textContent =
      `第 ${state.round} 局进行中 · ${state.correct.length} 人答对`;
    byId('drawHostStatus').textContent = '请在游戏网页作画，题词仅在这里显示';
  } else if (state.phase === 'round-result') {
    byId('drawHostClock').textContent = '--:--';
    byId('drawCardStatus').textContent = state.answerRevealed
      ? `第 ${state.round} 局结束 · 答案已公布：${state.revealedAnswer}`
      : `第 ${state.round} 局结束 · 等待主播公布答案`;
    byId('drawHostStatus').textContent = state.answerRevealed
      ? '可以开始下一题'
      : '时间到，弹幕仍在收集且不计分';
  } else {
    byId('drawHostClock').textContent = '--:--';
    const champion = state.scores[0];
    byId('drawCardStatus').textContent = champion
      ? `比赛结束 · ${champion.name} ${champion.score} 分`
      : '比赛结束 · 本场无人得分';
    byId('drawHostStatus').textContent =
      '最终排行已显示在游戏网页，可结束当前游戏';
  }
  updateDrawClock();
}

function renderHostState(state) {
  const visible =
    state?.game === 'draw-guess' && activeGameSession?.game === 'draw-guess';
  if (visible && Array.isArray(state.categoryIds) && state.categoryIds.length) {
    activeDrawCategoryIds = state.categoryIds.map(String);
    document.querySelectorAll('[data-draw-category]').forEach((input) => {
      input.checked = activeDrawCategoryIds.includes(input.value);
    });
    updateDrawCategoryStatus();
  }
  byId('drawHostWord').textContent = visible
    ? state.word
    : '开始游戏后显示题词';
}

function updateDrawClock() {
  if (
    activeGameSession?.game !== 'draw-guess' ||
    activeGameSession.state?.phase !== 'drawing' ||
    !drawClock
  )
    return;
  const elapsed = performance.now() - drawClock.receivedAt;
  const remaining = Math.max(0, drawClock.remainingMs - elapsed);
  const totalSeconds = Math.ceil(remaining / 1000);
  byId('drawHostClock').textContent =
    `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function syncDrawClockTimer() {
  const active =
    activeGameSession?.game === 'draw-guess' &&
    activeGameSession.state?.phase === 'drawing';
  if (!active) {
    stopDrawClockTimer();
    return;
  }
  if (drawClockTimer === null) {
    drawClockTimer = setInterval(updateDrawClock, 250);
  }
}

function stopDrawClockTimer() {
  if (drawClockTimer !== null) {
    clearInterval(drawClockTimer);
    drawClockTimer = null;
  }
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

function overlayBaseUrl() {
  return `${localOverlayOrigin()}/games`;
}

function byId(id) {
  return document.getElementById(id);
}
