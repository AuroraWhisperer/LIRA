// 编写人：Aurora
// 礼物检测模块 - 负责礼物检测状态管理和显示
('use strict');

import { isLiveStatusDegraded } from '../live-status-presentation.js';

export const giftDetection = (() => {
  /**
   * 渲染礼物检测状态（toggle 和状态指示）
   * @param {Object} sprint - 冲刺配置
   * @param {Object} live - 直播连接状态
   */
  function renderDetectionStatus(sprint, live, settings = {}) {
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
      } else if (settings.giftMonitoringEnabled === 'false') {
        status.textContent = '已停收礼物';
        status.className = 'pill warn';
        status.title = '监控礼物已关闭，暂不接收新礼物。';
      } else if (isLiveStatusDegraded(live)) {
        status.textContent = '连接恢复中';
        status.className = 'pill warn';
      } else if (live.connected && !message.includes('历史消息监听中')) {
        status.textContent = '统计已开启';
        status.className = 'pill good';
      } else {
        status.textContent = message.includes('历史消息监听中') ? '待开播' : message || '未连接';
        status.className = 'pill warn';
      }
    }
  }

  return {
    renderDetectionStatus,
  };
})();
