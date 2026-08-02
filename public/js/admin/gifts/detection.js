// 编写人：Aurora
// 礼物检测模块 - 负责礼物检测状态管理和显示
'use strict';

(function () {
  const { formatTime } = window.AdminApp.utils;

  /**
   * 渲染礼物检测状态（toggle 和状态指示）
   * @param {Object} sprint - 冲刺配置
   * @param {Object} live - 直播连接状态
   */
  function renderDetectionStatus(sprint, live) {
    // 礼物检测 toggle & 状态
    const toggle = document.getElementById('giftDetectToggle');
    const label = document.getElementById('giftDetectLabel');
    if (toggle && label) {
      toggle.checked = sprint.enabled === true;
      label.textContent = sprint.enabled ? '已开启' : '已关闭';
    }

    const status = document.getElementById('giftSprintStatus');
    if (status) {
      if (!sprint.enabled) {
        status.textContent = '未开启';
        status.className = 'pill warn';
      } else if (live.connected && !String(live.message || '').includes('历史消息监听中')) {
        status.textContent = '监听中';
        status.className = 'pill good';
      } else {
        status.textContent = live.message || '未连接';
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
      const recentGiftLike = Array.isArray(diagnostics.recentGiftLikeCommands) ? diagnostics.recentGiftLikeCommands : [];
      const lastGiftLike = recentGiftLike[0];
      if (lastGiftLike) {
        parts.push(`未识别 ${lastGiftLike.cmd}`);
      }
    }

    node.textContent = parts.join(' · ') || '等待直播消息…';
  }

  // 导出
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.detection = {
    renderDetectionStatus,
    renderGiftStatusLine
  };
})();
