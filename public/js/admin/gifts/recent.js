// 编写人：Aurora
// 最近礼物模块 - 负责最近礼物列表渲染和图标工具函数
'use strict';

(function () {
  const {
    escapeHtml,
    formatTime,
    formatMoney
  } = window.AdminApp.utils;

  // ── 最近礼物列表 ──

  /**
   * 渲染最近礼物列表
   * @param {Array} items - 礼物列表
   */
  function renderGiftRecentList(items) {
    const list = document.getElementById('giftRecentList');
    if (!list) return;
    const isEmpty = items.length === 0;
    list.classList.toggle('is-empty', isEmpty);
    if (isEmpty) {
      list.innerHTML = `
        <div class="empty gift-recent-empty">
          <span class="gift-recent-empty-icon" aria-hidden="true">
            <img src="/img/gift-section-icon.png?v=20260801-01" alt="">
          </span>
          <strong>暂无礼物记录</strong>
          <span>收到的礼物会显示在这里</span>
        </div>
      `;
      return;
    }

    list.innerHTML = items.map((item) => {
      const sprintPrice = item.sprint_count_price ?? item.total_price;
      const blindProfit = item.blind_profit;
      const giftName = escapeHtml(item.gift_name || '未知礼物');
      const userName = escapeHtml(item.user_name || '观众');
      const guardBadge = getGuardBadge(item);
      const blindBoxIcon = getBlindBoxIcon(item);
      const typeIcon = guardBadge
        ? `<img class="gift-type-icon gift-guard-icon" src="${guardBadge.src}" alt="${guardBadge.name}图标" title="${guardBadge.name}">`
        : blindBoxIcon
          ? `<img class="gift-type-icon gift-blind-box-icon" src="${blindBoxIcon.src}" alt="${blindBoxIcon.name}图标" title="${blindBoxIcon.name}">`
          : '';
      let cardClass = 'gift-card';
      let blindLine = '';

      if (typeIcon) cardClass += ' has-type-icon';

      if (item.is_blind_box && item.blind_box_name) {
        const profitSign = blindProfit > 0 ? '+' : blindProfit < 0 ? '-' : '';
        const profitClass = blindProfit > 0 ? 'profit-up' : blindProfit < 0 ? 'profit-down' : '';
        cardClass += ' blind-box-card';
        cardClass += blindProfit > 0 ? ' profit' : blindProfit < 0 ? ' loss' : '';
        blindLine = `<span class="gift-result">盈亏 <span class="${profitClass}">${profitSign}${formatMoney(Math.abs(Number(blindProfit) || 0))}</span></span>`;
      } else if (item.is_blind_box && item.blind_box_price !== null && item.blind_box_price !== undefined) {
        blindLine = `<span class="gift-result">开出 ${formatMoney(item.total_price)}</span>`;
      }

      return `
        <div class="${cardClass}">
          <div class="gift-card-content">
            <div class="gift-name" title="${giftName}">${giftName} x${Number(item.num || 1)}</div>
            <div class="gift-meta">
              <span class="gift-user" title="${userName}">${userName}</span>
              <span class="gift-time">${formatTime(item.created_at)}</span>
              <span class="gift-amount">计入 ${formatMoney(sprintPrice)}</span>
              ${blindLine}
            </div>
          </div>
          ${typeIcon}
        </div>
      `;
    }).join('');
  }

  /**
   * 获取大航海徽章信息
   * @param {Object} item - 礼物项
   * @returns {Object|null} 徽章信息 {name, src}
   */
  function getGuardBadge(item) {
    const giftName = String(item && item.gift_name || '').trim().toLowerCase();
    const giftId = String(item && item.gift_id || '').trim().toLowerCase();

    if (giftName.includes('总督') || giftName.includes('governor') || giftId === 'guard-1') {
      return { name: '总督', src: '/img/bilibili-guard-governor.png' };
    }
    if (giftName.includes('提督') || giftName.includes('prefect') || giftName.includes('admiral') || giftId === 'guard-2') {
      return { name: '提督', src: '/img/bilibili-guard-prefect.png' };
    }
    if (giftName.includes('舰长') || giftName.includes('captain') || giftId === 'guard-3') {
      return { name: '舰长', src: '/img/bilibili-guard-captain.png' };
    }
    return null;
  }

  /**
   * 获取盲盒图标信息
   * @param {Object} item - 礼物项
   * @returns {Object|null} 图标信息 {name, src}
   */
  function getBlindBoxIcon(item) {
    const blindBoxName = String(item && (item.blind_box_name || item.name) || '').trim();
    if (blindBoxName.includes('心动盲盒')) {
      return { name: '心动盲盒', src: '/img/bilibili-gifts/blind-box/32251.webp' };
    }
    if (blindBoxName.includes('幸运盲盒')) {
      return { name: '幸运盲盒', src: '/img/bilibili-gifts/blind-box/35206.webp' };
    }
    if (blindBoxName.includes('小熊虫盲盒')) {
      return { name: '小熊虫盲盒', src: '/img/bilibili-gifts/blind-box/35800.webp' };
    }
    return null;
  }

  // 导出
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.recent = {
    renderGiftRecentList,
    getGuardBadge,
    getBlindBoxIcon
  };
})();
