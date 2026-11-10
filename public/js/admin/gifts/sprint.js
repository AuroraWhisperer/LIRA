import { localOverlayOrigin, toast } from '../../shared/utils.js';
import { bindCopyUrl } from '../../shared/copy-url.js';
import { renderGiftSprintText } from '../../shared/gift-sprint-text.js';
import { openComponentPreview } from '../component-preview-dialog.js';

import { formatMoney } from '../../shared/display-format.js';
// 编写人：Aurora
// 月底冲刺模块 - 负责月底冲刺目标和水晶球统计显示
('use strict');

export const giftSprint = (() => {
  /**
   * 渲染月底冲刺统计
   * @param {Object} sprint - 冲刺数据
   */
  function renderSprintStats(sprint) {
    document.getElementById('giftSprintTarget').textContent = formatMoney(sprint.targetRmb);
    document.getElementById('giftSprintReceived').textContent = formatMoney(sprint.receivedRmb);
    document.getElementById('giftSprintRemaining').textContent = formatMoney(sprint.remainingRmb);
    document.getElementById('giftSprintCrystalBalls').textContent = `${Number(sprint.remainingCrystalBalls || 0)} 个`;
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
}

export function renderGiftSprintOverlay(sprint) {
  const preview = document.getElementById('giftSprintTextPreview');
  if (!preview) return;
  renderGiftSprintText(preview, sprint);
  document.getElementById('giftSprintOverlayStatus').textContent = preview.hidden
    ? '请先设置冲刺目标，设置后会自动显示文字。'
    : sprint.remainingCrystalBalls === 0
      ? '本轮目标已达成。'
      : sprint.enabled === false
        ? '礼物统计已暂停，开启后继续更新进度。'
        : '';
}
