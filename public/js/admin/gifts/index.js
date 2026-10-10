'use strict';

import { giftNotification } from './notification.js';
import { giftDetection } from './detection.js';
import { giftSprint } from './sprint.js';
import { giftRecent } from './recent.js';
import { giftBlindbox } from './blindbox.js';
// 礼物历史抽屉由 app.js 直接调用，这里保留显式依赖以免组合顺序依赖副作用导入。
import './history.js';

export function renderGiftPanel(gifts, sprint, live, diagnostics, settings = {}, changedKeys = null) {
  const changed = (key) => !changedKeys || changedKeys.includes(key);
  // 礼物检测状态
  if (changed('giftSprint') || changed('liveStatus') || changed('settings')) {
    giftDetection.renderDetectionStatus(sprint, live);
  }

  // 礼物提示 toggle
  const notificationToggle = document.getElementById('enableGiftNotification');
  if (notificationToggle && changed('settings')) {
    notificationToggle.checked = settings.enableGiftNotification !== 'false';
  }

  // 月底冲刺统计
  if (changed('giftSprint')) giftSprint.renderSprintStats(sprint);

  // 最近礼物
  const recentList = Array.isArray(gifts.recent) ? gifts.recent : [];
  giftNotification.notifyNewGift(recentList);
  if (changed('gifts')) giftRecent.renderGiftRecentList(recentList);

  // 盲盒映射列表
  if (changed('settings')) giftBlindbox.renderBlindBoxList();
  else if (changed('blindBoxMapping')) giftBlindbox.renderBlindBoxMappingStatus();
}
