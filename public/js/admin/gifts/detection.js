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
      if (settings.giftMonitoringEnabled === 'false') {
        status.textContent = '已停收礼物';
        status.className = 'pill warn';
        status.title = '监控礼物已关闭，暂不接收新礼物与自动答谢。';
        status.hidden = false;
      } else if (!sprint.enabled) {
        status.textContent = '统计已暂停';
        status.className = 'pill warn';
        status.title = '本机礼物统计已暂停，不影响加班机和云端接收礼物。';
        status.hidden = false;
      } else if (isLiveStatusDegraded(live)) {
        status.textContent = '连接恢复中';
        status.className = 'pill warn';
        status.title = message;
        status.hidden = false;
      } else {
        status.textContent = '';
        status.className = 'pill good';
        status.title = message;
        status.hidden = true;
      }
    }
  }

  return {
    renderDetectionStatus,
  };
})();
