'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import { api, localOverlayOrigin, readJsonResponse, showError, toast } from '../shared/utils.js';

const MAX_ENABLED_RULES = 8;
const MAX_RANDOM_WEIGHT = 100000;
const PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';
const GUARD_GIFTS = [
  { id: 'guard-1', name: '总督', rmb: 19998, image: 'bilibili-guard-governor.png' },
  { id: 'guard-2', name: '提督', rmb: 1998, image: 'bilibili-guard-prefect.png' },
  { id: 'guard-3', name: '舰长', rmb: 138, image: 'bilibili-guard-captain.png' }
];

let initialized = false;
let overtimeState = null;
let giftDetection = null;
let catalog = [];
let settlements = [];
let anchorRemainingMs = 0;
let localAnchorMs = 0;
let rulesDirty = false;

function init() {
  if (initialized || !document.getElementById('overtimePanel')) return;
  initialized = true;
  bindControls();
  eventBus.on(Events.STATE_LOADED, ({ state }) => {
    giftDetection = state?.giftDetection || giftDetection;
    if (state?.overtime) renderState(state.overtime);
  });
  eventBus.on(Events.OVERTIME_UPDATED, payload => {
    renderState(payload.state);
    if (payload.adjustment) refresh().catch(showError);
  });
  loadCatalog().catch(showError);
  refresh().catch(showError);
  requestAnimationFrame(updateClock);
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
  byId('overtimeEnableBtn').addEventListener('click', () => runAction(overtimeState?.enabled ? 'disable' : 'enable'));
  byId('overtimeStartBtn').addEventListener('click', () => runAction('start'));
  byId('overtimePauseBtn').addEventListener('click', () => runAction('pause'));
  byId('overtimeResetBtn').addEventListener('click', () => runAction('reset'));
  byId('overtimeApplyTimeBtn').addEventListener('click', applyTime);
  byId('overtimeAddGiftBtn').addEventListener('click', openGiftPicker);
  byId('overtimeGiftSearch').addEventListener('input', renderGiftPicker);
  byId('overtimeRules').addEventListener('input', () => { rulesDirty = true; });
  byId('overtimeRules').addEventListener('change', () => { rulesDirty = true; });
  byId('overtimeSaveRulesBtn').addEventListener('click', saveRules);
  byId('overtimeSaveBackgroundBtn').addEventListener('click', saveBackground);
  byId('overtimeOpenOverlayBtn').addEventListener('click', () => window.open(overlayUrl(), '_blank', 'noopener'));
  byId('overtimeCopyOverlayBtn').addEventListener('click', copyOverlayUrl);
  byId('overtimePreview').src = '/overtime?quality=low';
}

async function runAction(action) {
  try {
    const result = await api('/api/overtime/action', { action });
    renderState(result.data);
  } catch (_) {}
}

async function applyTime() {
  try {
    const initialSeconds = parseClock(byId('overtimeInitialTime').value, false);
    const remainingSeconds = parseClock(byId('overtimeRemainingTime').value, false);
    const result = await api('/api/overtime/time', { initialSeconds, remainingSeconds });
    renderState(result.data);
    toast('时间已应用并暂停');
  } catch (error) {
    showError(error);
  }
}

async function saveBackground() {
  try {
    const result = await api('/api/overtime/config', {
      path: byId('overtimeBackgroundPath').value,
      fit: byId('overtimeBackgroundFit').value
    });
    renderState(result.data);
    byId('overtimePreview').src = `/overtime?quality=low&t=${Date.now()}`;
    toast('直播画面已保存');
  } catch (_) {}
}

async function saveRules() {
  try {
    const rules = readRules();
    const result = await api('/api/overtime/rules', { rules });
    rulesDirty = false;
    renderState(result.data);
    toast('礼物规则已保存');
  } catch (error) {
    showError(error);
  }
}

