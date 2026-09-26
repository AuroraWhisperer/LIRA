import { publishGiftModule } from '../legacy-admin-bridge.js';
import { formatTime } from '../../shared/utils.js';
// 编写人：Aurora
// 礼物检测模块 - 负责礼物检测状态管理和显示
('use strict');

export const giftDetection = (() => {
  /**
   * 渲染礼物检测状态（toggle 和状态指示）
   * @param {Object} sprint - 冲刺配置
   * @param {Object} live - 直播连接状态
   */
  function renderDetectionStatus(sprint, live) {
    // 礼物检测 toggle & 状态
    const toggle = document.getElementById('giftDetectToggle');
    if (toggle) toggle.checked = sprint.enabled === true;

    const status = document.getElementById('giftSprintStatus');
    if (status) {
      const message = String(live.message || '');
      status.title = sprint.enabled ? message : '';
      if (!sprint.enabled) {
        status.textContent = '未开启';
        status.className = 'pill warn';
      } else if (live.connected && !message.includes('历史消息监听中')) {
        status.textContent = '监听中';
        status.className = 'pill good';
      } else {
        status.textContent = message.includes('历史消息监听中') ? '待开播' : message || '未连接';
        status.className = 'pill warn';
      }
    }
  }

  /**
   * 渲染礼物诊断统计行
   * @param {Object} diagnostics - 诊断数据
   */
  function renderGiftStatusLine(diagnostics) {
    const node = document.getElementById('giftStatusLine');
    if (!node) return;

    const parts = [];

    // 诊断统计
    if (diagnostics) {
      if (diagnostics.lastPacketAt) {
        parts.push(`收包 ${formatTime(diagnostics.lastPacketAt)}`);
      }
      const count = Number(diagnostics.parsedGiftCount || 0);
      parts.push(`已解析 ${count} 条`);
      const recentGiftLike = Array.isArray(diagnostics.recentGiftLikeCommands)
        ? diagnostics.recentGiftLikeCommands
        : [];
      const lastGiftLike = recentGiftLike[0];
      if (lastGiftLike) {
        parts.push(`未识别 ${lastGiftLike.cmd}`);
      }
    }

    node.textContent = parts.join(' · ') || '等待直播消息…';
  }

  return {
    renderDetectionStatus,
    renderGiftStatusLine,
  };
})();
publishGiftModule('detection', giftDetection);
