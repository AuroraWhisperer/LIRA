// 编写人：Aurora
// 礼物通知模块 - 负责礼物到账的 toast 通知显示
import { getGiftToastArtwork } from './recent.js';

'use strict';

(function () {
  const { escapeHtml, formatMoney, showStackedToast } = window.AdminApp.utils;

  let giftNoticeKeys = null;

  /**
   * 检测并显示新礼物通知
   * @param {Array} items - 礼物列表（最新的在前）
   */
  function notifyNewGift(items) {
    const currentKeys = new Map();
    for (const item of items) {
      const id = Number((item && item.id) || 0);
      if (!id) continue;
      currentKeys.set(id, giftNoticeKey(item));
    }

    if (giftNoticeKeys === null) {
      giftNoticeKeys = currentKeys;
      return;
    }

    const changed = items
      .filter((item) => {
        const id = Number((item && item.id) || 0);
        return id && giftNoticeKeys.get(id) !== currentKeys.get(id);
      })
      .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

    for (const [id, key] of currentKeys) giftNoticeKeys.set(id, key);

    for (const item of changed) showGiftNotice(item);
  }

  function giftNoticeKey(item) {
    return [
      Number(item.id || 0),
      Number(item.num || 1),
      Number(item.sprint_count_price ?? item.total_price ?? 0),
    ].join(':');
  }

  function showGiftNotice(newest) {
    const newestId = Number(newest.id || 0);
    const sprintPrice = Number(
      newest.sprint_count_price ?? newest.total_price ?? 0,
    );

    // 检查是否启用礼物提示
    const enableGiftNotification = document.getElementById(
      'enableGiftNotification',
    );
    if (enableGiftNotification && !enableGiftNotification.checked) {
      return;
    }

    const giftName = escapeHtml(newest.gift_name || '未知礼物');
    const userName = escapeHtml(newest.user_name || '观众');
    const num = Number(newest.num || 1);
    const coinType = String(newest.coin_type || '').toLowerCase();
    const giftId = String(newest.gift_id || '').toLowerCase();
    const isBlindBox = !!newest.is_blind_box;
    const blindBoxName = newest.blind_box_name
      ? escapeHtml(newest.blind_box_name)
      : '';

    // 判断礼物类型变体
    let variantClass = '';
    if (coinType === 'guard' || giftId.startsWith('guard-')) {
      variantClass = ' gift-guard';
    } else if (isBlindBox) {
      variantClass = ' gift-blind-box';
    } else if (sprintPrice >= 100) {
      variantClass = ' gift-premium';
    } else if (
      sprintPrice <= 0 ||
      coinType === 'free' ||
      coinType === 'silver'
    ) {
      variantClass = ' gift-free';
    }

    // 价格徽章
    let priceBadge = '';
    if (sprintPrice > 0) {
      priceBadge = `<span class="gift-price-badge">${formatMoney(sprintPrice)}</span>`;
    }

    // 构建内容
    let subtitle;

    if (coinType === 'guard' || giftId.startsWith('guard-')) {
      // 大航海：突出显示
      subtitle = `${userName} 开通${giftName}`;
    } else if (isBlindBox) {
      subtitle = `${userName} · 来自${blindBoxName || '盲盒'}`;
    } else {
      subtitle = `${userName} 送出`;
    }

    const titleHtml = `<span class="gift-notify-name">${giftName} x${num}</span>${priceBadge}`;

    const toastKey = `gift:${newestId}`;
    const handle = showStackedToast({
      key: toastKey,
      update: true,
      className: `gift-notify-toast${variantClass}`,
      html: `<strong>${titleHtml}</strong><span>${subtitle}</span>`,
      duration: 3200,
    });
    if (handle?.node?.isConnected) renderGiftArtwork(handle.node, newest);
  }

  function renderGiftArtwork(node, item) {
    const source = getGiftToastArtwork(item);
    const previous = node.querySelector('.gift-notify-artwork');
    if (previous?.getAttribute('data-source') === source) return;
    previous?.remove();

    const artwork = document.createElement('span');
    artwork.className = 'gift-notify-artwork';
    artwork.setAttribute('aria-hidden', 'true');
    artwork.setAttribute('data-source', source);
    node.append(artwork);
    if (!source) return;

    const image = document.createElement('img');
    image.alt = '';
    image.width = 40;
    image.height = 40;
    image.decoding = 'async';
    image.addEventListener('load', () => artwork.classList.add('is-loaded'), { once: true });
    image.addEventListener('error', () => image.remove(), { once: true });
    artwork.append(image);
    image.src = source;
  }

  /**
   * 重置通知状态（用于手动清理后）
   */
  function resetNotificationState() {
    giftNoticeKeys = null;
  }

  // 导出
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.notification = {
    notifyNewGift,
    resetNotificationState,
  };
})();
