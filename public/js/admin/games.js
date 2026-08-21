'use strict';

import { api, copyText, localOverlayOrigin, readJsonResponse, showError, toast } from '../shared/utils.js';

let initialized = false;
let wheelState = null;
let wheelLimits = null;
let activeGameSession = null;
let drawClock = null;
let drawClockTimer = null;

export function initGames() {
  if (initialized || !document.getElementById('gamesAdminPanel')) return;
  initialized = true;
  byId('gamesOverlayUrl').value = overlayBaseUrl();
  byId('gamesCopyBaseUrlBtn').addEventListener('click', () => copyUrl(overlayBaseUrl()));
  byId('gamesOpenOverlayBtn').addEventListener('click', () => window.open(overlayBaseUrl(), '_blank', 'noopener'));
  byId('gamesRefreshViewersBtn').addEventListener('click', () => refreshViewers().catch(showError));
  byId('gamesStopBtn').addEventListener('click', () => stopGame().catch(showError));
  byId('wheelCardTrigger').addEventListener('click', toggleWheelDetails);
  byId('drawCardTrigger').addEventListener('click', toggleDrawDetails);
  byId('drawFinishRoundBtn').addEventListener('click', () => controlDrawRound('finish-round').catch(showError));
  byId('drawRevealAnswerBtn').addEventListener('click', () => controlDrawRound('reveal-answer').catch(showError));
  byId('drawNextRoundBtn').addEventListener('click', () => controlDrawRound('next-round').catch(showError));
  byId('wheelCopyUrlBtn').addEventListener('click', () => copyWheelUrl(wheelOverlayUrl()));
  byId('wheelOpenUrlBtn').addEventListener('click', () => window.open(wheelOverlayUrl(), '_blank', 'noopener'));
  byId('wheelAddEntryBtn').addEventListener('click', addWheelEntry);
  byId('wheelSaveBtn').addEventListener('click', () => saveWheel().catch(showError));
  byId('wheelSpinBtn').addEventListener('click', () => spinWheel().catch(showError));
  byId('numberBombMode').addEventListener('change', syncViewerMode);
  document.querySelectorAll('[data-start-game]').forEach(button => button.addEventListener('click', () => {
    startGame(button.dataset.startGame).catch(async () => {
      await refreshSession().catch(() => {});
    });
  }));
  window.addEventListener('app:game-update', event => {
    renderSession(event.detail);
    refreshHostState().catch(() => {});
  });
  window.addEventListener('app:wheel-update', event => renderWheelState(event.detail));
  byId('wheelOverlayUrl').value = wheelOverlayUrl();
  syncViewerMode();
  window.addEventListener('app:shutdown', stopDrawClockTimer, { once: true });
  Promise.all([refreshViewers(), refreshSession(), refreshHostState(), refreshWheel()]).catch(showError);
}

