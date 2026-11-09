'use strict';

import { nextClockDelay } from '../shared/overtime-time-format.js';

export function createOvertimeStatusView({
  byId,
  formatClockDisplay,
  renderInitialDuration,
  getGiftDetection,
  getRuleEditor,
  isRulesDirty,
  onLimits,
}) {
  let overtimeState = null;
  let anchorRemainingMs = 0;
  let localAnchorMs = 0;
  let clockTimer = null;
  let lastClockValue = '';
  let busy = false;

  function renderState(nextState, { allowRevisionReset = false } = {}) {
    if (!nextState || (!allowRevisionReset && Number(nextState.revision) < Number(overtimeState?.revision))) return false;
    if (nextState.limits) onLimits(nextState.limits);
    overtimeState = { ...overtimeState, ...nextState };
    anchorRemainingMs = Number(overtimeState.effectiveRemainingMs) || 0;
    localAnchorMs = performance.now();
    const statusLabels = {
      disabled: '未开始',
      paused: '已暂停',
      running: '直播加班中',
      finished: '已结束',
    };
    byId('overtimeClockLabel').textContent = statusLabels[overtimeState.status] || '状态未知';
    renderControls();
    renderInitialDuration(Number(overtimeState.initialSeconds) || 0);
    const quantityLimitedCount = Number(overtimeState.quantityLimitedCount) || 0;
    byId('overtimePendingCount').textContent =
      `待结算 ${Number(overtimeState.pendingCount) || 0}` +
      (quantityLimitedCount > 0 ? `（${quantityLimitedCount} 笔数量超限，尚未结算）` : '');
    renderConsumerStatus();
    if (Array.isArray(nextState.rules) && !isRulesDirty()) {
      getRuleEditor()?.renderRules(nextState.rules);
    }
    syncClockLoop();
    return true;
  }

  function renderControls() {
    const enabled = overtimeState?.enabled === true;
    const running = overtimeState?.status === 'running';
    const hasTime = Number(overtimeState?.effectiveRemainingMs) > 0;
    const ready = Boolean(overtimeState?.limits);
    byId('overtimeStartBtn').textContent = busy ? '处理中…' : running ? '暂停' : hasTime ? '继续加班' : '开始加班';
    byId('overtimeStartBtn').disabled = busy || !ready;
    byId('overtimeEnableBtn').textContent = enabled ? '关闭加班机' : '只启用收礼';
    for (const id of ['overtimeEnableBtn', 'overtimeResetBtn', 'overtimeApplyTimeBtn', 'overtimeInitialHours', 'overtimeInitialMinutes']) {
      byId(id).disabled = busy || !ready;
    }
    byId('overtimeControlHint').textContent = running
      ? '正在倒计时，收到礼物会按已保存规则调整时间。'
      : enabled
        ? '倒计时已停，礼物仍会按规则结算。要停止收礼，请点「关闭加班机」。'
        : hasTime
          ? '已保留剩余时间，点击继续加班即可恢复。'
          : '填写初始时长，点击开始；有礼物规则时会一起保存。';
  }

  function renderConsumerStatus() {
    const giftDetection = getGiftDetection();
    const consumers = giftDetection?.consumers || {};
    const overtimeEnabled = overtimeState?.enabled === true;
    const coreActive = giftDetection?.coreActive === true || overtimeEnabled;
    setStatus(byId('overtimeCoreStatus'), `礼物处理：${coreActive ? '运行中' : '未运行'}`, coreActive);
    setStatus(
      byId('overtimeGiftStatsStatus'),
      `礼物统计：${consumers.giftStatistics ? '开启' : '关闭'}`,
      consumers.giftStatistics,
    );
    setStatus(byId('overtimeConsumerStatus'), `加班机：${overtimeEnabled ? '开启' : '关闭'}`, overtimeEnabled);
  }

  function setStatus(node, label, active) {
    node.textContent = label;
    node.classList.toggle('good', Boolean(active));
    node.classList.toggle('warn', !active);
  }

  function updateClock() {
    clockTimer = null;
    if (overtimeState) {
      const nowMs = performance.now();
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
      if (overtimeState.status === 'running' && remainingMs > 0 && document.visibilityState === 'visible') {
        clockTimer = setTimeout(updateClock, nextClockDelay(remainingMs));
      }
    }
  }

  function syncClockLoop() {
    stopClockLoop();
    updateClock();
  }

  function stopClockLoop() {
    if (clockTimer !== null) clearTimeout(clockTimer);
    clockTimer = null;
  }

  return {
    renderState,
    getState: () => overtimeState,
    syncClockLoop,
    stopClockLoop,
    setBusy(value) {
      busy = value;
      renderControls();
    },
  };
}
