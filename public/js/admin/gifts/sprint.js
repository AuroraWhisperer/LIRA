import { localOverlayOrigin, toast } from '../../shared/utils.js';
import { bindCopyUrl } from '../../shared/copy-url.js';
import { renderGiftSprintText } from '../../shared/gift-sprint-text.js';
import { openComponentPreview } from '../component-preview-dialog.js';

import { formatMoney } from '../../shared/display-format.js';
// 编写人：Aurora
// 月底冲刺模块 - 负责月底冲刺目标和水晶球统计显示
('use strict');

function setNodeState(node, state) {
  if (!node) return;
  if (node.dataset) node.dataset.state = state;
  else node.setAttribute?.('data-state', state);
}

function syncPresetHighlight(targetRmb) {
  const numeric = Number(targetRmb);
  const buttons = document.querySelectorAll?.('#giftSprintForm [data-sprint-preset]');
  if (!buttons) return;
  buttons.forEach((button) => {
    const active = Number.isFinite(numeric) && numeric > 0 && Number(button.dataset?.sprintPreset) === numeric;
    button.classList?.toggle('is-active', active);
    button.setAttribute?.('aria-pressed', active ? 'true' : 'false');
  });
}

function resolveSprintView(sprint) {
  const targetRmb = Math.max(0, Number(sprint?.targetRmb) || 0);
  const receivedRmb = Math.max(0, Number(sprint?.receivedRmb) || 0);
  const remainingRmb = Math.max(0, Number(sprint?.remainingRmb) || 0);
  const remainingBalls = Math.max(0, Number(sprint?.remainingCrystalBalls) || 0);
  const hasTarget = targetRmb > 0;
  const isDone = hasTarget && remainingBalls === 0;
  const state = !hasTarget ? 'unset' : isDone ? 'done' : 'active';
  const rawPercent = hasTarget ? Math.min(100, (receivedRmb / targetRmb) * 100) : 0;
  const displayPercent = isDone ? 100 : Math.min(99.9, rawPercent);
  const percentText = !hasTarget ? '—' : isDone ? '100%' : `${displayPercent.toFixed(1)}%`;
  const exceededRmb = isDone ? Math.max(0, Math.round((receivedRmb - targetRmb) * 100) / 100) : 0;
  return {
    targetRmb,
    receivedRmb,
    remainingRmb,
    remainingBalls,
    hasTarget,
    isDone,
    state,
    progressWidth: hasTarget ? (isDone ? 100 : rawPercent) : 0,
    percentText,
    exceededRmb,
  };
}

export const giftSprint = (() => {
  /**
   * 渲染月底冲刺统计
   * @param {Object} sprint - 冲刺数据
   */
  function renderSprintStats(sprint) {
    const view = resolveSprintView(sprint);
    const targetNode = document.getElementById('giftSprintTarget');
    const receivedNode = document.getElementById('giftSprintReceived');
    const remainingNode = document.getElementById('giftSprintRemaining');
    const crystalBallsNode = document.getElementById('giftSprintCrystalBalls');

    if (targetNode) {
      targetNode.textContent = view.hasTarget ? formatMoney(view.targetRmb) : '未设定';
      setNodeState(targetNode, view.state);
    }
    if (receivedNode) {
      receivedNode.textContent = formatMoney(view.receivedRmb);
    }
    if (remainingNode) {
      remainingNode.textContent = view.hasTarget ? formatMoney(view.remainingRmb) : '—';
      setNodeState(remainingNode, view.state);
    }
    if (crystalBallsNode) {
      crystalBallsNode.textContent = !view.hasTarget
        ? '暂未设置目标'
        : view.isDone
          ? '本轮目标已达成'
          : `${view.remainingBalls}`;
      setNodeState(crystalBallsNode, view.state);
    }

    const eyebrow = document.getElementById('giftSprintHeroEyebrow');
    if (eyebrow) {
      eyebrow.textContent = !view.hasTarget ? '当前状态' : view.isDone ? '冲刺状态' : '距目标还差';
    }
    const unit = document.getElementById('giftSprintCrystalUnit');
    if (unit) {
      unit.hidden = view.state !== 'active';
    }
    const extra = document.getElementById('giftSprintHeroExtra');
    if (extra) {
      const showExtra = view.isDone && view.exceededRmb > 0;
      extra.hidden = !showExtra;
      extra.textContent = showExtra ? `超出 ${formatMoney(view.exceededRmb)}` : '';
    }

    const percentNode = document.getElementById('giftSprintPercent');
    if (percentNode) {
      percentNode.textContent = view.percentText;
      setNodeState(percentNode, view.state);
    }

    const badge = document.getElementById('giftSprintStateBadge');
    const badgeText = document.getElementById('giftSprintStateBadgeText');
    if (badge) setNodeState(badge, view.state);
    if (badgeText) {
      badgeText.textContent = !view.hasTarget
        ? '未设目标'
        : view.isDone
          ? '本轮已达成'
          : `冲刺中 · ${view.percentText}`;
    }

    const progressBar = document.getElementById('giftSprintProgressBar');
    if (progressBar) {
      progressBar.setAttribute?.('aria-valuenow', String(Math.round(view.progressWidth)));
    }
    const progressFill = document.getElementById('giftSprintProgressFill');
    if (progressFill) {
      if (progressFill.style) progressFill.style.width = `${view.progressWidth}%`;
      setNodeState(progressFill, view.state);
    }

    const targetInput = document.getElementById('giftSprintTargetRmb');
    const activeTarget = targetInput?.dataset?.dirty === 'true' ? Number(targetInput.value) : view.targetRmb;
    syncPresetHighlight(activeTarget);
    renderGiftSprintOverlay(sprint);
  }

  return {
    renderSprintStats,
  };
})();

export function initGiftSprintOverlay() {
  const url = `${localOverlayOrigin(location)}/gift-sprint`;
  document.getElementById('giftSprintOverlayUrl').textContent = url;
  bindCopyUrl(document.getElementById('giftSprintOverlayUrl'), { onCopied: () => toast('月底冲刺浏览器源地址已复制') });
  document.getElementById('giftSprintPreview').addEventListener('click', () => {
    openComponentPreview({ id: 'gift-sprint' });
  });

  const targetInput = document.getElementById('giftSprintTargetRmb');
  document.querySelectorAll?.('#giftSprintForm [data-sprint-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!targetInput) return;
      targetInput.value = button.dataset.sprintPreset || '';
      syncPresetHighlight(Number(targetInput.value));
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  targetInput?.addEventListener('input', () => {
    syncPresetHighlight(Number(targetInput.value));
  });
}

export function renderGiftSprintOverlay(sprint) {
  const preview = document.getElementById('giftSprintTextPreview');
  if (!preview) return;
  renderGiftSprintText(preview, sprint);
  const panel = document.getElementById('giftSprintOverlayPanel');
  if (panel) {
    const state = preview.hidden ? 'unset' : Number(sprint?.remainingCrystalBalls || 0) === 0 ? 'done' : 'active';
    setNodeState(panel, state);
  }
  document.getElementById('giftSprintOverlayStatus').textContent = preview.hidden
    ? '请先设置冲刺目标，设置后会自动显示文字。'
    : sprint.remainingCrystalBalls === 0
      ? '本轮目标已达成。'
      : sprint.enabled === false
        ? '礼物统计已暂停，开启后继续更新进度。'
        : '';
}
