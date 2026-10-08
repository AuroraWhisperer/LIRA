'use strict';

import { api, copyText, localOverlayOrigin, readJsonResponse, showError, toast } from '../shared/utils.js';

let wheelState = null;
let wheelLimits = null;
let savedEntries = '';
let pending = false;

export function initWheelAdmin() {
  byId('wheelCardTrigger').addEventListener('click', toggleWheelDetails);
  byId('wheelOverlayUrl').addEventListener('click', () => copyWheelUrl(wheelOverlayUrl()).catch(showError));
  byId('wheelOpenUrlBtn').addEventListener('click', () => window.open(wheelOverlayUrl(), '_blank', 'noopener'));
  byId('wheelAddEntryBtn').addEventListener('click', addWheelEntry);
  byId('wheelSaveBtn').addEventListener('click', () => saveWheel().catch(showError));
  byId('wheelSpinBtn').addEventListener('click', () => spinWheel().catch(showError));
  window.addEventListener('app:wheel-update', (event) => renderWheelState(event.detail));
  byId('wheelOverlayUrl').textContent = wheelOverlayUrl();
  return refreshWheel();
}

async function refreshWheel() {
  const response = await fetch('/api/wheel');
  const payload = await readJsonResponse(response, '读取转盘设置失败');
  if (!payload.ok) throw new Error(payload.error || '读取转盘设置失败');
  renderWheelState(payload.data, { syncEntries: true });
}

export function renderWheelState(state, options = {}) {
  const syncEntries = options.syncEntries || !hasWheelDraft();
  wheelState = state || {
    entries: [],
    totalWeight: 0,
    spin: null,
    lastResult: null,
  };
  if (state?.limits) wheelLimits = state.limits;
  const entries = wheelState.entries?.length ? wheelState.entries
    : Array.from({ length: wheelLimits?.minEntries || 0 }, () => ({ label: '', weight: wheelLimits.minWeight }));
  savedEntries = JSON.stringify(entries.map((entry) => ({ label: String(entry.label || '').trim(), weight: Number(entry.weight) })));
  if (syncEntries) {
    renderWheelEntries(entries);
  }
  updateWheelTotal();
  const spinning = Boolean(wheelState.spin);
  byId('wheelCardResult').textContent = spinning
    ? '转盘转动中…'
    : wheelState.lastResult?.label
      ? `抽中：${wheelState.lastResult.label}`
      : '尚未抽取';
  document.querySelector('[data-wheel-card]').classList.toggle('is-running', spinning);
}

function hasWheelDraft() {
  return Boolean(savedEntries) && JSON.stringify(readWheelEntries()) !== savedEntries;
}

function updateWheelControls() {
  const spinning = Boolean(wheelState?.spin);
  const locked = spinning || pending;
  const dirty = hasWheelDraft();
  const rows = byId('wheelEntries').children;
  const canSpin = Boolean(wheelLimits) && (wheelState?.entries || []).length >= wheelLimits.minEntries;
  byId('wheelSpinBtn').disabled = locked || dirty || !canSpin;
  byId('wheelSaveBtn').disabled = locked;
  byId('wheelAddEntryBtn').disabled = locked || !wheelLimits || rows.length >= wheelLimits.maxEntries;
  for (const row of rows) {
    row.querySelector('.wheel-label-input').disabled = locked;
    row.querySelector('.wheel-weight-input').disabled = locked;
    row.querySelector('.wheel-remove-entry').disabled = locked || rows.length <= wheelLimits.minEntries;
  }
  byId('wheelStatus').textContent = spinning
    ? '转盘正在转动…'
    : pending
      ? '正在处理…'
      : dirty
        ? '选项有未保存的修改，请先保存再开始转动'
        : wheelState?.lastResult?.label
          ? `上次抽中：${wheelState.lastResult.label}`
          : canSpin
            ? '设置已就绪，可以开始转动'
            : '至少配置两个选项后开始';
}

function toggleWheelDetails() {
  const card = document.querySelector('[data-wheel-card]');
  const details = byId('wheelCardDetails');
  const trigger = byId('wheelCardTrigger');
  const expanded = details.hidden;
  details.hidden = !expanded;
  card.classList.toggle('is-collapsed', !expanded);
  trigger.setAttribute('aria-expanded', String(expanded));
  if (expanded) {
    byId('wheelEntries').querySelector('.wheel-label-input')?.focus();
  }
}

function renderWheelEntries(entries) {
  if (!wheelLimits) return;
  const root = byId('wheelEntries');
  root.replaceChildren();
  const values = entries.length
    ? entries
    : Array.from({ length: wheelLimits.minEntries }, () => ({
        label: '',
        weight: wheelLimits.minWeight,
      }));
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
  if (!wheelLimits || pending || wheelState?.spin) return;
  const rows = byId('wheelEntries').children;
  if (rows.length >= wheelLimits.maxEntries) return;
  const entries = readWheelEntries();
  entries.push({ label: '', weight: wheelLimits.minWeight });
  renderWheelEntries(entries);
}

function renumberWheelEntries() {
  [...byId('wheelEntries').children].forEach((row, index) => {
    row.querySelector('label').firstChild.textContent = `内容 ${index + 1}`;
    row.querySelectorAll('button').forEach((button) => {
      button.disabled = byId('wheelEntries').children.length <= wheelLimits.minEntries;
    });
  });
}

function readWheelEntries() {
  return [...byId('wheelEntries').children].map((row) => ({
    label: row.querySelector('.wheel-label-input').value.trim(),
    weight: Number(row.querySelector('.wheel-weight-input').value),
  }));
}

function updateWheelTotal() {
  const total = readWheelEntries().reduce(
    (sum, entry) => sum + (Number.isInteger(entry.weight) && entry.weight > 0 ? entry.weight : 0),
    0,
  );
  byId('wheelTotalWeight').textContent = `总份数 ${total}`;
  updateWheelControls();
}

async function saveWheel() {
  if (pending || wheelState?.spin) return;
  pending = true;
  updateWheelControls();
  try {
    const result = await api('/api/wheel/config', { entries: readWheelEntries() });
    renderWheelState(result.data, { syncEntries: true });
    toast('转盘设置已保存');
  } finally {
    pending = false;
    updateWheelControls();
  }
}

async function spinWheel() {
  if (hasWheelDraft() || pending || wheelState?.spin) return;
  pending = true;
  updateWheelControls();
  try {
    const result = await api('/api/wheel/spin');
    renderWheelState(result.data);
  } finally {
    pending = false;
    updateWheelControls();
  }
}

function wheelOverlayUrl() {
  return `${localOverlayOrigin()}/wheel`;
}

async function copyWheelUrl(url) {
  await copyText(url);
  toast('转盘网页地址已复制');
}

function byId(id) {
  return document.getElementById(id);
}
