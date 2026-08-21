'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import { api, copyText, localOverlayOrigin, readJsonResponse, showError, toast } from '../shared/utils.js';
import { createOvertimeRuleEditor } from './overtime-rule-editor.js';

const PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';
const GUARD_GIFTS = [
  { id: 'guard-1', name: '总督', image: 'bilibili-guard-governor.png' },
  { id: 'guard-2', name: '提督', image: 'bilibili-guard-prefect.png' },
  { id: 'guard-3', name: '舰长', image: 'bilibili-guard-captain.png' }
];

let initialized = false;
let overtimeState = null;
let serverLimits = null;
let giftDetection = null;
let catalog = [];
let settlements = [];
let anchorRemainingMs = 0;
let localAnchorMs = 0;
let rulesDirty = false;
let rulesSaving = false;
let backgroundDirty = false;
let backgroundSaving = false;
let catalogRefreshing = false;
let giftCatalogSnapshot = null;
let catalogLiveStatus = null;
let saleGiftIds = new Set();
let ruleEditor = null;
let clockRafId = null;
let lastClockValue = '';

function init() {
  if (initialized || !document.getElementById('overtimePanel')) return;
  initialized = true;
  ruleEditor = createOvertimeRuleEditor(byId('overtimeRules'), markRulesDirty);
  bindControls();
  eventBus.on(Events.STATE_LOADED, ({ state }) => {
    giftDetection = state?.giftDetection || giftDetection;
    catalogLiveStatus = state?.liveStatus || catalogLiveStatus;
    if (state?.overtime) renderState(state.overtime);
    if (giftCatalogSnapshot?.refreshedAt) renderGiftCatalogStatus();
  });
  eventBus.on(Events.OVERTIME_UPDATED, payload => {
    renderState(payload.state);
    if (payload.adjustment) refresh().catch(showError);
  });
  eventBus.on('app:shutdown', stopClockLoop);
  document.addEventListener('visibilitychange', syncClockLoop);
  loadCatalog().catch(showError);
  refresh().catch(showError);
}

async function refresh() {
  const response = await fetch('/api/overtime');
  const payload = await readJsonResponse(response, '读取加班机失败');
  if (!payload.ok) throw new Error(payload.error || '读取加班机失败');
  settlements = payload.data.settlements || [];
  renderState(payload.data);
  renderSettlements();
}

function bindControls() {
  populateInitialDurationSelectors();
  byId('overtimeEnableBtn').addEventListener('click', () => runAction(overtimeState?.enabled ? 'disable' : 'enable'));
  byId('overtimeStartBtn').addEventListener('click', () => runAction('start'));
  byId('overtimePauseBtn').addEventListener('click', () => runAction('pause'));
  byId('overtimeResetBtn').addEventListener('click', () => runAction('reset'));
  byId('overtimeApplyTimeBtn').addEventListener('click', applyTime);
  byId('overtimeInitialTime').addEventListener('input', syncDurationSelectorsFromInput);
  byId('overtimeInitialHours').addEventListener('change', syncDurationInputFromSelectors);
  byId('overtimeInitialMinutes').addEventListener('change', syncDurationInputFromSelectors);
  byId('overtimeRefreshGiftsBtn').addEventListener('click', refreshGiftCatalog);
  byId('overtimeAddGiftBtn').addEventListener('click', openGiftPicker);
  byId('overtimeGiftSearch').addEventListener('input', renderGiftPicker);
  byId('overtimeRules').addEventListener('input', markRulesDirty);
  byId('overtimeRules').addEventListener('change', markRulesDirty);
  byId('overtimeSaveRulesBtn').addEventListener('click', saveRules);
  byId('overtimeSaveBackgroundBtn').addEventListener('click', saveBackground);
  byId('overtimeBackgroundPath').addEventListener('change', markBackgroundDirty);
  byId('overtimeBackgroundFit').addEventListener('change', markBackgroundDirty);
  byId('overtimeOpenOverlayBtn').addEventListener('click', () => window.open(overlayUrl(), '_blank', 'noopener'));
  byId('overtimeCopyOverlayBtn').addEventListener('click', copyOverlayUrl);
  byId('overtimePreview').src = '/overtime?quality=low';
  syncRulesSaveButton();
  syncBackgroundSaveButton();
}

async function runAction(action) {
  try {
    const result = await api('/api/overtime/action', { action });
    renderState(result.data);
  } catch (_) {}
}