function readRules() {
  const rows = Array.from(byId('overtimeRules').querySelectorAll('[data-overtime-rule]'));
  const rules = rows.map((row, index) => {
    const mode = row.querySelector('[data-rule-mode]').value;
    const enabled = row.querySelector('[data-rule-enabled]').checked;
    const base = {
      giftId: row.dataset.giftId,
      giftName: row.dataset.giftName,
      imagePath: row.dataset.imagePath,
      mode,
      enabled,
      sortOrder: index
    };
    if (mode === 'fixed') {
      return { ...base, fixedSeconds: parseClock(row.querySelector('[data-rule-fixed]').value, true) };
    }
    const lines = row.querySelector('[data-rule-random]').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length < 2 || lines.length > 10) throw new Error('时间盲盒需要 2–10 个结果。');
    const outcomes = lines.map((line, outcomeIndex) => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length !== 2) throw new Error(`盲盒结果 ${outcomeIndex + 1} 应写成“+00:05:00 | 40”。`);
      const weight = Number(parts[1]);
      if (!Number.isSafeInteger(weight) || weight <= 0) throw new Error(`盲盒结果 ${outcomeIndex + 1} 权重无效。`);
      return { seconds: parseClock(parts[0], true), weight };
    });
    if (outcomes.reduce((sum, outcome) => sum + outcome.weight, 0) > MAX_RANDOM_WEIGHT) {
      throw new Error(`盲盒总权重不能超过 ${MAX_RANDOM_WEIGHT}。`);
    }
    return { ...base, outcomes };
  });
  if (rules.filter(rule => rule.enabled).length > MAX_ENABLED_RULES) {
    throw new Error(`最多启用 ${MAX_ENABLED_RULES} 条礼物规则。`);
  }
  return rules;
}

function renderState(nextState) {
  if (!nextState) return;
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
  setValueUnlessFocused('overtimeInitialTime', formatClock((Number(overtimeState.initialSeconds) || 0) * 1000));
  setValueUnlessFocused('overtimeRemainingTime', formatClock(anchorRemainingMs));
  setValueUnlessFocused('overtimeBackgroundPath', overtimeState.background?.path || '');
  setValueUnlessFocused('overtimeBackgroundFit', overtimeState.background?.fit || 'cover');
  byId('overtimePendingCount').textContent = `待结算 ${Number(overtimeState.pendingCount) || 0}`;
  renderConsumerStatus();
  if (Array.isArray(nextState.rules) && !rulesDirty) renderRules(nextState.rules);
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
    byId('overtimeClockValue').textContent = formatClock(Math.max(0, anchorRemainingMs - elapsed));
  }
  requestAnimationFrame(updateClock);
}

function renderRules(rules) {
  const root = byId('overtimeRules');
  root.replaceChildren();
  if (!rules.length) {
    root.append(createMessage('overtime-rule-empty', '还没有规则。添加礼物后设置固定时间或时间盲盒。'));
    return;
  }
  rules.forEach((rule, index) => root.append(createRuleRow(rule, index, rules.length)));
}

function createRuleRow(rule, index, count) {
  const row = document.createElement('article');
  row.className = 'overtime-rule-row';
  row.dataset.overtimeRule = 'true';
  row.dataset.giftId = String(rule.giftId);
  row.dataset.giftName = String(rule.giftName || rule.giftId);
  row.dataset.imagePath = String(rule.imagePath || '');

  const image = document.createElement('img');
  image.src = rule.imagePath || PLACEHOLDER;
  image.alt = '';
  image.addEventListener('error', () => { image.src = PLACEHOLDER; }, { once: true });
  row.append(image);

  const identity = document.createElement('div');
  identity.className = 'overtime-rule-identity';
  const name = document.createElement('strong');
  name.textContent = rule.giftName || `礼物 ${rule.giftId}`;
  const id = document.createElement('small');
  id.textContent = `ID ${rule.giftId}`;
  identity.append(name, id);
  row.append(identity);

  const mode = document.createElement('select');
  mode.dataset.ruleMode = 'true';
  appendOption(mode, 'fixed', '固定时间');
  appendOption(mode, 'random', '时间盲盒');
  mode.value = rule.mode;
  row.append(mode);

  const effect = document.createElement('div');
  effect.className = 'overtime-rule-effect';
  renderEffectEditor(effect, rule);
  mode.addEventListener('change', () => renderEffectEditor(effect, { ...rule, mode: mode.value }));
  row.append(effect);

  const controls = document.createElement('div');
  controls.className = 'overtime-rule-buttons';
  const enabledLabel = document.createElement('label');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = rule.enabled !== false;
  enabled.dataset.ruleEnabled = 'true';
  enabledLabel.append(enabled, document.createTextNode('启用'));
  controls.append(enabledLabel);
  controls.append(ruleButton('↑', '上移', index === 0, () => moveRule(row, -1)));
  controls.append(ruleButton('↓', '下移', index === count - 1, () => moveRule(row, 1)));
  controls.append(ruleButton('删除', '删除规则', false, () => {
    rulesDirty = true;
    row.remove();
  }));
  row.append(controls);
  return row;
}

