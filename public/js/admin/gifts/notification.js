// 编写人：Aurora
// 礼物通知模块 - 负责礼物到账的 toast 通知显示
'use strict';

(function () {
  const {
    escapeHtml,
    formatMoney,
    showStackedToast
  } = window.AdminApp.utils;

  let latestGiftNoticeKey = null;

  /**
   * 检测并显示新礼物通知
   * @param {Array} items - 礼物列表（最新的在前）
   */
  function notifyNewGift(items) {
    const newest = items[0];
    const newestId = newest ? Number(newest.id || 0) : 0;
    if (!newestId) return;
    const sprintPrice = Number(newest.sprint_count_price ?? newest.total_price ?? 0);
    const newestKey = [
      newestId,
      Number(newest.num || 1),
      sprintPrice
    ].join(':');

    if (latestGiftNoticeKey === null) {
      latestGiftNoticeKey = newestKey;
      return;
    }

    if (newestKey === latestGiftNoticeKey) return;
    latestGiftNoticeKey = newestKey;

    // 检查是否启用礼物提示
    const enableGiftNotification = document.getElementById('enableGiftNotification');
    if (enableGiftNotification && !enableGiftNotification.checked) {
      return;
    }

    const giftName = escapeHtml(newest.gift_name || '未知礼物');
    const userName = escapeHtml(newest.user_name || '观众');
    const num = Number(newest.num || 1);
    const coinType = String(newest.coin_type || '').toLowerCase();
    const giftId = String(newest.gift_id || '').toLowerCase();
    const isBlindBox = !!(newest.is_blind_box);
    const blindBoxName = newest.blind_box_name ? escapeHtml(newest.blind_box_name) : '';

    // 判断礼物类型变体
    let variantClass = '';
    if (coinType === 'guard' || giftId.startsWith('guard-')) {
      variantClass = ' gift-guard';
    } else if (isBlindBox) {
      variantClass = ' gift-blind-box';
    } else if (sprintPrice >= 100) {
      variantClass = ' gift-premium';
    } else if (sprintPrice <= 0 || coinType === 'free' || coinType === 'silver') {
      variantClass = ' gift-free';
    }

    // 价格徽章
    let priceBadge = '';
    if (sprintPrice > 0) {
      priceBadge = `<span class="gift-price-badge">¥${formatMoney(sprintPrice)}</span>`;
    }

    // 构建内容
    let displayName = giftName;
    let subtitle;

    if (coinType === 'guard' || giftId.startsWith('guard-')) {
      // 大航海：突出显示
      subtitle = `${userName} 开通${giftName}`;
    } else if (isBlindBox) {
      displayName = blindBoxName || giftName;
      subtitle = `${userName} 送出盲盒`;
      if (blindBoxName) {
        subtitle += ` · 开出 ${blindBoxName}`;
      }
    } else {
      subtitle = `${userName} 送出`;
    }

    const titleHtml = `${displayName} x${num}${priceBadge}`;

    const toastKey = `gift:${newestId}:${num}:${sprintPrice}`;
    showStackedToast({
      key: toastKey,
      className: `gift-notify-toast${variantClass}`,
      html: `<strong>${titleHtml}</strong><span>${subtitle}</span>`,
      duration: 3200
    });
    const desktop = window.songAssistantDesktop;
    if (desktop && typeof desktop.reportGiftDisplay === 'function') {
      desktop.reportGiftDisplay({
        eventId: newestId,
        giftId: String(newest.gift_id || ''),
        giftName: String(newest.gift_name || ''),
        uid: String(newest.uid || ''),
        userName: String(newest.user_name || ''),
        num,
        totalPrice: sprintPrice,
        toastKey
      }).catch(() => {});
    }
  }

  /**
   * 重置通知状态（用于手动清理后）
   */
  function resetNotificationState() {
    latestGiftNoticeKey = null;
  }

  // 导出
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.notification = {
    notifyNewGift,
    resetNotificationState
  };
})();
