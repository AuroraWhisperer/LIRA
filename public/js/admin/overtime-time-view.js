'use strict';

import { formatClockDisplay, formatClockSeconds } from '../shared/overtime-time-format.js';

export function createOvertimeTimeView({ byId, setValueUnlessFocused, getServerLimits, getSettlements }) {
  let durationDirty = false;
  let savedSeconds = 0;

  function renderSettlements() {
    const settlements = getSettlements();
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

  function markDurationDirty() {
    durationDirty = true;
  }

  function renderInitialDuration(seconds) {
    savedSeconds = Math.max(0, Number(seconds) || 0);
    if (durationDirty) return;
    const totalMinutes = Math.floor(savedSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    setValueUnlessFocused('overtimeInitialHours', String(hours));
    setValueUnlessFocused('overtimeInitialMinutes', String(totalMinutes % 60));
  }

  function readInitialDuration() {
    if (!durationDirty) return savedSeconds;
    const hours = byId('overtimeInitialHours').value.trim() || '0';
    const minutes = byId('overtimeInitialMinutes').value.trim() || '0';
    if (!/^\d+$/.test(hours) || !/^\d{1,2}$/.test(minutes)) {
      throw new Error('小时和分钟请填写非负整数，分钟需小于 60。');
    }
    return parseInitialDuration(`${hours}:${minutes.padStart(2, '0')}`);
  }

  function acceptInitialDuration(seconds) {
    durationDirty = false;
    renderInitialDuration(seconds);
  }

  function parseInitialDuration(value) {
    const serverLimits = getServerLimits();
    const text = String(value || '').trim();
    const match = text.match(/^(\d+):(\d{2})$/);
    if (!match) throw new Error('初始时长格式应为 HHH:MM。');
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (minutes > 59) throw new Error('分钟必须小于 60。');
    const seconds = (hours * 60 + minutes) * 60;
    if (!Number.isSafeInteger(seconds) || seconds > serverLimits.maxSeconds) {
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

  function formatSignedClock(seconds) {
    const number = Number(seconds) || 0;
    return `${number < 0 ? '-' : '+'}${formatClockSeconds(Math.abs(number))}`;
  }

  function formatSettlementEffect(item) {
    const applicationCount =
      item.ruleSnapshot?.quantityMode === 'item' ? Math.max(1, Math.floor(Number(item.quantity) || 1)) : 1;
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

  function createMessage(className, message) {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = message;
    return node;
  }

  return {
    renderSettlements,
    markDurationDirty,
    readInitialDuration,
    acceptInitialDuration,
    renderInitialDuration,
    parseInitialDuration,
    formatClockDisplay,
  };
}