function renderEffectEditor(root, rule) {
  root.replaceChildren();
  if (rule.mode === 'random') {
    const input = document.createElement('textarea');
    input.className = 'overtime-random-outcomes';
    input.dataset.ruleRandom = 'true';
    const outcomes = Array.isArray(rule.outcomes) && rule.outcomes.length >= 2
      ? rule.outcomes
      : [{ seconds: 300, weight: 50 }, { seconds: -180, weight: 50 }];
    input.value = outcomes.map(outcome => `${formatSignedClock(outcome.seconds)} | ${outcome.weight}`).join('\n');
    input.setAttribute('aria-label', '盲盒结果，每行时间与权重');
    root.append(input);
    return;
  }
  const input = document.createElement('input');
  input.dataset.ruleFixed = 'true';
  input.value = formatSignedClock(Number(rule.fixedSeconds) || 0);
  input.setAttribute('aria-label', '固定时间变化');
  root.append(input);
}

function ruleButton(label, title, disabled, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = label;
  button.title = title;
  button.disabled = disabled;
  button.addEventListener('click', handler);
  return button;
}

function moveRule(row, direction) {
  const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  rulesDirty = true;
  if (direction < 0) row.parentNode.insertBefore(row, sibling);
  else row.parentNode.insertBefore(sibling, row);
}

async function loadCatalog() {
  const response = await fetch('/img/bilibili-gifts.json');
  const data = await readJsonResponse(response, '读取礼物目录失败');
  catalog = [...GUARD_GIFTS, ...(Array.isArray(data.gifts) ? data.gifts : [])].map(gift => ({
    id: String(gift.id),
    name: String(gift.name || gift.id),
    rmb: Number(gift.rmb) || 0,
    imagePath: `/img/${String(gift.image || '').replace(/^\/+/, '')}`
  }));
}

function openGiftPicker() {
  byId('overtimeGiftSearch').value = '';
  renderGiftPicker();
  byId('overtimeGiftPicker').showModal();
}

function renderGiftPicker() {
  const root = byId('overtimeGiftResults');
  const query = byId('overtimeGiftSearch').value.trim().toLocaleLowerCase();
  const selectedIds = new Set(Array.from(byId('overtimeRules').querySelectorAll('[data-overtime-rule]')).map(row => row.dataset.giftId));
  const matches = catalog.filter(gift => !selectedIds.has(gift.id) && (
    !query || gift.id.toLocaleLowerCase().includes(query) || gift.name.toLocaleLowerCase().includes(query)
  )).slice(0, 80);
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
    const meta = document.createElement('small');
    meta.textContent = `ID ${gift.id} · ¥${gift.rmb.toFixed(2)}`;
    text.append(name, meta);
    button.append(image, text);
    button.addEventListener('click', () => addGiftRule(gift));
    root.append(button);
  }
  if (!matches.length) root.append(createMessage('overtime-rule-empty', '没有匹配的礼物。'));
}

function addGiftRule(gift) {
  const root = byId('overtimeRules');
  root.querySelector('.overtime-rule-empty')?.remove();
  const count = root.querySelectorAll('[data-overtime-rule]').length;
  rulesDirty = true;
  root.append(createRuleRow({
    giftId: gift.id,
    giftName: gift.name,
    imagePath: gift.imagePath,
    mode: 'fixed',
    fixedSeconds: 300,
    outcomes: [],
    enabled: count < MAX_ENABLED_RULES,
    sortOrder: count
  }, count, count + 1));
  byId('overtimeGiftPicker').close();
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
    delta.textContent = item.appliedDeltaSeconds === null ? '—' : formatSignedClock(item.appliedDeltaSeconds);
    delta.className = Number(item.appliedDeltaSeconds) >= 0 ? 'is-positive' : 'is-negative';
    const time = document.createElement('time');
    time.textContent = item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    row.append(identity, mode, delta, time);
    root.append(row);
  }
}

function parseClock(value, signed) {
  const text = String(value || '').trim();
  const match = text.match(/^([+-])?(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error('时间格式应为 HHH:MM:SS。');
  if (Number(match[3]) > 59 || Number(match[4]) > 59) throw new Error('分和秒必须小于 60。');
  const sign = match[1] === '-' ? -1 : 1;
  if (!signed && sign < 0) throw new Error('本场时间不能为负数。');
  return sign * (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]));
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
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
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
    await navigator.clipboard.writeText(overlayUrl());
    toast('OBS 地址已复制');
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
