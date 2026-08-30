'use strict';

export function createOvertimeStatusView({
  byId,
  formatClockDisplay,
  renderInitialDuration,
  setValueUnlessFocused,
  getGiftDetection,
  getRuleEditor,
  isRulesDirty,
  isBackgroundDirty,
  syncRuleAvailability,
  onLimits,
}) {
  let overtimeState = null;
  let anchorRemainingMs = 0;
  let localAnchorMs = 0;
  let clockRafId = null;
  let lastClockValue = '';

  function renderState(nextState) {
    if (!nextState) return;
    if (nextState.limits) onLimits(nextState.limits);
    overtimeState = { ...overtimeState, ...nextState };
    anchorRemainingMs = Number(overtimeState.effectiveRemainingMs) || 0;
    localAnchorMs = performance.now();
    const enabled = overtimeState.enabled === true;
    const statusLabels = {
      disabled: '未启用',
      paused: '已暂停',
      running: '直播加班中',
      finished: '已结束',
    };
    byId('overtimeClockLabel').textContent =
      statusLabels[overtimeState.status] || '状态未知';
    byId('overtimeEnableBtn').textContent = enabled
      ? '关闭加班机'
      : '启用加班机';
    byId('overtimeStartBtn').disabled =
      !enabled || overtimeState.status === 'running' || anchorRemainingMs <= 0;
    byId('overtimePauseBtn').disabled =
      !enabled || overtimeState.status !== 'running';
    byId('overtimeResetBtn').disabled = !enabled;
    renderInitialDuration(Number(overtimeState.initialSeconds) || 0);
    if (!isBackgroundDirty()) {
      setValueUnlessFocused(
        'overtimeBackgroundPath',
        overtimeState.background?.path || '',
      );
      setValueUnlessFocused(
        'overtimeBackgroundFit',
        overtimeState.background?.fit || 'cover',
      );
    }
    byId('overtimePendingCount').textContent =
      `待结算 ${Number(overtimeState.pendingCount) || 0}`;
    renderConsumerStatus();
    if (Array.isArray(nextState.rules) && !isRulesDirty()) {
      getRuleEditor()?.renderRules(nextState.rules);
      syncRuleAvailability();
    }
    syncClockLoop();
  }

  function renderConsumerStatus() {
    const giftDetection = getGiftDetection();
    const consumers = giftDetection?.consumers || {};
    const overtimeEnabled = overtimeState?.enabled === true;
    const coreActive = giftDetection?.coreActive === true || overtimeEnabled;
    setStatus(
      byId('overtimeCoreStatus'),
      `共享收礼核心：${coreActive ? '运行中' : '未运行'}`,
      coreActive,
    );
    setStatus(
      byId('overtimeGiftStatsStatus'),
      `礼物统计：${consumers.giftStatistics ? '开启' : '关闭'}`,
      consumers.giftStatistics,
    );
    setStatus(
      byId('overtimeConsumerStatus'),
      `加班机：${overtimeEnabled ? '开启' : '关闭'}`,
      overtimeEnabled,
    );
  }

  function setStatus(node, label, active) {
    node.textContent = label;
    node.classList.toggle('good', Boolean(active));
    node.classList.toggle('warn', !active);
  }

  function updateClock(nowMs) {
    if (overtimeState) {
      const elapsed =
        overtimeState.status === 'running'
          ? Math.max(0, nowMs - localAnchorMs)
          : 0;
      const remainingMs = Math.max(0, anchorRemainingMs - elapsed);
      const value = formatClockDisplay(remainingMs, overtimeState.status);
      const clock = byId('overtimeClockValue');
      if (value !== lastClockValue) {
        clock.textContent = value;
        clock.classList.toggle('is-calendar', /[天年]/.test(value));
        clock.classList.toggle('is-finished', value === '该下播了');
        lastClockValue = value;
      }
      if (
        overtimeState.status === 'running' &&
        document.visibilityState === 'visible'
      ) {
        clockRafId = requestAnimationFrame(updateClock);
        return;
      }
    }
    clockRafId = null;
  }

  function syncClockLoop() {
    const shouldRun =
      overtimeState?.status === 'running' &&
      document.visibilityState === 'visible';
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

  return {
    renderState,
    getState: () => overtimeState,
    syncClockLoop,
    stopClockLoop,
  };
}