async function applyTime() {
  try {
    const initialSeconds = parseInitialDuration(byId('overtimeInitialTime').value);
    const result = await api('/api/overtime/time', { initialSeconds, remainingSeconds: initialSeconds });
    renderState(result.data);
    toast('初始时间已设置，倒计时已重置并暂停');
  } catch (error) {
    showError(error);
  }
}

async function saveBackground() {
  if (backgroundSaving || !backgroundDirty) return;
  backgroundSaving = true;
  syncBackgroundSaveButton();
  try {
    const result = await api('/api/overtime/config', {
      path: byId('overtimeBackgroundPath').value,
      fit: byId('overtimeBackgroundFit').value
    });
    renderState(result.data);
    backgroundDirty = false;
    syncBackgroundSaveButton();
    byId('overtimePreview').src = `/overtime?quality=low&t=${Date.now()}`;
    toast('直播画面已保存');
  } catch (error) {
    showError(error);
  } finally {
    backgroundSaving = false;
    syncBackgroundSaveButton();
  }
}

async function saveRules() {
  if (rulesSaving || !rulesDirty) return;
  rulesSaving = true;
  syncRulesSaveButton();
  try {
    const rules = ruleEditor.readRules();
    const result = await api('/api/overtime/rules', { rules });
    rulesDirty = false;
    renderState(result.data);
    toast('修改已保存');
  } catch (error) {
    showError(error);
  } finally {
    rulesSaving = false;
    syncRulesSaveButton();
  }
}

function markRulesDirty() {
  rulesDirty = true;
  syncRulesSaveButton();
}

function getRulesSaveButtonState(dirty, saving) {
  if (saving) return { label: '保存中…', disabled: true, dirty: false };
  if (dirty) return { label: '保存修改', disabled: false, dirty: true };
  return { label: '✓ 已保存', disabled: true, dirty: false };
}

function syncRulesSaveButton() {
  const button = byId('overtimeSaveRulesBtn');
  if (!button) return;
  const state = getRulesSaveButtonState(rulesDirty, rulesSaving);
  button.textContent = state.label;
  button.disabled = state.disabled;
  button.classList.toggle('is-dirty', state.dirty);
}

function markBackgroundDirty() {
  backgroundDirty = true;
  syncBackgroundSaveButton();
}

function getBackgroundSaveButtonState(dirty, saving) {
  if (saving) return { label: '保存中…', disabled: true };
  if (dirty) return { label: '保存画面', disabled: false };
  return { label: '已保存', disabled: true };
}

function syncBackgroundSaveButton() {
  const button = byId('overtimeSaveBackgroundBtn');
  if (!button) return;
  const state = getBackgroundSaveButtonState(backgroundDirty, backgroundSaving);
  button.textContent = state.label;
  button.disabled = state.disabled;
}

function renderState(nextState) {
  if (!nextState) return;
  if (nextState.limits) {
    serverLimits = nextState.limits;
    ruleEditor.setLimits(serverLimits);
  }
  overtimeState = { ...overtimeState, ...nextState };
  anchorRemainingMs = Number(overtimeState.effectiveRemainingMs) || 0;
  localAnchorMs = performance.now();
  const enabled = overtimeState.enabled === true;
  const statusLabels = { disabled: '未启用', paused: '已暂停', running: '直播加班中', finished: '已结束' };
  byId('overtimeClockLabel').textContent = statusLabels[overtimeState.status] || '状态未知';
  byId('overtimeEnableBtn').textContent = enabled ? '关闭加班机' : '启用加班机';
  byId('overtimeStartBtn').disabled = !enabled || overtimeState.status === 'running' || anchorRemainingMs <= 0;
  byId('overtimePauseBtn').disabled = !enabled || overtimeState.status !== 'running';
  byId('overtimeResetBtn').disabled = !enabled;
  renderInitialDuration(Number(overtimeState.initialSeconds) || 0);
  if (!backgroundDirty) {
    setValueUnlessFocused('overtimeBackgroundPath', overtimeState.background?.path || '');
    setValueUnlessFocused('overtimeBackgroundFit', overtimeState.background?.fit || 'cover');
  }
  byId('overtimePendingCount').textContent = `待结算 ${Number(overtimeState.pendingCount) || 0}`;
  renderConsumerStatus();
  if (Array.isArray(nextState.rules) && !rulesDirty) {
    ruleEditor.renderRules(nextState.rules);
    syncRuleAvailability();
  }
  syncClockLoop();
}

