'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import { createOvertimeGiftPicker } from './overtime-gift-picker.js';
import { api, copyText, localOverlayOrigin, readJsonResponse, showConfirmationDialog, showError, toast } from '../shared/utils.js';
import { createOvertimeRuleEditor } from './overtime-rule-editor.js';
import { createOvertimeTimeView } from './overtime-time-view.js';
import { createOvertimeStatusView } from './overtime-status-view.js';
import { createOvertimeAppearance } from './overtime-preview.js';
import { readComponentOutputSize } from './scene-api.js';

let initialized = false;
let serverLimits = null;
let giftDetection = null;
let settlements = [];
let rulesDirty = false;
let rulesSaving = false;
let rulesEditRevision = 0;
let appearance = null;
let displayRevision = 0;
let catalogLiveStatus = null;
let ruleEditor = null;
let timeChangePending = false;

const giftPicker = createOvertimeGiftPicker({
  getLiveStatus: () => catalogLiveStatus,
  onSelect(gift, previousRow) {
    const row = previousRow ? ruleEditor.reselectGift(previousRow, gift) : ruleEditor.createRule(gift);
    if (!row) { toast('原规则已删除或变更，请重新选择要修改的规则。', { type: 'warn' }); return; }
    row.scrollIntoView({ block: 'nearest' });
  },
});

const overtimeTimeView = createOvertimeTimeView({
  byId,
  setValueUnlessFocused,
  getServerLimits: () => serverLimits,
  getSettlements: () => settlements,
});
const {
  renderSettlements,
  markDurationDirty,
  readInitialDuration,
  acceptInitialDuration,
  renderInitialDuration,
  formatClockDisplay,
} = overtimeTimeView;

const overtimeStatusView = createOvertimeStatusView({
  byId,
  formatClockDisplay,
  renderInitialDuration,
  getGiftDetection: () => giftDetection,
  getRuleEditor: () =>
    ruleEditor
      ? {
          renderRules: (rules) => ruleEditor.renderRules(giftPicker.decorateRules(rules)),
        }
      : null,
  isRulesDirty: () => rulesDirty,
  onLimits: (limits) => {
    serverLimits = limits;
    ruleEditor?.setLimits(limits);
  },
});
const { syncClockLoop, stopClockLoop } = overtimeStatusView;

function renderState(state, options) {
  if (overtimeStatusView.renderState(state, options) === false) return;
  displayRevision += 1;
  appearance?.receive(overtimeStatusView.getState(), options);
}

export function initOvertime(currentState = {}) {
  if (initialized || !document.getElementById('overtimePanel')) return;
  initialized = true;
  giftDetection = currentState?.giftDetection || giftDetection;
  catalogLiveStatus = currentState?.liveStatus || catalogLiveStatus;
  appearance = createOvertimeAppearance({ initial: currentState?.overtime || {}, onSavedState: renderState });
  ruleEditor = createOvertimeRuleEditor(byId('overtimeRules'), markRulesDirty, {
    onReselect: (row) => giftPicker.open(row),
  });
  bindControls();
  if (currentState?.overtime) renderState(currentState.overtime);
  eventBus.on(Events.STATE_LOADED, ({ state, isConnectionSnapshot }) => {
    giftDetection = state?.giftDetection || giftDetection;
    catalogLiveStatus = state?.liveStatus || catalogLiveStatus;
    if (state?.overtime) renderState(state.overtime, { allowRevisionReset: isConnectionSnapshot });
    giftPicker.renderStatus();
  });
  eventBus.on(Events.OVERTIME_UPDATED, (payload) => {
    renderState(payload.state);
    if (payload.adjustment) refresh().catch(showError);
  });
  eventBus.on(Events.GIFT_CATALOG_UPDATED, ({ snapshot }) => {
    if (snapshot?.source === 'server') giftPicker.applyServerGiftArtwork(snapshot);
    else giftPicker.applyGiftCatalog(snapshot);
  });
  eventBus.on('app:shutdown', stopClockLoop);
  document.addEventListener('visibilitychange', syncClockLoop);
  giftPicker.load().catch(showError);
  refresh().catch(showError);
}

async function refresh() {
  const requestedRevision = displayRevision;
  const response = await fetch('/api/overtime');
  const payload = await readJsonResponse(response, '读取加班机失败');
  if (!payload.ok) throw new Error(payload.error || '读取加班机失败');
  settlements = payload.data.settlements || [];
  if (requestedRevision === displayRevision) renderState(payload.data);
  renderSettlements();
}

