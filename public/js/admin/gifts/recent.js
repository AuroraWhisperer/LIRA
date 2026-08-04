// 编写人：Aurora
// 最近礼物模块 - 负责最近礼物列表渲染和图标工具函数
'use strict';

(function () {
  const MAX_RECENT_GIFT_ROWS = 6;
  const HIGH_VALUE_GIFT_MIN_RMB = 1000;
  const HIGH_VALUE_GIFT_ARTWORK = Object.freeze({
    '35541': '1000-1100/35541.webp',
    '31115': '1000-1100/31115.webp',
    '31087': '1200-1300/31087.webp',
    '30847': '1200-1300/30847.webp',
    '35724': '1300-1400/35724.webp',
    '34638': '1900-2000/34638.webp',
    '31028': '2000-above/31028.webp',
    '32313': '2000-above/32313.webp',
    '34383': '2000-above/34383.webp',
    '34639': '2000-above/34639.webp',
    '34998': '2000-above/34998.webp',
    '35502': '2000-above/35502.webp'
  });
  let recentGiftResizeObserver = null;

  const {
    escapeHtml,
    formatTime,
    formatMoney
  } = window.AdminApp.utils;

  function limitRecentGiftRows(list) {
    const columns = window.getComputedStyle(list).gridTemplateColumns
      .split(/\s+/)
      .filter(Boolean).length || 1;
    const visibleCardCount = columns * MAX_RECENT_GIFT_ROWS;

    list.querySelectorAll('.gift-card').forEach((card, index) => {
      card.hidden = index >= visibleCardCount;
    });
  }

  function observeRecentGiftGrid(list) {
    if (recentGiftResizeObserver || !window.ResizeObserver) return;
    recentGiftResizeObserver = new window.ResizeObserver(() => limitRecentGiftRows(list));
    recentGiftResizeObserver.observe(list);
  }

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
      const isHighValueTotal = Number(item.total_price) >= HIGH_VALUE_GIFT_MIN_RMB;
      const highValueGiftArtwork = getHighValueGiftArtwork(item);
      const typeIcon = guardBadge
        ? `<img class="gift-type-icon gift-guard-icon" src="${guardBadge.src}" alt="${guardBadge.name}图标" title="${guardBadge.name}">`
        : blindBoxIcon
          ? `<img class="gift-type-icon gift-blind-box-icon" src="${blindBoxIcon.src}" alt="${blindBoxIcon.name}图标" title="${blindBoxIcon.name}">`
          : highValueGiftArtwork
            ? `<img class="gift-type-icon gift-high-value-icon" src="${highValueGiftArtwork.src}" alt="${giftName}照片" title="${giftName}">`
          : '';
      let cardClass = 'gift-card';
      let blindLine = '';

      if (typeIcon) cardClass += ' has-type-icon';
      if (guardBadge) cardClass += ` guard-card guard-${guardBadge.level}`;
      if (isHighValueTotal && !guardBadge && !blindBoxIcon) cardClass += ' high-value-gift-card';

      if (item.is_blind_box && item.blind_box_name) {
        const profitSign = blindProfit > 0 ? '+' : blindProfit < 0 ? '-' : '';
        const profitClass = blindProfit > 0 ? 'profit-up' : blindProfit < 0 ? 'profit-down' : 'profit-neutral';
        const blindBoxClass = blindBoxIcon && blindBoxIcon.className ? ` ${blindBoxIcon.className}` : '';
        cardClass += ' blind-box-card';
        cardClass += blindBoxClass;
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
    limitRecentGiftRows(list);
    observeRecentGiftGrid(list);
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
      return { name: '总督', level: 1, src: '/img/bilibili-guard-governor.png' };
    }
    if (giftName.includes('提督') || giftName.includes('prefect') || giftName.includes('admiral') || giftId === 'guard-2') {
      return { name: '提督', level: 2, src: '/img/bilibili-guard-prefect.png' };
    }
    if (giftName.includes('舰长') || giftName.includes('captain') || giftId === 'guard-3') {
      return { name: '舰长', level: 3, src: '/img/bilibili-guard-captain.png' };
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
      return { name: '心动盲盒', className: 'blind-box-heart', src: '/img/bilibili-gifts/blind-box/32251.webp' };
    }
    if (blindBoxName.includes('幸运盲盒')) {
      return { name: '幸运盲盒', className: 'blind-box-lucky', src: '/img/bilibili-gifts/blind-box/35206.webp' };
    }
    if (blindBoxName.includes('小熊虫盲盒')) {
      return { name: '小熊虫盲盒', className: 'blind-box-bear', src: '/img/bilibili-gifts/blind-box/35800.webp' };
    }
    return null;
  }

  function getHighValueGiftArtwork(item) {
    const unitPrice = Number(item && item.unit_price);
    const giftId = String(item && item.gift_id || '').trim();
    const artworkPath = HIGH_VALUE_GIFT_ARTWORK[giftId];
    if (!Number.isFinite(unitPrice) || unitPrice < HIGH_VALUE_GIFT_MIN_RMB || !artworkPath) return null;
    return { src: `/img/bilibili-gifts/${artworkPath}` };
  }

  // 导出
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.recent = {
    renderGiftRecentList,
    getGuardBadge,
    getBlindBoxIcon,
    getHighValueGiftArtwork
  };
})();