async function refreshViewers() {
  const response = await fetch('/api/games/viewers');
  const payload = await readJsonResponse(response, '读取在线观众失败');
  if (!payload.ok) throw new Error(payload.error || '读取在线观众失败');
  for (const id of ['numberBombViewer', 'gomokuViewer']) renderViewerOptions(byId(id), payload.data || []);
  toast(`已找到 ${(payload.data || []).length} 位当前在线观众`);
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
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
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

async function refreshWheel() {
  const response = await fetch('/api/wheel');
  const payload = await readJsonResponse(response, '读取转盘设置失败');
  if (!payload.ok) throw new Error(payload.error || '读取转盘设置失败');
  renderWheelState(payload.data, { syncEntries: true });
}

async function startGame(game) {
  if (game === 'draw-guess') {
    const result = await api('/api/games/session', {
      game,
      totalRounds: Number(byId('drawTotalRounds').value),
      roundDurationSeconds: Number(byId('drawRoundDuration').value)
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
    targetName: mode === 'multi' ? '直播间观众' : (option?.dataset.name || '')
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
  toast(action === 'finish-round' ? '作画已结束，请公布答案' : action === 'reveal-answer' ? '答案已公布' : '下一题已开始');
}

function renderWheelState(state, options = {}) {
  wheelState = state || { entries: [], totalWeight: 0, spin: null, lastResult: null };
  if (state?.limits) wheelLimits = state.limits;
  if (options.syncEntries) renderWheelEntries(wheelState.entries || []);
  const spinning = Boolean(wheelState.spin);
  const entryCount = (wheelState.entries || []).length;
  const canSpin = Boolean(wheelLimits) && entryCount >= wheelLimits.minEntries && !spinning;
  byId('wheelSpinBtn').disabled = !canSpin;
  byId('wheelSaveBtn').disabled = spinning;
  byId('wheelAddEntryBtn').disabled = spinning || !wheelLimits || entryCount >= wheelLimits.maxEntries;
  byId('wheelStatus').textContent = spinning
    ? '转盘正在转动…'
    : wheelState.lastResult?.label
      ? `上次抽中：${wheelState.lastResult.label}`
      : canSpin ? '设置已就绪，可以开始转动' : '至少配置两个选项后开始';
  byId('wheelCardResult').textContent = spinning
    ? '转盘转动中…'
    : wheelState.lastResult?.label
      ? `抽中：${wheelState.lastResult.label}`
      : '尚未抽取';
  byId('wheelTotalWeight').textContent = `总份数 ${Number(wheelState.totalWeight) || 0}`;
  document.querySelector('[data-wheel-card]').classList.toggle('is-running', spinning);
}

function toggleWheelDetails() {
  const card = document.querySelector('[data-wheel-card]');
  const details = byId('wheelCardDetails');
  const trigger = byId('wheelCardTrigger');
  const expanded = details.hidden;
  details.hidden = !expanded;
  card.classList.toggle('is-collapsed', !expanded);
  trigger.setAttribute('aria-expanded', String(expanded));
  if (expanded) byId('wheelEntries').querySelector('.wheel-label-input')?.focus();
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

function renderWheelEntries(entries) {
  if (!wheelLimits) return;
  const root = byId('wheelEntries');
  root.replaceChildren();
  const values = entries.length
    ? entries
    : Array.from({ length: wheelLimits.minEntries }, () => ({ label: '', weight: wheelLimits.minWeight }));
  values.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'wheel-entry-row';
    const label = document.createElement('label');
    label.textContent = `内容 ${index + 1}`;
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.maxLength = wheelLimits.maxLabelLength;
    labelInput.className = 'wheel-label-input';
    labelInput.value = String(entry.label || '');
    labelInput.placeholder = '例如：唱一首歌';
    label.append(labelInput);
    const weight = document.createElement('label');
    weight.textContent = '份数';
    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.min = String(wheelLimits.minWeight);
    weightInput.max = String(wheelLimits.maxWeight);
    weightInput.step = '1';
    weightInput.className = 'wheel-weight-input';
    weightInput.value = String(Number(entry.weight) || wheelLimits.minWeight);
    weight.append(weightInput);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary wheel-remove-entry';
    remove.textContent = '删除';
    remove.disabled = values.length <= wheelLimits.minEntries;
    remove.addEventListener('click', () => {
      row.remove();
      renumberWheelEntries();
      updateWheelTotal();
    });
    labelInput.addEventListener('input', updateWheelTotal);
    weightInput.addEventListener('input', updateWheelTotal);
    row.append(label, weight, remove);
    root.append(row);
  });
  updateWheelTotal();
}

function addWheelEntry() {
  if (!wheelLimits) return;
  const rows = byId('wheelEntries').children;
  if (rows.length >= wheelLimits.maxEntries) return;
  const entries = readWheelEntries();
  entries.push({ label: '', weight: wheelLimits.minWeight });
  renderWheelEntries(entries);
}

function renumberWheelEntries() {
  [...byId('wheelEntries').children].forEach((row, index) => {
    row.querySelector('label').firstChild.textContent = `内容 ${index + 1}`;
    row.querySelectorAll('button').forEach(button => {
      button.disabled = byId('wheelEntries').children.length <= wheelLimits.minEntries;
    });
  });
}

function readWheelEntries() {
  return [...byId('wheelEntries').children].map(row => ({
    label: row.querySelector('.wheel-label-input').value.trim(),
    weight: Number(row.querySelector('.wheel-weight-input').value)
  }));
}

function updateWheelTotal() {
  const total = readWheelEntries().reduce((sum, entry) => sum + (Number.isInteger(entry.weight) && entry.weight > 0 ? entry.weight : 0), 0);
  byId('wheelTotalWeight').textContent = `总份数 ${total}`;
}

async function saveWheel() {
  const result = await api('/api/wheel/config', { entries: readWheelEntries() });
  renderWheelState(result.data, { syncEntries: true });
  toast('转盘设置已保存');
}

async function spinWheel() {
  const result = await api('/api/wheel/spin');
  renderWheelState(result.data);
  toast('转盘开始转动');
}

function renderSession(session) {
  activeGameSession = session || null;
  syncDrawClockTimer();
  const status = byId('gamesSessionStatus');
  const stop = byId('gamesStopBtn');
  stop.disabled = !session;
  document.querySelectorAll('[data-start-game]').forEach(button => {
    button.disabled = Boolean(session);
    button.setAttribute('aria-disabled', String(Boolean(session)));
  });
  document.querySelectorAll('[data-draw-setting]').forEach(label => {
    label.classList.toggle('is-disabled', Boolean(session));
    label.querySelector('input').disabled = Boolean(session);
  });
  document.querySelectorAll('[data-game-card]').forEach(card => {
    card.classList.toggle('is-running', card.dataset.gameCard === session?.game);
  });
  renderDrawSession(session);
  if (!session) {
    status.textContent = '当前没有进行中的游戏';
    return;
  }
  const gameName = session.game === 'gomoku'
    ? '五子棋'
    : session.game === 'draw-guess' ? '你画我猜' : '数字炸弹';
  const opponent = session.mode === 'multi' ? '不限观众' : (session.targetName || '指定观众');
  status.textContent = `${gameName}进行中 · ${opponent}`;
}

function renderDrawSession(session) {
  const drawSession = session?.game === 'draw-guess' ? session : null;
  const state = drawSession?.state;
  byId('drawFinishRoundBtn').disabled = state?.phase !== 'drawing';
  byId('drawRevealAnswerBtn').disabled = state?.phase !== 'round-result' || Boolean(state.answerRevealed);
  byId('drawNextRoundBtn').disabled = state?.phase !== 'round-result' || !state.answerRevealed;
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
  byId('drawRoundDuration').value = String(Math.round(state.roundDurationMs / 1000));
  drawClock = { remainingMs: Number(state.remainingMs) || 0, receivedAt: performance.now() };
  byId('drawHostRound').textContent = `第 ${state.round} / ${state.totalRounds} 局 · ${state.category} · ${state.wordLength} 个字`;
  if (state.phase === 'drawing') {
    byId('drawCardStatus').textContent = `第 ${state.round} 局进行中 · ${state.correct.length} 人答对`;
    byId('drawHostStatus').textContent = '请在游戏网页作画，题词仅在这里显示';
  } else if (state.phase === 'round-result') {
    byId('drawHostClock').textContent = '--:--';
    byId('drawCardStatus').textContent = state.answerRevealed
      ? `第 ${state.round} 局结束 · 答案已公布：${state.revealedAnswer}`
      : `第 ${state.round} 局结束 · 等待主播公布答案`;
    byId('drawHostStatus').textContent = state.answerRevealed ? '可以开始下一题' : '时间到，弹幕仍在收集且不计分';
  } else {
    byId('drawHostClock').textContent = '--:--';
    const champion = state.scores[0];
    byId('drawCardStatus').textContent = champion ? `比赛结束 · ${champion.name} ${champion.score} 分` : '比赛结束 · 本场无人得分';
    byId('drawHostStatus').textContent = '最终排行已显示在游戏网页，可结束当前游戏';
  }
  updateDrawClock();
}

function renderHostState(state) {
  const visible = state?.game === 'draw-guess' && activeGameSession?.game === 'draw-guess';
  byId('drawHostWord').textContent = visible ? state.word : '开始游戏后显示题词';
}

function updateDrawClock() {
  if (activeGameSession?.game !== 'draw-guess' || activeGameSession.state?.phase !== 'drawing' || !drawClock) return;
  const elapsed = performance.now() - drawClock.receivedAt;
  const remaining = Math.max(0, drawClock.remainingMs - elapsed);
  const totalSeconds = Math.ceil(remaining / 1000);
  byId('drawHostClock').textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function syncDrawClockTimer() {
  const active = activeGameSession?.game === 'draw-guess'
    && activeGameSession.state?.phase === 'drawing';
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

function wheelOverlayUrl() {
  return `${localOverlayOrigin()}/wheel`;
}

async function copyWheelUrl(url) {
  await copyText(url);
  toast('转盘网页地址已复制');
}

function byId(id) { return document.getElementById(id); }