function renderConsumerStatus() {
  const consumers = giftDetection?.consumers || {};
  const overtimeEnabled = overtimeState?.enabled === true;
  const coreActive = giftDetection?.coreActive === true || overtimeEnabled;
  setStatus(byId('overtimeCoreStatus'), `共享收礼核心：${coreActive ? '运行中' : '未运行'}`, coreActive);
  setStatus(byId('overtimeGiftStatsStatus'), `礼物统计：${consumers.giftStatistics ? '开启' : '关闭'}`, consumers.giftStatistics);
  setStatus(byId('overtimeConsumerStatus'), `加班机：${overtimeEnabled ? '开启' : '关闭'}`, overtimeEnabled);
}

function setStatus(node, label, active) {
  node.textContent = label;
  node.classList.toggle('good', Boolean(active));
  node.classList.toggle('warn', !active);
}

function updateClock(nowMs) {
  if (overtimeState) {
    const elapsed = overtimeState.status === 'running' ? Math.max(0, nowMs - localAnchorMs) : 0;
    const remainingMs = Math.max(0, anchorRemainingMs - elapsed);
    const value = formatClockDisplay(remainingMs, overtimeState.status);
    const clock = byId('overtimeClockValue');
    if (value !== lastClockValue) {
      clock.textContent = value;
      clock.classList.toggle('is-calendar', /[天年]/.test(value));
      clock.classList.toggle('is-finished', value === '该下播了');
      lastClockValue = value;
    }
    if (overtimeState.status === 'running' && document.visibilityState === 'visible') {
      clockRafId = requestAnimationFrame(updateClock);
      return;
    }
  }
  clockRafId = null;
}

function syncClockLoop() {
  const shouldRun = overtimeState?.status === 'running' && document.visibilityState === 'visible';
  if (!shouldRun) {
    if (clockRafId !== null) cancelAnimationFrame(clockRafId);
    clockRafId = null;
    updateClock(performance.now());
    return;
  }
  if (clockRafId === null) clockRafId = requestAnimationFrame(updateClock);
}

function stopClockLoop() {
  if (clockRafId !== null) cancelAnimationFrame(clockRafId);
  clockRafId = null;
}

async function loadCatalog() {
  const response = await fetch('/api/overtime/gifts');
  const payload = await readJsonResponse(response, '读取在售礼物失败');
  if (!payload.ok) throw new Error(payload.error || '读取在售礼物失败');
  applyGiftCatalog(payload.data);
}

async function refreshGiftCatalog() {
  if (catalogRefreshing) return;
  catalogRefreshing = true;
  syncCatalogRefreshButton();
  try {
    const result = await api('/api/overtime/gifts/refresh', {});
    applyGiftCatalog(result.data);
    toast(`已刷新 ${giftCatalogSnapshot.count} 个在售礼物`);
  } catch (error) {
    showError(error);
  } finally {
    catalogRefreshing = false;
    syncCatalogRefreshButton();
  }
}

function applyGiftCatalog(snapshot) {
  giftCatalogSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const saleGifts = Array.isArray(giftCatalogSnapshot.gifts) ? giftCatalogSnapshot.gifts : [];
  saleGiftIds = new Set(saleGifts.map(gift => String(gift.id)));
  catalog = [
    ...GUARD_GIFTS.map((gift, index) => ({ ...gift, catalogGroup: 0, catalogOrder: index })),
    ...saleGifts.map(gift => ({ ...gift, catalogGroup: 1, catalogOrder: 0 }))
  ].map(gift => ({
    id: String(gift.id),
    name: String(gift.name || gift.id),
    rmb: Number(gift.rmb) || 0,
    catalogGroup: gift.catalogGroup,
    catalogOrder: gift.catalogOrder,
    imagePath: String(gift.imagePath || (gift.image ? `/img/${String(gift.image).replace(/^\/+/, '')}` : ''))
  })).sort((left, right) => left.catalogGroup - right.catalogGroup
    || left.catalogOrder - right.catalogOrder
    || left.rmb - right.rmb);
  renderGiftCatalogStatus();
  syncRuleAvailability();
}

