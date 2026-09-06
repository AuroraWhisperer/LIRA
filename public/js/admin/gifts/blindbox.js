// 编写人：Aurora
// 盲盒统计模块 - 负责盲盒映射配置和统计数据显示
'use strict';

import { getLegacyAdminModules } from '../legacy-admin-bridge.js';
import { eventBus, Events } from '../../shared/event-bus.js';

(function () {
  const { escapeHtml, escapeAttr, formatTime, formatMoney, readJsonResponse } =
    window.AdminApp.utils;
  let statsInitialized = false;
  let officialBlindBoxes = [];
  let officialCatalogLoadPromise = null;
  let saleGiftIds = new Set();
  let saleCatalogRevision = 0;
  let saleCatalogLoadPromise = Promise.resolve();
  let saleRoomId = '';
  let bilibiliLoggedIn = false;
  let authRevision = 0;

  /**
   * 渲染盲盒映射配置列表
   */
  function renderBlindBoxList() {
    const container = document.getElementById('blindBoxList');
    if (!container) return;
    const textarea = document.getElementById('giftBlindBoxCustomConfigV2');
    if (!textarea) return;

    const raw = (textarea.value || '').trim();
    let config = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      if (parsed !== null && !Array.isArray(parsed)) throw new Error('不是数组');
      config = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      container.innerHTML = '<span class="hint">配置格式错误</span>';
      return;
    }

    const entries = [
      ...officialBlindBoxes.map((item) => ({ ...item, official: true })),
      ...config.map((item, index) => ({ ...item, index, official: false })),
    ].sort(
      (left, right) =>
        Number(saleGiftIds.has(String(right.giftId))) -
          Number(saleGiftIds.has(String(left.giftId))) ||
        String(left.name || '未命名').localeCompare(
          String(right.name || '未命名'),
          'zh-Hans-CN',
        ),
    );
    renderBlindBoxMappingStatus();
    if (entries.length === 0) {
      container.innerHTML = '<span class="hint">暂无盲盒配置</span>';
      return;
    }

    // 使用 recent 模块的工具函数
    const getBlindBoxIcon = window.AdminApp.gifts.recent.getBlindBoxIcon;

    container.innerHTML = entries
      .map((item) => {
        const name = escapeHtml(item.name || '未命名');
        const price = formatMoney(item.price);
        const outputs = Array.isArray(item.outputs)
          ? item.outputs
              .map((o) => {
                if (typeof o === 'object' && o !== null) {
                  const outputId = escapeHtml(String(o.giftId || ''));
                  const outputPrice = Number(o.price);
                  return `<span class="bb-output">${escapeHtml(o.name)}${outputId ? `<small>#${outputId}</small>` : ''}${Number.isFinite(outputPrice) && outputPrice > 0 ? `<small>${formatMoney(outputPrice)}</small>` : ''}</span>`;
                }
                return escapeHtml(String(o));
              })
              .join('')
          : '—';

        const icon = getBlindBoxIcon({
          is_blind_box: true,
          blind_box_id: item.giftId || null,
          blind_box_name: item.name || '',
        });
        const iconHtml = icon
          ? `<img class="bb-chip-icon" src="${escapeAttr(icon.src)}" alt="${escapeAttr(icon.name)}" onerror="this.style.display='none'">`
          : `<span class="bb-chip-icon-fallback">🎁</span>`;

        return `
        <div class="blind-box-chip">
          ${iconHtml}
          <div class="bb-chip-body">
            <div class="bb-chip-head">
              <span class="bb-chip-name">${name}</span>
              <span class="bb-chip-price">${price}</span>
            </div>
            <div class="bb-chip-outputs">${outputs}</div>
          </div>
          ${item.official
            ? '<span class="bb-chip-source">官方</span>'
            : `<button class="chip-delete" data-blind-index="${item.index}" title="删除">✕</button>`}
        </div>
      `;
      })
      .join('');
  }

  function renderBlindBoxMappingStatus() {
    const status = document.getElementById('blindBoxMappingStatus');
    if (!status) return;
    const mapping = getLegacyAdminModules().state?.getAppState?.()?.blindBoxMapping;
    if (!mapping) {
      status.textContent = '正在读取服务器映射状态';
      return;
    }
    const parts = [];
    if (mapping.mode === 'legacy') {
      parts.push(`旧配置待确认 ${Number(mapping.migrationPendingCount) || 0} 项`);
    } else {
      parts.push(mapping.applied ? '服务器已应用' : '等待服务器应用');
      parts.push(`自定义 ${Number(mapping.customCount) || 0} 项`);
    }
    if (Number(mapping.takenOverCount) > 0) {
      parts.push(`官方已接管 ${Number(mapping.takenOverCount)} 项`);
    }
    status.textContent = parts.join(' · ');
  }

  function applyOfficialCatalogSnapshot(snapshot) {
    // Catalog updates also carry room sale snapshots without official relations.
    if (
      typeof snapshot?.roomId === 'string' &&
      !Array.isArray(snapshot?.blindBoxes)
    ) {
      applySaleCatalogSnapshot(snapshot);
      return;
    }
    const gifts = Array.isArray(snapshot?.gifts) ? snapshot.gifts : [];
    const giftById = new Map(
      gifts.map((gift) => [String(gift?.id || '').trim(), gift]),
    );
    const relationById = new Map(
      (Array.isArray(snapshot?.blindBoxes) ? snapshot.blindBoxes : []).map(
        (relation) => [String(relation?.giftId || '').trim(), relation],
      ),
    );
    officialBlindBoxes = gifts
      .filter((gift) => gift?.isBlindBox === true)
      .map((gift) => {
        const giftId = String(gift.id);
        const relation = relationById.get(giftId);
        return {
          giftId,
          name: gift.name,
          price: gift.rmb,
          outputs: (relation?.outputGiftIds || []).map((outputGiftId) => {
            const output = giftById.get(String(outputGiftId));
            return {
              giftId: String(outputGiftId),
              name: output?.name || `礼物 ${outputGiftId}`,
              price: output?.rmb ?? null,
            };
          }),
        };
      });
    renderBlindBoxList();
  }

  function applySaleCatalogSnapshot(snapshot) {
    if (
      !bilibiliLoggedIn ||
      !saleRoomId ||
      String(snapshot?.roomId || '') !== saleRoomId
    )
      return;
    saleCatalogRevision += 1;
    const gifts = Array.isArray(snapshot?.gifts) ? snapshot.gifts : [];
    saleGiftIds = new Set(gifts.map((gift) => String(gift.id)));
    renderBlindBoxList();
  }

  function loadSaleCatalog() {
    const requestRevision = ++saleCatalogRevision;
    saleGiftIds = new Set();
    renderBlindBoxList();
    // Serialize room changes so the shared refresh cannot reuse our old room's
    // in-flight request. Skip queued contexts that have already been replaced.
    saleCatalogLoadPromise = saleCatalogLoadPromise.then(async () => {
      if (
        requestRevision !== saleCatalogRevision ||
        !bilibiliLoggedIn ||
        !saleRoomId
      )
        return;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch('/api/overtime/gifts/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const payload = await readJsonResponse(response, '在售礼物目录加载失败');
          if (!response.ok || payload?.ok === false) throw new Error(payload.error);
          if (requestRevision !== saleCatalogRevision) return;
          // The overtime picker may already be refreshing a different room.
          if (String(payload?.data?.roomId || '') !== saleRoomId) continue;
          applySaleCatalogSnapshot(payload.data);
          eventBus.emit(Events.GIFT_CATALOG_UPDATED, { snapshot: payload.data });
          return;
        }
      } catch (error) {
        console.warn('[BlindBox] sale catalog load failed:', error.message || error);
      }
    });
    return saleCatalogLoadPromise;
  }

  function updateSaleRoom(settings) {
    const roomId = String(settings?.roomId || '').trim();
    if (roomId === saleRoomId) return;
    saleRoomId = roomId;
    loadSaleCatalog();
  }

  async function refreshBilibiliAuth() {
    const requestRevision = ++authRevision;
    bilibiliLoggedIn = false;
    loadSaleCatalog();
    try {
      const state = await window.bilibiliAuth?.getAuthState?.();
      if (requestRevision !== authRevision) return;
      bilibiliLoggedIn = state?.loggedIn === true;
      if (bilibiliLoggedIn) loadSaleCatalog();
    } catch (error) {
      console.warn('[BlindBox] auth state load failed:', error.message || error);
    }
  }

  function loadOfficialCatalog() {
    if (officialCatalogLoadPromise) return officialCatalogLoadPromise;
    officialCatalogLoadPromise = fetch('/api/overtime/gifts/catalog')
      .then((response) => readJsonResponse(response, '礼物目录加载失败'))
      .then((payload) => {
        if (payload?.ok === false) throw new Error(payload.error);
        applyOfficialCatalogSnapshot(payload?.data);
      })
      .catch((error) => {
        console.warn('[BlindBox] catalog refresh failed:', error.message || error);
      })
      .finally(() => {
        officialCatalogLoadPromise = null;
      });
    return officialCatalogLoadPromise;
  }

  // ── 盲盒统计 ──

  let blindBoxStatsLoading = false;
  let blindBoxStatsPending = false;

  /**
   * 加载盲盒统计数据
   */
  async function loadBlindBoxStats() {
    // 防止并发请求；有待发标记则在当前请求完成后补发一次
    if (blindBoxStatsLoading) {
      blindBoxStatsPending = true;
      return;
    }
    blindBoxStatsLoading = true;
    try {
      const response = await fetch('/api/gifts/blind-box-stats');
      const payload = await readJsonResponse(response, '盲盒统计加载失败');
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error || `盲盒统计加载失败（HTTP ${response.status}）`,
        );
      }
      renderBlindBoxStats(payload.data);
    } catch (error) {
      const summary = document.getElementById('blindBoxStatsSummary');
      const section = summary && summary.closest('.gift-blindbox-panel');
      if (section) section.dataset.state = 'error';
      if (summary) {
        summary.innerHTML = `
          <div class="blind-stats-status is-error" role="status">
            <span class="blind-stats-status-icon" aria-hidden="true">!</span>
            <strong>统计加载失败</strong>
            <span>请稍后重试</span>
          </div>
        `;
      }
      const body = document.getElementById('blindBoxStatsBody');
      if (body)
        body.innerHTML = '<tr><td colspan="6" class="empty">加载失败</td></tr>';
    } finally {
      blindBoxStatsLoading = false;
      if (blindBoxStatsPending) {
        blindBoxStatsPending = false;
        loadBlindBoxStats();
      }
    }
  }

  /**
   * 渲染盲盒统计数据
   * @param {Object} stats - 统计数据
   */
  function renderBlindBoxStats(stats) {
    if (!stats) return;

    const { summary, perUser } = stats;

    // 汇总行
    const summaryEl = document.getElementById('blindBoxStatsSummary');
    const section = summaryEl && summaryEl.closest('.gift-blindbox-panel');
    if (summaryEl) {
      if (!summary || summary.boxCount === 0) {
        if (section) section.dataset.state = 'empty';
        summaryEl.innerHTML = `
          <div class="blind-stats-status" role="status">
            <span class="blind-stats-status-icon" aria-hidden="true">◇</span>
            <strong>今天还没有盲盒礼物</strong>
            <span>收到盲盒后，这里会自动汇总成本、开出价值和盈亏</span>
          </div>
        `;
      } else {
        const profitSign =
          summary.totalProfit > 0 ? '+' : summary.totalProfit < 0 ? '-' : '';
        const profitClass =
          summary.totalProfit > 0
            ? 'profit-up'
            : summary.totalProfit < 0
              ? 'profit-down'
              : '';
        if (section) section.dataset.state = 'ready';
        summaryEl.innerHTML = `
          <div class="stats-summary-row">
            <div class="stat-chip">
              <span class="stat-chip-icon">盒</span>
              <span class="stat-chip-copy"><small>盲盒数量</small><strong>${summary.boxCount}</strong></span>
            </div>
            <div class="stat-chip">
              <span class="stat-chip-icon">¥</span>
              <span class="stat-chip-copy"><small>总成本</small><strong>${formatMoney(summary.totalCost)}</strong></span>
            </div>
            <div class="stat-chip">
              <span class="stat-chip-icon">礼</span>
              <span class="stat-chip-copy"><small>开出价值</small><strong>${formatMoney(summary.totalValue)}</strong></span>
            </div>
            <div class="stat-chip ${profitClass}">
              <span class="stat-chip-icon">${summary.totalProfit >= 0 ? '↗' : '↘'}</span>
              <span class="stat-chip-copy"><small>观众盈亏</small><strong>${profitSign}${formatMoney(Math.abs(summary.totalProfit))}</strong></span>
            </div>
          </div>
        `;
      }
    }

    // 首页只展示按观众汇总；完整记录放在独立分析工作区。
    const body = document.getElementById('blindBoxStatsBody');
    if (!body) return;

    const users = Array.isArray(perUser) ? perUser : [];
    if (users.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
      return;
    }

    body.innerHTML = users
      .slice(0, 10)
      .map((user) => {
        const profitSign =
          user.totalProfit > 0 ? '+' : user.totalProfit < 0 ? '-' : '';
        const profitClass =
          user.totalProfit > 0
            ? 'profit-up'
            : user.totalProfit < 0
              ? 'profit-down'
              : '';
        return `
        <tr class="blind-stats-user-row" tabindex="0" data-viewer="${escapeAttr(user.viewer || '')}" title="查看${escapeAttr(user.userName || '观众')}的开盒记录">
          <td class="user-cell">${escapeHtml(user.userName || '观众')}</td>
          <td>${Number(user.boxCount || 0)}</td>
          <td>${Number(user.boxTypeCount || 0)} 种</td>
          <td>${formatMoney(user.totalCost)}</td>
          <td>${formatMoney(user.totalValue)}</td>
          <td class="${profitClass}">${profitSign}${formatMoney(Math.abs(user.totalProfit))}</td>
        </tr>
      `;
      })
      .join('');
  }

  /**
   * 初始化盲盒盈亏面板折叠功能
   */
  function initBlindBoxStatsToggle() {
    const section = document.querySelector('.gift-blindbox-panel');
    const toggle = document.getElementById('blindBoxStatsToggle');
    const panelHeader = section?.querySelector('.panel-header');

    panelHeader?.addEventListener('click', (e) => {
      if (e.target.closest('#blindBoxAnalysisOpenBtn')) return;
      const collapsed = section?.classList.toggle('is-collapsed') || false;
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.title = collapsed ? '展开盲盒盈亏' : '折叠盲盒盈亏';
      }
    });

    document
      .getElementById('blindBoxAnalysisOpenBtn')
      ?.addEventListener('click', () => {
        window.AdminApp.gifts.analysis?.open({ view: 'users' });
      });

    document
      .getElementById('blindBoxStatsBody')
      ?.addEventListener('click', (event) => {
        const row = event.target.closest('[data-viewer]');
        if (row)
          window.AdminApp.gifts.analysis?.open({
            viewer: row.dataset.viewer,
            view: 'records',
          });
      });

    document
      .getElementById('blindBoxStatsBody')
      ?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const row = event.target.closest('[data-viewer]');
        if (!row) return;
        event.preventDefault();
        window.AdminApp.gifts.analysis?.open({
          viewer: row.dataset.viewer,
          view: 'records',
        });
      });

    if (!statsInitialized) {
      statsInitialized = true;
      eventBus.on(Events.GIFT_RECEIVED, loadBlindBoxStats);
      loadBlindBoxStats();
    }
  }

  // 在 DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBlindBoxStatsToggle);
  } else {
    initBlindBoxStatsToggle();
  }

  // 导出
  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = window.AdminApp.gifts || {};
  window.AdminApp.gifts.blindbox = {
    renderBlindBoxList,
    applyOfficialCatalogSnapshot,
    loadBlindBoxStats,
    renderBlindBoxStats,
    initBlindBoxStatsToggle,
  };
  loadOfficialCatalog();
  window.addEventListener('app:settings-state', (event) =>
    updateSaleRoom(event.detail),
  );
  document.addEventListener('app:bilibili-auth-changed', refreshBilibiliAuth);
  updateSaleRoom(getLegacyAdminModules().state?.getAppState?.()?.settings);
  refreshBilibiliAuth();
})();
