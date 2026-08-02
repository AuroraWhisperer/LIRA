// 编写人：Aurora
// 礼物管理模块 - 统一入口和导出
'use strict';

(function () {
  // 等待所有子模块加载完成
  function ensureModulesLoaded() {
    const gifts = window.AdminApp.gifts;
    return gifts.notification && gifts.detection && gifts.sprint && gifts.recent && gifts.blindbox && gifts.history;
  }

  /**
   * 主渲染函数 - 渲染礼物面板
   * @param {Object} gifts - 礼物数据
   * @param {Object} sprint - 冲刺数据
   * @param {Object} live - 直播连接状态
   * @param {Object} diagnostics - 诊断数据
   * @param {Object} settings - 设置
   */
  function renderGiftPanel(gifts, sprint, live, diagnostics, settings = {}) {
    if (!ensureModulesLoaded()) {
      console.error('礼物子模块未完全加载');
      return;
    }

    const { notification, detection, sprint: sprintModule, recent, blindbox } = window.AdminApp.gifts;

    // 礼物检测状态
    detection.renderDetectionStatus(sprint, live);

    // 礼物提示 toggle
    const notificationToggle = document.getElementById('enableGiftNotification');
    if (notificationToggle) {
      notificationToggle.checked = settings.enableGiftNotification !== 'false';
    }

    // 诊断统计
    detection.renderGiftStatusLine(diagnostics);

    // 月底冲刺统计
    sprintModule.renderSprintStats(sprint);

    // 最近礼物
    const recentList = Array.isArray(gifts.recent) ? gifts.recent : [];
    notification.notifyNewGift(recentList);
    recent.renderGiftRecentList(recentList);

    // 盲盒映射列表
    blindbox.renderBlindBoxList();
  }

  // 统一导出所有功能
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};

  // 主入口函数和兼容层
  Object.assign(window.AdminApp.gifts, {
    renderGiftPanel,

    // 通知模块兼容接口
    notifyNewGift: function() {
      return window.AdminApp.gifts.notification.notifyNewGift(...arguments);
    },

    // 最近礼物模块兼容接口
    renderGiftRecentList: function() {
      return window.AdminApp.gifts.recent.renderGiftRecentList(...arguments);
    },

    // 盲盒模块兼容接口
    renderBlindBoxList: function() {
      return window.AdminApp.gifts.blindbox.renderBlindBoxList(...arguments);
    },
    loadBlindBoxStats: function() {
      return window.AdminApp.gifts.blindbox.loadBlindBoxStats(...arguments);
    },
    renderBlindBoxStats: function() {
      return window.AdminApp.gifts.blindbox.renderBlindBoxStats(...arguments);
    },
    initBlindBoxStatsToggle: function() {
      return window.AdminApp.gifts.blindbox.initBlindBoxStatsToggle(...arguments);
    },

    // 历史模块兼容接口
    initGiftHistoryDrawer: function() {
      return window.AdminApp.gifts.history.initGiftHistoryDrawer(...arguments);
    },
    openGiftHistoryDrawer: function() {
      return window.AdminApp.gifts.history.openGiftHistoryDrawer(...arguments);
    },
    closeGiftHistoryDrawer: function() {
      return window.AdminApp.gifts.history.closeGiftHistoryDrawer(...arguments);
    },
    loadGiftHistory: function() {
      return window.AdminApp.gifts.history.loadGiftHistory(...arguments);
    },
    initGiftRecentToggle: function() {
      return window.AdminApp.gifts.history.initGiftRecentToggle(...arguments);
    }
  });
})();
