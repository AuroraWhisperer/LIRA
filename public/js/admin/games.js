'use strict';

import { api, copyText, localOverlayOrigin, readJsonResponse, showError, toast } from '../shared/utils.js';

let initialized = false;
let wheelState = null;

export function initGames() {
  if (initialized || !document.getElementById('gamesAdminPanel')) return;
  initialized = true;
  byId('gamesOverlayUrl').value = overlayBaseUrl();
  byId('gamesCopyBaseUrlBtn').addEventListener('click', () => copyUrl(overlayBaseUrl()));
  byId('gamesOpenOverlayBtn').addEventListener('click', () => window.open(overlayBaseUrl(), '_blank', 'noopener'));
  byId('gamesRefreshViewersBtn').addEventListener('click', () => refreshViewers().catch(showError));
  byId('gamesStopBtn').addEventListener('click', () => stopGame().catch(showError));
  byId('wheelCardTrigger').addEventListener('click', toggleWheelDetails);
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
  window.addEventListener('app:game-update', event => renderSession(event.detail));
  window.addEventListener('app:wheel-update', event => renderWheelState(event.detail));
  byId('wheelOverlayUrl').value = wheelOverlayUrl();
  renderWheelEntries([]);
  syncViewerMode();
  Promise.all([refreshViewers(), refreshSession(), refreshWheel()]).catch(showError);
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

async function refreshWheel() {
  const response = await fetch('/api/wheel');
  const payload = await readJsonResponse(response, '读取转盘设置失败');
  if (!payload.ok) throw new Error(payload.error || '读取转盘设置失败');
  renderWheelState(payload.data, { syncEntries: true });
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
  toast(`${game === 'gomoku' ? '五子棋' : '数字炸弹'}已开始`);
}

async function stopGame() {
  await api('/api/games/session', { action: 'stop' });
  renderSession(null);
  toast('游戏已结束');
}

function renderWheelState(state, options = {}) {
  wheelState = state || { entries: [], totalWeight: 0, spin: null, lastResult: null };
  if (options.syncEntries) renderWheelEntries(wheelState.entries || []);
  const spinning = Boolean(wheelState.spin);
  const canSpin = (wheelState.entries || []).length >= 2 && !spinning;
  byId('wheelSpinBtn').disabled = !canSpin;
  byId('wheelSaveBtn').disabled = spinning;
  byId('wheelAddEntryBtn').disabled = spinning;
  byId('wheelStatus').textContent = spinning
    ? '转盘正在转动…'
    : wheelState.lastResult?.label
      ? `上次抽中：${wheelState.lastResult.label}`
      : canSpin ? '设置已就绪，可以开始转动' : '至少配置两个选项后开始';
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

function renderWheelEntries(entries) {
  const root = byId('wheelEntries');
  root.replaceChildren();
  const values = entries.length ? entries : [{ label: '', weight: 1 }, { label: '', weight: 1 }];
  values.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'wheel-entry-row';
    const label = document.createElement('label');
    label.textContent = `内容 ${index + 1}`;
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.maxLength = 40;
    labelInput.className = 'wheel-label-input';
    labelInput.value = String(entry.label || '');
    labelInput.placeholder = '例如：唱一首歌';
    label.append(labelInput);
    const weight = document.createElement('label');
    weight.textContent = '份数';
    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.min = '1';
    weightInput.max = '100';
    weightInput.step = '1';
    weightInput.className = 'wheel-weight-input';
    weightInput.value = String(Number(entry.weight) || 1);
    weight.append(weightInput);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary wheel-remove-entry';
    remove.textContent = '删除';
    remove.disabled = values.length <= 2;
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
  const rows = byId('wheelEntries').children;
  if (rows.length >= 12) return;
  const entries = readWheelEntries();
  entries.push({ label: '', weight: 1 });
  renderWheelEntries(entries);
}

function renumberWheelEntries() {
  [...byId('wheelEntries').children].forEach((row, index) => {
    row.querySelector('label').firstChild.textContent = `内容 ${index + 1}`;
    row.querySelectorAll('button').forEach(button => { button.disabled = byId('wheelEntries').children.length <= 2; });
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
  const status = byId('gamesSessionStatus');
  const stop = byId('gamesStopBtn');
  stop.disabled = !session;
  document.querySelectorAll('[data-start-game]').forEach(button => {
    button.disabled = Boolean(session);
    button.setAttribute('aria-disabled', String(Boolean(session)));
  });
  document.querySelectorAll('[data-game-card]').forEach(card => {
    card.classList.toggle('is-running', card.dataset.gameCard === session?.game);
  });
  if (!session) {
    status.textContent = '当前没有进行中的游戏';
    return;
  }
  const gameName = session.game === 'gomoku' ? '五子棋' : '数字炸弹';
  const opponent = session.mode === 'multi' ? '不限观众' : (session.targetName || '指定观众');
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
