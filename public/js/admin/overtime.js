'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import { createOvertimeGiftPicker } from './overtime-gift-picker.js';
import { api, copyText, localOverlayOrigin, readJsonResponse, showConfirmationDialog, showError, toast } from '../shared/utils.js';
import { createOvertimeRuleEditor } from './overtime-rule-editor.js';
import { createOvertimeTimeView } from './overtime-time-view.js';
import { createOvertimeStatusView } from './overtime-status-view.js';
import { createOvertimeAppearance } from './overtime-preview.js';

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
    row.scrollIntoView({ block: 'nearest' });
    toast(previousRow ? `已选择 ${gift.name}，原规则设置已保留` : `已添加 ${gift.name}`);
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
  populateInitialDurationSelectors,
  syncDurationSelectorsFromInput,
  syncDurationInputFromSelectors,
  renderInitialDuration,
  parseInitialDuration,
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
  populateInitialDurationSelectors();
  byId('overtimeEnableBtn').addEventListener('click', () =>
    runAction(overtimeStatusView.getState()?.enabled ? 'disable' : 'enable'),
  );
  byId('overtimeStartBtn').addEventListener('click', () => runAction('start'));
  byId('overtimePauseBtn').addEventListener('click', () => runAction('pause'));
  byId('overtimeResetBtn').addEventListener('click', () => runAction('reset'));
  byId('overtimeApplyTimeBtn').addEventListener('click', applyTime);
  byId('overtimeInitialTime').addEventListener('input', syncDurationSelectorsFromInput);
  byId('overtimeInitialHours').addEventListener('change', syncDurationInputFromSelectors);
  byId('overtimeInitialMinutes').addEventListener('change', syncDurationInputFromSelectors);
  giftPicker.bind();
  byId('overtimeRules').addEventListener('input', markRulesDirty);
  byId('overtimeRules').addEventListener('change', markRulesDirty);
  byId('overtimeSaveRulesBtn').addEventListener('click', saveRules);
  byId('overtimeOpenOverlayBtn').addEventListener('click', () => appearance.open());
  byId('overtimeCopyOverlayBtn').addEventListener('click', copyOverlayUrl);
  syncRulesSaveButton();
}

async function runAction(action) {
  if (action === 'reset' && timeChangePending) return;
  if (action === 'reset') timeChangePending = true;
  try {
    if (action === 'reset' && !(await confirmTimeReset(overtimeStatusView.getState()?.initialSeconds || 0))) return;
    const result = await api('/api/overtime/action', { action });
    renderState(result.data);
  } catch (_) {
  } finally {
    if (action === 'reset') timeChangePending = false;
  }
}

async function applyTime() {
  if (timeChangePending) return;
  timeChangePending = true;
  try {
    const initialSeconds = parseInitialDuration(byId('overtimeInitialTime').value);
    if (!(await confirmTimeReset(initialSeconds, true))) return;
    const result = await api('/api/overtime/time', {
      initialSeconds,
      remainingSeconds: initialSeconds,
    });
    renderState(result.data);
    toast('初始时间已设置，倒计时已重置并暂停');
  } catch (error) {
    showError(error);
  } finally {
    timeChangePending = false;
  }
}

function confirmTimeReset(initialSeconds, applying = false) {
  return showConfirmationDialog({
    variant: 'caution',
    title: applying ? '设置初始时间并重置倒计时？' : '重置倒计时？',
    message: `当前剩余时间将被替换为 ${formatClockDisplay(initialSeconds * 1000, 'paused')}，倒计时会停止。已累积的剩余时间无法恢复。`,
    confirmLabel: applying ? '设置并重置' : '重置倒计时',
  });
}

async function saveRules() {
  if (rulesSaving || !rulesDirty) return;
  rulesSaving = true;
  syncRulesSaveButton();
  try {
    const rules = ruleEditor.readRules();
    const submittedRevision = rulesEditRevision;
    const result = await api('/api/overtime/rules', { rules });
    rulesDirty = rulesEditRevision !== submittedRevision;
    renderState(result.data);
    toast(rulesDirty ? '本次修改已保存，仍有未保存的更改' : '修改已保存');
  } catch (error) {
    showError(error);
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
  button.classList.toggle('is-dirty', state.dirty);
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
