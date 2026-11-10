// 编写人：Aurora
// 最近礼物列表及卡片动画资源。
import { escapeHtml } from '../../shared/html-escape.js';
import { formatTime, formatMoney } from '../../shared/display-format.js';
import { GIFT_PLACEHOLDER, setGiftArtworkFallbacks } from '../../shared/gift-image.js';
import { findGiftArtwork, getGuardBadge, getBlindBoxIcon, loadGiftArtworkCatalog } from './artwork-catalog.js';

('use strict');

export const giftRecent = (() => {
  const MAX_RECENT_GIFT_ROWS = 6;
  const HIGH_VALUE_GIFT_MIN_RMB = 1000;
  let recentGiftResizeObserver = null;
  let giftSheenObserver = null;
  let giftSheenMotionQuery = null;
  let giftSheenTimer = null;
  const visibleSheenCards = new Set();
  let sheenList = null;
  let latestRecentGiftItems = [];

  function limitRecentGiftRows(list) {
    const columns = window.getComputedStyle(list).gridTemplateColumns.split(/\s+/).filter(Boolean).length || 1;
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

  function syncGiftSheenTimer() {
    if (document.hidden || giftSheenMotionQuery.matches || visibleSheenCards.size === 0) {
      window.clearTimeout(giftSheenTimer);
      giftSheenTimer = null;
      visibleSheenCards.forEach((card) => card.classList.remove('is-gold-sheening'));
      return;
    }
    if (giftSheenTimer !== null) return;

    giftSheenTimer = window.setTimeout(() => {
      giftSheenTimer = null;
      visibleSheenCards.forEach((card) => card.classList.add('is-gold-sheening'));
      syncGiftSheenTimer();
    }, 3000 + Math.random() * 2000);
  }

  function observeGiftSheen(list) {
    if (!window.IntersectionObserver || !window.matchMedia) return;
    if (!giftSheenObserver) {
      giftSheenMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      giftSheenObserver = new window.IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target.isConnected && entry.isIntersecting && entry.intersectionRatio >= 0.01) {
              visibleSheenCards.add(entry.target);
            } else {
              visibleSheenCards.delete(entry.target);
              entry.target.classList.remove('is-gold-sheening');
            }
          }
          syncGiftSheenTimer();
        },
        { threshold: 0.01 },
      );
      document.addEventListener('visibilitychange', syncGiftSheenTimer);
      giftSheenMotionQuery.addEventListener('change', syncGiftSheenTimer);
      sheenList = list;
      list.addEventListener('animationend', onSheenAnimationEnd);
    }

    giftSheenObserver.disconnect();
    visibleSheenCards.clear();
    const cards = list.querySelectorAll('.high-value-gift-card');
    cards.forEach((card) => giftSheenObserver.observe(card));
    if (cards.length === 0) syncGiftSheenTimer();
  }

  // ── 最近礼物列表 ──

  /**
   * 渲染最近礼物列表
   * @param {Array} items - 礼物列表
   */
  function renderGiftRecentList(items) {
    const list = document.getElementById('giftRecentList');
    if (!list) return;
    latestRecentGiftItems = items;
    if (items.length > 0) void loadGiftArtworkCatalog();
    const isEmpty = items.length === 0;
    list.classList.toggle('is-empty', isEmpty);
    if (isEmpty) {
      list.innerHTML = `
        <div class="empty gift-recent-empty">
          <span class="gift-recent-empty-icon" aria-hidden="true">
            <img src="/img/admin/gifts/gift-section-icon.webp?v=20260801-01" alt="">
          </span>
          <strong>暂无礼物记录</strong>
          <span>收到的礼物会显示在这里</span>
        </div>
      `;
      setGiftArtworkFallbacks(list);
      observeGiftSheen(list);
      return;
    }

    list.innerHTML = items
      .map((item) => {
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
            ? `<img class="gift-type-icon gift-blind-box-icon" src="${blindBoxIcon.src}" alt="${escapeHtml(blindBoxIcon.name)}图标" title="${escapeHtml(blindBoxIcon.name)}">`
            : highValueGiftArtwork
              ? `<img class="gift-type-icon gift-high-value-icon" src="${highValueGiftArtwork.src}" alt="${giftName}照片" title="${giftName}">`
              : '';
        let cardClass = 'gift-card';
        let blindLine = '';

        if (typeIcon) cardClass += ' has-type-icon';
        if (guardBadge) cardClass += ` guard-card guard-${guardBadge.level}`;
        if (blindBoxIcon) cardClass += ` blind-box-card ${blindBoxIcon.className}`;
        if (isHighValueTotal && !guardBadge && !blindBoxIcon) cardClass += ' high-value-gift-card';

        if (item.is_blind_box && Number.isFinite(blindProfit)) {
          const profitSign = blindProfit > 0 ? '+' : blindProfit < 0 ? '-' : '';
          const profitClass = blindProfit > 0 ? 'profit-up' : blindProfit < 0 ? 'profit-down' : 'profit-neutral';
          blindLine = `<span class="gift-result">盈亏 <span class="${profitClass}">${profitSign}${formatMoney(Math.abs(Number(blindProfit) || 0))}</span></span>`;
        } else if (item.is_blind_box) {
          blindLine = '<span class="gift-result">盈亏待确认</span>';
        }

        return `
        <div class="${cardClass}"${blindBoxIcon ? ` data-blind-box-theme="${blindBoxIcon.theme}"` : ''}>
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
      })
      .join('');
    setGiftArtworkFallbacks(list);
    limitRecentGiftRows(list);
    observeRecentGiftGrid(list);
    observeGiftSheen(list);
  }

  function getHighValueGiftArtwork(item) {
    const unitPrice = Number(item?.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < HIGH_VALUE_GIFT_MIN_RMB) return null;
    const giftId = String(item?.gift_id ?? '').trim();
    const artworkPath = findGiftArtwork(giftId, item?.gift_name, item?.gift_variant_id);
    return { src: artworkPath || GIFT_PLACEHOLDER };
  }

  function onSheenAnimationEnd(event) {
    if (event.animationName === 'gift-gold-sheen') event.target.classList.remove('is-gold-sheening');
  }

  function refreshArtwork() {
    if (latestRecentGiftItems.length > 0) renderGiftRecentList(latestRecentGiftItems);
  }

  function dispose() {
    recentGiftResizeObserver?.disconnect();
    recentGiftResizeObserver = null;
    giftSheenObserver?.disconnect();
    giftSheenObserver = null;
    if (giftSheenMotionQuery) {
      document.removeEventListener('visibilitychange', syncGiftSheenTimer);
      giftSheenMotionQuery.removeEventListener('change', syncGiftSheenTimer);
      giftSheenMotionQuery = null;
    }
    sheenList?.removeEventListener('animationend', onSheenAnimationEnd);
    sheenList = null;
    window.clearTimeout(giftSheenTimer);
    giftSheenTimer = null;
    visibleSheenCards.clear();
    latestRecentGiftItems = [];
  }

  const module = {
    renderGiftRecentList,
    refreshArtwork,
    dispose,
    getHighValueGiftArtwork,
  };

  return module;
})();
