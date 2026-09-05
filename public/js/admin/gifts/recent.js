// 编写人：Aurora
// 最近礼物模块 - 负责最近礼物列表渲染和图标工具函数
import { eventBus, Events } from '../../shared/event-bus.js';
import { getLegacyAdminModules } from '../legacy-admin-bridge.js';

'use strict';

(function () {
  const MAX_RECENT_GIFT_ROWS = 6;
  const HIGH_VALUE_GIFT_MIN_RMB = 1000;
  const GIFT_PLACEHOLDER = '/img/overtime-machine/gift-placeholder.svg';
  const SPECIAL_BLIND_BOX_TYPES = [
    { name: '心动盲盒', id: '32251', className: 'blind-box-heart' },
    { name: '幸运盲盒', id: '35206', className: 'blind-box-lucky' },
  ];
  let recentGiftResizeObserver = null;
  let giftArtworkById = null;
  let giftArtworkLoadPromise = null;
  let giftArtworkRevision = 0;
  let giftArtworkEventsUnsubscribe = null;
  let latestRecentGiftItems = [];

  const { escapeHtml, formatTime, formatMoney } = window.AdminApp.utils;

  function limitRecentGiftRows(list) {
    const columns =
      window
        .getComputedStyle(list)
        .gridTemplateColumns.split(/\s+/)
        .filter(Boolean).length || 1;
    const visibleCardCount = columns * MAX_RECENT_GIFT_ROWS;

    list.querySelectorAll('.gift-card').forEach((card, index) => {
      card.hidden = index >= visibleCardCount;
    });
  }

  function observeRecentGiftGrid(list) {
    if (recentGiftResizeObserver || !window.ResizeObserver) return;
    recentGiftResizeObserver = new window.ResizeObserver(() =>
      limitRecentGiftRows(list),
    );
    recentGiftResizeObserver.observe(list);
  }

  async function loadGiftArtworkCatalog() {
    if (giftArtworkById) return giftArtworkById;
    if (giftArtworkLoadPromise) return giftArtworkLoadPromise;

    const requestRevision = giftArtworkRevision;
    giftArtworkLoadPromise = (async () => {
      const artworkById = new Map();
      if (typeof window.fetch !== 'function') return artworkById;

      try {
        const response = await window.fetch('/api/overtime/gifts/catalog');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.ok === false)
          throw new Error(payload.error || '礼物目录不可用');
        for (const gift of Array.isArray(payload?.data?.gifts)
          ? payload.data.gifts
          : []) {
          const giftId = String(gift?.id ?? '').trim();
          const imagePath = normalizeGiftArtworkPath(gift?.imagePath);
          if (giftId && imagePath) artworkById.set(giftId, imagePath);
        }
      } catch (error) {
        console.warn('读取礼物图片目录失败：', error);
      }
      return artworkById;
    })();

    const loadedArtwork = await giftArtworkLoadPromise;
    giftArtworkLoadPromise = null;
    if (!giftArtworkById && requestRevision === giftArtworkRevision)
      giftArtworkById = loadedArtwork;
    if (!giftArtworkById) giftArtworkById = new Map();
    if (latestRecentGiftItems.length > 0)
      renderGiftRecentList(latestRecentGiftItems);
    return giftArtworkById;
  }

  function normalizeGiftArtworkPath(value) {
    const imagePath = String(value ?? '').trim();
    if (
      !/^\/overtime-gift-images\/[a-z0-9._-]+\.(?:gif|webp|png|jpe?g)$/i.test(
        imagePath,
      ) ||
      imagePath.includes('..')
    )
      return '';
    return imagePath;
  }

  function applyGiftArtworkSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (!Array.isArray(snapshot.gifts)) return;

    giftArtworkRevision += 1;
    const artworkById = giftArtworkById
      ? new Map(giftArtworkById)
      : new Map();
    for (const gift of snapshot.gifts) {
      const giftId = String(gift?.id ?? '').trim();
      const imagePath = normalizeGiftArtworkPath(gift?.imagePath);
      if (giftId && imagePath) artworkById.set(giftId, imagePath);
    }
    giftArtworkById = artworkById;
    getLegacyAdminModules().gifts?.blindbox?.applyOfficialCatalogSnapshot?.(snapshot);
    if (latestRecentGiftItems.length > 0)
      renderGiftRecentList(latestRecentGiftItems);
  }

  function initGiftArtworkCatalog(eventBusRef, events) {
    giftArtworkEventsUnsubscribe?.();
    giftArtworkEventsUnsubscribe = null;
    if (
      typeof eventBusRef?.on === 'function' &&
      events?.GIFT_CATALOG_UPDATED
    ) {
      giftArtworkEventsUnsubscribe = eventBusRef.on(
        events.GIFT_CATALOG_UPDATED,
        ({ snapshot } = {}) => applyGiftArtworkSnapshot(snapshot),
      );
    }
    return loadGiftArtworkCatalog().catch((error) => {
      console.warn('初始化礼物图片目录失败：', error);
    });
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
        const isHighValueTotal =
          Number(item.total_price) >= HIGH_VALUE_GIFT_MIN_RMB;
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
        if (blindBoxIcon)
          cardClass += ` blind-box-card ${blindBoxIcon.className}`;
        if (isHighValueTotal && !guardBadge && !blindBoxIcon)
          cardClass += ' high-value-gift-card';

        if (item.is_blind_box && item.blind_box_name) {
          const profitSign = blindProfit > 0 ? '+' : blindProfit < 0 ? '-' : '';
          const profitClass =
            blindProfit > 0
              ? 'profit-up'
              : blindProfit < 0
                ? 'profit-down'
                : 'profit-neutral';
          blindLine = `<span class="gift-result">盈亏 <span class="${profitClass}">${profitSign}${formatMoney(Math.abs(Number(blindProfit) || 0))}</span></span>`;
        } else if (
          item.is_blind_box &&
          item.blind_box_price !== null &&
          item.blind_box_price !== undefined
        ) {
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
      })
      .join('');
    limitRecentGiftRows(list);
    observeRecentGiftGrid(list);
  }

  /**
   * 获取大航海徽章信息
   * @param {Object} item - 礼物项
   * @returns {Object|null} 徽章信息 {name, src}
   */
  function getGuardBadge(item) {
    const giftName = String((item && item.gift_name) || '')
      .trim()
      .toLowerCase();
    const giftId = String((item && item.gift_id) || '')
      .trim()
      .toLowerCase();

    if (
      giftName.includes('总督') ||
      giftName.includes('governor') ||
      giftId === 'guard-1'
    ) {
      return {
        name: '总督',
        level: 1,
        src: '/img/admin/gifts/bilibili-guard-governor.webp',
      };
    }
    if (
      giftName.includes('提督') ||
      giftName.includes('prefect') ||
      giftName.includes('admiral') ||
      giftId === 'guard-2'
    ) {
      return {
        name: '提督',
        level: 2,
        src: '/img/admin/gifts/bilibili-guard-prefect.webp',
      };
    }
    if (
      giftName.includes('舰长') ||
      giftName.includes('captain') ||
      giftId === 'guard-3'
    ) {
      return {
        name: '舰长',
        level: 3,
        src: '/img/admin/gifts/bilibili-guard-captain.webp',
      };
    }
    return null;
  }

  /**
   * 获取盲盒图标信息
   * @param {Object} item - 礼物项
   * @returns {Object|null} 图标信息 {name, src}
   */
  function getBlindBoxIcon(item) {
    if (!(item?.is_blind_box === true || item?.is_blind_box === 1)) return null;
    const recordedBoxName = String(item?.blind_box_name || '').trim();
    const blindBoxName = String(
      recordedBoxName || item?.name || item?.gift_name || '',
    ).trim();
    const blindBoxId = String(item?.blind_box_id || '').trim();
    const type = SPECIAL_BLIND_BOX_TYPES.find(
      ({ id, name }) => blindBoxId === id || (!blindBoxId && blindBoxName.includes(name)),
    );
    // Open-result records carry the output ID, while direct box records carry
    // the box ID. Only the latter can be resolved from item.gift_id exactly.
    const artworkId =
      blindBoxId ||
      (recordedBoxName ? type?.id : String(item?.gift_id || '').trim());
    return {
      name: type?.name || blindBoxName || '盲盒',
      className: type?.className || 'blind-box-default',
      src: giftArtworkById?.get(artworkId) || GIFT_PLACEHOLDER,
    };
  }

  function getHighValueGiftArtwork(item) {
    const unitPrice = Number(item?.unit_price);
    const giftId = String(item?.gift_id ?? '').trim();
    const artworkPath = giftArtworkById?.get(giftId);
    if (
      !Number.isFinite(unitPrice) ||
      unitPrice < HIGH_VALUE_GIFT_MIN_RMB ||
      !artworkPath
    )
      return null;
    return { src: artworkPath };
  }

  // 导出
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.recent = {
    renderGiftRecentList,
    getGuardBadge,
    getBlindBoxIcon,
    getHighValueGiftArtwork,
    loadGiftArtworkCatalog,
  };

  initGiftArtworkCatalog(eventBus, Events);
})();