function renderGiftCatalogStatus() {
  const status = byId('overtimeGiftCatalogStatus');
  if (!giftCatalogSnapshot?.refreshedAt) {
    status.textContent = '在售目录：未刷新';
    return;
  }
  const refreshedAt = new Date(giftCatalogSnapshot.refreshedAt);
  const timeLabel = Number.isNaN(refreshedAt.getTime())
    ? ''
    : refreshedAt.toLocaleString('zh-CN', { hour12: false });
  status.textContent = `在售目录：${Number(giftCatalogSnapshot.count) || 0} 个 · 房间 ${catalogRoomLabel(giftCatalogSnapshot, catalogLiveStatus)}${timeLabel ? ` · ${timeLabel}` : ''}`;
}

function catalogRoomLabel(snapshot, liveStatus) {
  const roomId = String(snapshot?.roomId || '');
  const liveRoomId = String(liveStatus?.roomId || '');
  const ownerName = String(liveStatus?.ownerName || '').trim();
  return ownerName && roomId && liveRoomId === roomId ? ownerName : (roomId || '—');
}

function syncCatalogRefreshButton() {
  const button = byId('overtimeRefreshGiftsBtn');
  if (!button) return;
  button.disabled = catalogRefreshing;
  button.textContent = catalogRefreshing ? '刷新中…' : '刷新在售礼物';
}

function syncRuleAvailability() {
  const hasSnapshot = Boolean(giftCatalogSnapshot?.refreshedAt);
  for (const row of byId('overtimeRules').querySelectorAll('[data-overtime-rule]')) {
    const giftId = String(row.dataset.giftId || '');
    const available = giftId.startsWith('guard-') || saleGiftIds.has(giftId);
    row.classList.toggle('is-unavailable', hasSnapshot && !available);
    const identity = row.querySelector('.overtime-rule-identity');
    if (!identity) continue;
    let status = identity.querySelector('[data-rule-sale-status]');
    if (!status) {
      status = document.createElement('small');
      status.className = 'overtime-rule-sale-status';
      status.dataset.ruleSaleStatus = 'true';
      identity.append(status);
    }
    status.hidden = !hasSnapshot || giftId.startsWith('guard-');
    status.textContent = available ? '当前在售' : '当前未在售';
  }
}

function openGiftPicker() {
  const search = byId('overtimeGiftSearch');
  search.value = '';
  renderGiftPicker();
  byId('overtimeGiftPicker').showModal();
  search.focus();
}

function renderGiftPicker() {
  const root = byId('overtimeGiftResults');
  const query = byId('overtimeGiftSearch').value.trim().toLocaleLowerCase();
  const selectedIds = new Set(Array.from(byId('overtimeRules').querySelectorAll('[data-overtime-rule]')).map(row => row.dataset.giftId));
  const matches = catalog.filter(gift => !selectedIds.has(gift.id) && (
    !query || gift.id.toLocaleLowerCase().includes(query) || gift.name.toLocaleLowerCase().includes(query)
  ));
  root.replaceChildren();
  for (const gift of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'overtime-gift-option';
    const image = document.createElement('img');
    image.src = gift.imagePath || PLACEHOLDER;
    image.alt = '';
    image.addEventListener('error', () => { image.src = PLACEHOLDER; }, { once: true });
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = gift.name;
    text.append(name);
    if (!gift.id.startsWith('guard-')) {
      const meta = document.createElement('small');
      meta.textContent = `¥${gift.rmb.toFixed(2)}`;
      text.append(meta);
    }
    button.append(image, text);
    button.addEventListener('click', () => addGiftRule(gift));
    root.append(button);
  }
  if (!matches.length) root.append(createMessage('overtime-rule-empty', '没有找到这个礼物。'));
}

function addGiftRule(gift) {
  const row = ruleEditor.createRule(gift);
  syncRuleAvailability();
  byId('overtimeGiftPicker').close();
  row.scrollIntoView({ block: 'nearest' });
  toast(`已添加 ${gift.name}`);
}

function renderSettlements() {
  const root = byId('overtimeSettlements');
  root.replaceChildren();
  if (!settlements.length) {
    root.append(createMessage('overtime-settlement-empty', '本场还没有礼物结算。'));
    return;
  }
  for (const item of settlements) {
    const row = document.createElement('div');
    row.className = 'overtime-settlement-row';
    const identity = document.createElement('strong');
    identity.textContent = `${item.giftName || item.giftId} ×${item.quantity}`;
    const mode = document.createElement('span');
    mode.textContent = item.ruleMode === 'random' ? '时间盲盒' : item.ruleMode === 'fixed' ? '固定时间' : '已忽略';
    const delta = document.createElement('span');
    delta.textContent = item.appliedDeltaSeconds === null ? '—' : formatSettlementEffect(item);
    delta.className = Number(item.appliedDeltaSeconds) >= 0 ? 'is-positive' : 'is-negative';
    const time = document.createElement('time');
    time.textContent = item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    row.append(identity, mode, delta, time);
    root.append(row);
  }
}

