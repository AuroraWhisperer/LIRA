import { publishGiftModule } from '../legacy-admin-bridge.js';
import { formatMoney } from '../../shared/utils.js';
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
  }

  return {
    renderSprintStats,
  };
})();
publishGiftModule('sprint', giftSprint);
