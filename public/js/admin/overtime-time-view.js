'use strict';

export function createOvertimeTimeView({
  byId,
  setValueUnlessFocused,
  getServerLimits,
  getSettlements,
}) {
  function renderSettlements() {
    const settlements = getSettlements();
    const root = byId('overtimeSettlements');
    root.replaceChildren();
    if (!settlements.length) {
      root.append(
        createMessage('overtime-settlement-empty', '本场还没有礼物结算。'),
      );
      return;
    }
    for (const item of settlements) {
      const row = document.createElement('div');
      row.className = 'overtime-settlement-row';
      const identity = document.createElement('strong');
      identity.textContent = `${item.giftName || item.giftId} ×${item.quantity}`;
      const mode = document.createElement('span');
      mode.textContent =
        item.ruleMode === 'random'
          ? '时间盲盒'
          : item.ruleMode === 'fixed'
            ? '固定时间'
            : item.ruleMode === 'display'
              ? '文字展板'
              : '已忽略';
      const delta = document.createElement('span');
      delta.textContent =
        item.ruleMode === 'display'
          ? item.ruleSnapshot?.displayText || '不改时间'
          : item.appliedDeltaSeconds === null
            ? '—'
            : formatSettlementEffect(item);
      delta.className =
        item.ruleMode === 'display'
          ? 'is-display'
          : Number(item.appliedDeltaSeconds) >= 0
            ? 'is-positive'
            : 'is-negative';
      const time = document.createElement('time');
      time.textContent = item.updatedAt
        ? new Date(item.updatedAt).toLocaleTimeString('zh-CN', {
            hour12: false,
          })
        : '';
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
      renderDurationSelectors(
        parseInitialDuration(byId('overtimeInitialTime').value),
      );
    } catch (_) {
      return;
    }
  }

  function syncDurationInputFromSelectors() {
    const hours = Number(byId('overtimeInitialHours').value) || 0;
    const minutes = Number(byId('overtimeInitialMinutes').value) || 0;
    byId('overtimeInitialTime').value = formatInitialDuration(
      (hours * 60 + minutes) * 60,
    );
  }

  function renderInitialDuration(seconds) {
    const normalizedSeconds = Math.max(
      0,
      Math.floor((Number(seconds) || 0) / 60) * 60,
    );
    setValueUnlessFocused(
      'overtimeInitialTime',
      formatInitialDuration(normalizedSeconds),
    );
    renderDurationSelectors(normalizedSeconds);
  }

  function renderDurationSelectors(seconds) {
    const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
    setValueUnlessFocused(
      'overtimeInitialHours',
      String(Math.floor(totalMinutes / 60)),
    );
    setValueUnlessFocused('overtimeInitialMinutes', String(totalMinutes % 60));
  }

  function parseInitialDuration(value) {
    const serverLimits = getServerLimits();
    const text = String(value || '').trim();
    const match = text.match(/^(\d{1,3}):(\d{2})$/);
    if (!match) throw new Error('初始时长格式应为 HHH:MM。');
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (minutes > 59) throw new Error('分钟必须小于 60。');
    const seconds = (hours * 60 + minutes) * 60;
    if (seconds > serverLimits.maxSeconds) {
      throw new Error(
        `初始时长不能超过 ${formatMaxSeconds(serverLimits.maxSeconds)}。`,
      );
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
    const finished =
      status === 'finished' || (status === 'running' && remainingMs === 0);
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
    const applicationCount =
      item.ruleSnapshot?.quantityMode === 'item'
        ? Math.max(1, Math.floor(Number(item.quantity) || 1))
        : 1;
    if (applicationCount > 1) {
      return `结算 ${applicationCount} 次 · ${formatSignedClock(item.appliedDeltaSeconds)}`;
    }
    const effect =
      item.outcome?.selectedEffect ?? item.ruleSnapshot?.fixedEffect;
    if (!effect) return formatSignedClock(item.appliedDeltaSeconds);
    if (effect.operation === 'multiply')
      return `×${effect.value}（${formatSignedClock(item.appliedDeltaSeconds)}）`;
    if (effect.operation === 'divide')
      return `÷${effect.value}（${formatSignedClock(item.appliedDeltaSeconds)}）`;
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

  return {
    renderSettlements,
    populateInitialDurationSelectors,
    syncDurationSelectorsFromInput,
    syncDurationInputFromSelectors,
    renderInitialDuration,
    parseInitialDuration,
    formatClockDisplay,
  };
}