function bindControls() {
  overtimeStatusView.setBusy(false);
  byId('overtimeEnableBtn').addEventListener('click', () =>
    runAction(overtimeStatusView.getState()?.enabled ? 'disable' : 'enable'),
  );
  byId('overtimeStartBtn').addEventListener('click', () =>
    runAction(overtimeStatusView.getState()?.status === 'running' ? 'pause' : 'start'),
  );
  byId('overtimeResetBtn').addEventListener('click', () => runAction('reset'));
  byId('overtimeApplyTimeBtn').addEventListener('click', applyTime);
  byId('overtimeInitialHours').addEventListener('input', markDurationDirty);
  byId('overtimeInitialMinutes').addEventListener('input', markDurationDirty);
  giftPicker.bind();
  byId('overtimeRules').addEventListener('input', markRulesDirty);
  byId('overtimeRules').addEventListener('change', markRulesDirty);
  byId('overtimeSaveRulesBtn').addEventListener('click', saveRules);
  byId('overtimeOpenOverlayBtn').addEventListener('click', () => appearance.open());
  byId('overtimeCopyOverlayBtn').addEventListener('click', copyOverlayUrl);
  syncRulesSaveButton();
}

async function runAction(action) {
  if (timeChangePending) return;
  setTimeChangePending(true);
  try {
    if (action === 'start') {
      await startOvertime();
      return;
    }
    if (action === 'reset' && !(await confirmTimeReset(overtimeStatusView.getState()?.initialSeconds || 0))) return;
    await requestAction(action);
  } catch (error) {
    showError(error);
  } finally {
    setTimeChangePending(false);
  }
}

async function requestAction(action) {
  const result = await api('/api/overtime/action', { action }, { notifyError: false });
  renderState(result.data);
}

async function startOvertime() {
  const state = overtimeStatusView.getState();
  const initialSeconds = readInitialDuration();
  const replaceTime = initialSeconds !== state.initialSeconds || state.effectiveRemainingMs <= 0;
  if (replaceTime) {
    if (initialSeconds <= 0) {
      throw new Error('请先填写大于 0 的初始时长，再开始加班。');
    }
    if (state.effectiveRemainingMs > 0 && !(await confirmTimeReset(initialSeconds, true, true))) return;
  }
  if (!(await saveRules())) return;
  if (replaceTime) await saveTime(initialSeconds);
  if (!overtimeStatusView.getState().enabled) await requestAction('enable');
  await requestAction('start');
}

function setTimeChangePending(value) {
  timeChangePending = value;
  overtimeStatusView.setBusy(value);
}

async function saveTime(initialSeconds) {
  const result = await api('/api/overtime/time', {
    initialSeconds,
    remainingSeconds: initialSeconds,
  }, { notifyError: false });
  renderState(result.data);
  acceptInitialDuration(overtimeStatusView.getState().initialSeconds);
}

async function applyTime() {
  if (timeChangePending) return;
  setTimeChangePending(true);
  try {
    const initialSeconds = readInitialDuration();
    if (!(await confirmTimeReset(initialSeconds, true))) return;
    await saveTime(initialSeconds);
    toast('初始时长已设置，倒计时已重置并暂停');
  } catch (error) {
    showError(error);
  } finally {
    setTimeChangePending(false);
  }
}

function confirmTimeReset(initialSeconds, applying = false, starting = false) {
  return showConfirmationDialog({
    variant: 'caution',
    title: starting ? '替换剩余时间并开始？' : applying ? '设置初始时间并重置倒计时？' : '重置倒计时？',
    message: `当前剩余时间将被替换为 ${formatClockDisplay(initialSeconds * 1000, 'paused')}，${starting ? '随后开始倒计时' : '倒计时会停止'}。已累积的剩余时间无法恢复。`,
    confirmLabel: starting ? '替换并开始' : applying ? '设置并重置' : '重置倒计时',
  });
}

async function saveRules() {
  if (rulesSaving) return false;
  if (!rulesDirty) return true;
  rulesSaving = true;
  syncRulesSaveButton();
  try {
    const rules = ruleEditor.readRules();
    const submittedRevision = rulesEditRevision;
    const result = await api('/api/overtime/rules', { rules }, { notifyError: false });
    rulesDirty = rulesEditRevision !== submittedRevision;
    renderState(result.data);
    toast(rulesDirty ? '本次修改已保存，仍有未保存的更改' : '修改已保存');
    return !rulesDirty;
  } catch (error) {
    showError(error);
    return false;
  } finally {
    rulesSaving = false;
    syncRulesSaveButton();
  }
}

function markRulesDirty() {
  rulesEditRevision += 1;
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
  button.hidden = !rulesDirty && !rulesSaving;
  button.classList.toggle('is-dirty', state.dirty);
}

function overlayUrl() {
  return `${localOverlayOrigin()}/overtime`;
}

async function copyOverlayUrl() {
  try {
    const size = await readComponentOutputSize('overtime').catch(() => null);
    await copyText(overlayUrl());
    toast(size ? `加班机浏览器源地址已复制；浏览器源尺寸设为 ${size.width} × ${size.height}`
      : '加班机浏览器源地址已复制；需要固定宽高时，请在画布中调整后点击“保存并应用”。');
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
