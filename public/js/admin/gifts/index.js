'use strict';

import { giftNotification } from './notification.js';
import { giftDetection } from './detection.js';
import { giftSprint } from './sprint.js';
import { giftRecent } from './recent.js';
import { giftBlindbox } from './blindbox.js';
import {
  initGiftHistoryDrawer,
  openGiftHistoryDrawer,
  closeGiftHistoryDrawer,
  loadGiftHistory,
  initGiftRecentToggle,
} from './history.js';
import { publishGiftPanel } from '../legacy-admin-bridge.js';

export function renderGiftPanel(gifts, sprint, live, diagnostics, settings = {}) {
  // 礼物检测状态
  giftDetection.renderDetectionStatus(sprint, live);

  // 礼物提示 toggle
  const notificationToggle = document.getElementById('enableGiftNotification');
  if (notificationToggle) {
    notificationToggle.checked = settings.enableGiftNotification !== 'false';
  }

  // 诊断统计
  giftDetection.renderGiftStatusLine(diagnostics);

  // 月底冲刺统计
  giftSprint.renderSprintStats(sprint);

  // 最近礼物
  const recentList = Array.isArray(gifts.recent) ? gifts.recent : [];
  giftNotification.notifyNewGift(recentList);
  giftRecent.renderGiftRecentList(recentList);

  // 盲盒映射列表
  giftBlindbox.renderBlindBoxList();
}

publishGiftPanel({
  renderGiftPanel,
  notifyNewGift: giftNotification.notifyNewGift,
  renderGiftRecentList: giftRecent.renderGiftRecentList,
  renderBlindBoxList: giftBlindbox.renderBlindBoxList,
  loadBlindBoxStats: giftBlindbox.loadBlindBoxStats,
  renderBlindBoxStats: giftBlindbox.renderBlindBoxStats,
  initBlindBoxStatsToggle: giftBlindbox.initBlindBoxStatsToggle,
  initGiftHistoryDrawer,
  openGiftHistoryDrawer,
  closeGiftHistoryDrawer,
  loadGiftHistory,
  initGiftRecentToggle,
});