function populateInitialDurationSelectors() {
  const hours = byId('overtimeInitialHours');
  const minutes = byId('overtimeInitialMinutes');
  for (let value = 0; value <= 999; value += 1) {
    appendOption(hours, String(value), `${value} 小时`);
  }
  for (let value = 0; value < 60; value += 1) {
    appendOption(minutes, String(value), `${value} 分钟`);
  }
}

function syncDurationSelectorsFromInput() {
  try {
    renderDurationSelectors(parseInitialDuration(byId('overtimeInitialTime').value));
  } catch (_) {}
}

function syncDurationInputFromSelectors() {
  const hours = Number(byId('overtimeInitialHours').value) || 0;
  const minutes = Number(byId('overtimeInitialMinutes').value) || 0;
  byId('overtimeInitialTime').value = formatInitialDuration((hours * 60 + minutes) * 60);
}

function renderInitialDuration(seconds) {
  const normalizedSeconds = Math.max(0, Math.floor((Number(seconds) || 0) / 60) * 60);
  setValueUnlessFocused('overtimeInitialTime', formatInitialDuration(normalizedSeconds));
  renderDurationSelectors(normalizedSeconds);
}

function renderDurationSelectors(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  setValueUnlessFocused('overtimeInitialHours', String(Math.floor(totalMinutes / 60)));
  setValueUnlessFocused('overtimeInitialMinutes', String(totalMinutes % 60));
}

function parseInitialDuration(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,3}):(\d{2})$/);
  if (!match) throw new Error('初始时长格式应为 HHH:MM。');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) throw new Error('分钟必须小于 60。');
  const seconds = (hours * 60 + minutes) * 60;
  if (seconds > serverLimits.maxSeconds) {
    throw new Error(`初始时长不能超过 ${formatMaxSeconds(serverLimits.maxSeconds)}。`);
  }
  return seconds;
}

function formatMaxSeconds(seconds) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function formatInitialDuration(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatClockDisplay(milliseconds, status) {
  const remainingMs = Math.max(0, Number(milliseconds) || 0);
  const finished = status === 'finished' || (status === 'running' && remainingMs === 0);
  return finished ? '该下播了' : formatClock(remainingMs);
}

function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  return formatClockSeconds(seconds);
}

function formatSignedClock(seconds) {
  const number = Number(seconds) || 0;
  return `${number < 0 ? '-' : '+'}${formatClockSeconds(Math.abs(number))}`;
}

function formatClockSeconds(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(whole / 86400);
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years}年 ${days % 365}天 ${Math.floor((whole % 86400) / 3600)}小时`;
  }
  if (days > 0) {
    const hours = Math.floor((whole % 86400) / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    return `${days}天 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatSettlementEffect(item) {
  const applicationCount = item.ruleSnapshot?.quantityMode === 'item'
    ? Math.max(1, Math.floor(Number(item.quantity) || 1))
    : 1;
  if (applicationCount > 1) {
    return `结算 ${applicationCount} 次 · ${formatSignedClock(item.appliedDeltaSeconds)}`;
  }
  const effect = item.outcome?.selectedEffect ?? item.ruleSnapshot?.fixedEffect;
  if (!effect) return formatSignedClock(item.appliedDeltaSeconds);
  if (effect.operation === 'multiply') return `×${effect.value}（${formatSignedClock(item.appliedDeltaSeconds)}）`;
  if (effect.operation === 'divide') return `÷${effect.value}（${formatSignedClock(item.appliedDeltaSeconds)}）`;
  if (effect.operation === 'clear') return '清零';
  return formatSignedClock(item.appliedDeltaSeconds);
}

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function createMessage(className, message) {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = message;
  return node;
}

function overlayUrl() {
  return `${localOverlayOrigin()}/overtime`;
}

async function copyOverlayUrl() {
  try {
    await copyText(overlayUrl());
    toast('地址已复制');
  } catch (error) {
    showError(error);
  }
}

function byId(id) {
  return document.getElementById(id);
}

function setValueUnlessFocused(id, value) {
  const input = byId(id);
  if (document.activeElement !== input) input.value = value;
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.overtime = { init, refresh };
