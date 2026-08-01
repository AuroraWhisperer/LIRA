// 编写人：Aurora
// 礼物和冲刺管理
'use strict';

(function () {
  const {
    escapeHtml,
    escapeAttr,
    formatTime,
    formatDateTime,
    formatMoney,
    toast,
    showStackedToast,
    readJsonResponse,
    dangerConfirm
  } = window.AdminApp.utils;

  let latestGiftNoticeKey = null;

  function renderGiftPanel(gifts, sprint, live, diagnostics, settings = {}) {
    // 礼物检测 toggle & 状态
    const toggle = document.getElementById('giftDetectToggle');
    const label = document.getElementById('giftDetectLabel');
    if (toggle && label) {
      toggle.checked = sprint.enabled === true;
      label.textContent = sprint.enabled ? '已开启' : '已关闭';
    }

    // 礼物提示 toggle
    const notificationToggle = document.getElementById('enableGiftNotification');
    if (notificationToggle) {
      notificationToggle.checked = settings.enableGiftNotification !== 'false';
    }

    const status = document.getElementById('giftSprintStatus');
    if (status) {
      if (!sprint.enabled) {
        status.textContent = '未开启';
        status.className = 'pill warn';
      } else if (live.connected && !String(live.message || '').includes('历史消息监听中')) {
        status.textContent = '监听中';
        status.className = 'pill good';
      } else {
        status.textContent = live.message || '未连接';
        status.className = 'pill warn';
      }
    }

    // 诊断统计
    renderGiftStatusLine(diagnostics);

    // 月底冲刺统计
    document.getElementById('giftSprintTarget').textContent = formatMoney(sprint.targetRmb);
    document.getElementById('giftSprintReceived').textContent = formatMoney(sprint.receivedRmb);
    document.getElementById('giftSprintRemaining').textContent = formatMoney(sprint.remainingRmb);
    document.getElementById('giftSprintCrystalBalls').textContent = `${Number(sprint.remainingCrystalBalls || 0)} 个`;

    // 最近礼物
    const recent = Array.isArray(gifts.recent) ? gifts.recent : [];
    notifyNewGift(recent);
    renderGiftRecentList(recent);

    // 盲盒映射列表
    renderBlindBoxList();
  }

  function renderGiftStatusLine(diagnostics) {
    const node = document.getElementById('giftStatusLine');
    if (!node) return;

    const parts = [];

    // 诊断统计
    if (diagnostics) {
      if (diagnostics.lastPacketAt) {
        parts.push(`收包 ${formatTime(diagnostics.lastPacketAt)}`);
      }
      const count = Number(diagnostics.parsedGiftCount || 0);
      parts.push(`已解析 ${count} 条`);
      const recentGiftLike = Array.isArray(diagnostics.recentGiftLikeCommands) ? diagnostics.recentGiftLikeCommands : [];
      const lastGiftLike = recentGiftLike[0];
      if (lastGiftLike) {
        parts.push(`未识别 ${lastGiftLike.cmd}`);
      }
    }

    node.textContent = parts.join(' · ') || '等待直播消息…';
  }

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

    showStackedToast({
      key: `gift:${newestId}:${num}:${sprintPrice}`,
      className: `gift-notify-toast${variantClass}`,
      html: `<strong>${titleHtml}</strong><span>${subtitle}</span>`,
      duration: 3200
    });
  }

  function renderGiftRecentList(items) {
    const list = document.getElementById('giftRecentList');
    if (!list) return;
    if (items.length === 0) {
      list.innerHTML = '<div class="empty">暂无礼物记录</div>';
      return;
    }

    list.innerHTML = items.map((item) => {
      const sprintPrice = item.sprint_count_price ?? item.total_price;
      const blindProfit = item.blind_profit;
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
        blindLine = `<span>盈亏 <span class="${profitClass}">${profitSign}${formatMoney(Math.abs(Number(blindProfit) || 0))}</span></span>`;
      } else if (item.is_blind_box && item.blind_box_price !== null && item.blind_box_price !== undefined) {
        blindLine = `<span>开出 ${formatMoney(item.total_price)}</span>`;
      }

      return `
        <div class="${cardClass}">
          <div class="gift-name">${escapeHtml(item.gift_name || '未知礼物')} x${Number(item.num || 1)}</div>
          <div class="gift-meta">
            <span>${escapeHtml(item.user_name || '观众')}</span>
            <span>计入 ${formatMoney(sprintPrice)}</span>
            ${blindLine}
            ${item.is_blind_box ? '' : `<span>${formatTime(item.created_at)}</span>`}
          </div>
          ${typeIcon}
        </div>
      `;
    }).join('');
  }

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

  function getBlindBoxIcon(item) {
    const blindBoxName = String(item && (item.blind_box_name || item.name) || '').trim();
    if (blindBoxName.includes('心动盲盒')) {
      return { name: '心动盲盒', src: '/img/bilibili-blindbox-heart.png' };
    }
    if (blindBoxName.includes('幸运盲盒')) {
      return { name: '幸运盲盒', src: '/img/bilibili-blindbox-lucky.png' };
    }
    if (blindBoxName.includes('小熊虫盲盒')) {
      return { name: '小熊虫盲盒', src: '/img/bilibili-blindbox-tardigrade.png' };
    }
    return null;
  }

  function renderBlindBoxList() {
    const container = document.getElementById('blindBoxList');
    if (!container) return;
    const textarea = document.getElementById('giftBlindBoxConfig');
    if (!textarea) return;

    const raw = (textarea.value || '').trim();
    if (!raw) {
      container.innerHTML = '<span class="hint">暂无盲盒配置</span>';
      return;
    }

    let config;
    try {
      config = JSON.parse(raw);
      if (!Array.isArray(config)) throw new Error('不是数组');
    } catch (e) {
      container.innerHTML = '<span class="hint">配置格式错误</span>';
      return;
    }

    if (config.length === 0) {
      container.innerHTML = '<span class="hint">暂无盲盒配置</span>';
      return;
    }

    container.innerHTML = config.map((item, index) => {
      const name = escapeHtml(item.name || '未命名');
      const price = formatMoney(item.price);
      const outputs = Array.isArray(item.outputs) ? item.outputs.map(o => {
        if (typeof o === 'object' && o !== null) {
          return `<span class="bb-output">${escapeHtml(o.name)}<small>${formatMoney(o.price)}</small></span>`;
        }
        return escapeHtml(String(o));
      }).join('') : '—';

      const icon = getBlindBoxIcon(item);
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
          <button class="chip-delete" data-blind-index="${index}" title="删除">✕</button>
        </div>
      `;
    }).join('');
  }

  let blindBoxStatsLoading = false;
  let blindBoxStatsPending = false;

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
        throw new Error(payload.error || `盲盒统计加载失败（HTTP ${response.status}）`);
      }
      renderBlindBoxStats(payload.data);
    } catch (error) {
      const summary = document.getElementById('blindBoxStatsSummary');
      const section = summary && summary.closest('.gift-blindbox-stats-section');
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
      if (body) body.innerHTML = '<tr><td colspan="6" class="empty">加载失败</td></tr>';
    } finally {
      blindBoxStatsLoading = false;
      if (blindBoxStatsPending) {
        blindBoxStatsPending = false;
        loadBlindBoxStats();
      }
    }
  }

  function renderBlindBoxStats(stats) {
    if (!stats) return;

    const { summary, perUser } = stats;

    // 汇总行
    const summaryEl = document.getElementById('blindBoxStatsSummary');
    const section = summaryEl && summaryEl.closest('.gift-blindbox-stats-section');
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
        const profitSign = summary.totalProfit > 0 ? '+' : summary.totalProfit < 0 ? '-' : '';
        const profitClass = summary.totalProfit > 0 ? 'profit-up' : summary.totalProfit < 0 ? 'profit-down' : '';
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
              <span class="stat-chip-copy"><small>今日盈亏</small><strong>${profitSign}${formatMoney(Math.abs(summary.totalProfit))}</strong></span>
            </div>
          </div>
        `;
      }
    }

    // 每条盲盒开盒记录明细（最多 500 条）
    const body = document.getElementById('blindBoxStatsBody');
    if (!body) return;

    const records = stats.records;
    if (!records || records.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
      return;
    }

    body.innerHTML = records.map((rec) => {
      const profitSign = rec.profit > 0 ? '+' : rec.profit < 0 ? '-' : '';
      const profitClass = rec.profit > 0 ? 'profit-up' : rec.profit < 0 ? 'profit-down' : '';
      return `
        <tr>
          <td class="user-cell">${escapeHtml(rec.user_name)}</td>
          <td>${escapeHtml(rec.blind_box_name)}</td>
          <td>${formatMoney(rec.cost)}</td>
          <td>${formatMoney(rec.value)}</td>
          <td class="${profitClass}">${profitSign}${formatMoney(Math.abs(rec.profit))}</td>
          <td class="time-cell">${formatTime(rec.created_at)}</td>
        </tr>
      `;
    }).join('');
  }

  // ── 全部礼物流水抽屉 ──

  const GIFT_HISTORY_LIMIT = 50;
  let giftHistory = { page: 1, limit: GIFT_HISTORY_LIMIT, total: 0, totalPages: 1, items: [] };
  let giftHistorySeq = 0;
  let giftHistorySort = { field: 'created_at', direction: 'desc' };

  function initGiftHistoryDrawer() {
    const openBtn = document.getElementById('giftHistoryOpenBtn');
    const closeBtn = document.getElementById('giftHistoryClose');
    const backdrop = document.getElementById('giftHistoryBackdrop');

    openBtn && openBtn.addEventListener('click', () => {
      giftHistory.page = 1;
      openGiftHistoryDrawer();
      loadGiftHistory(1);
    });
    closeBtn && closeBtn.addEventListener('click', closeGiftHistoryDrawer);
    backdrop && backdrop.addEventListener('click', closeGiftHistoryDrawer);

    const clearDisplayBtn = document.getElementById('giftHistoryClearDisplayBtn');
    const clearDatabaseBtn = document.getElementById('giftHistoryClearDatabaseBtn');

    clearDisplayBtn && clearDisplayBtn.addEventListener('click', async () => {
      const confirmed = await dangerConfirm({
        title: '清理显示',
        message: '将清理抽屉中显示的最近3000条礼物记录。更早的记录仍保留在数据库中。此操作无法恢复。',
        confirmLabel: '确认清理'
      });
      if (!confirmed) return;
      try {
        const response = await fetch('/api/gifts/clear-recent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true })
        });
        const payload = await readJsonResponse(response, '清理显示失败');
        if (!payload.ok) throw new Error(payload.error || '清理失败');
        toast(`已清理 ${payload.data.deletedCount} 条显示记录`);
        giftHistory = { page: 1, limit: GIFT_HISTORY_LIMIT, total: 0, totalPages: 1, items: [] };
        renderGiftHistory();
        if (window.AdminApp.state && window.AdminApp.state.reloadState) {
          window.AdminApp.state.reloadState();
        }
      } catch (error) {
        toast(error.message || '清理显示失败');
      }
    });

    clearDatabaseBtn && clearDatabaseBtn.addEventListener('click', async () => {
      const confirmed = await dangerConfirm({
        title: '清空数据库礼物记录',
        message: '此操作将永久删除数据库中的所有礼物流水（包括显示的和不显示的），无法恢复。',
        confirmLabel: '确认清空'
      });
      if (!confirmed) return;
      try {
        const response = await fetch('/api/database/clear-gifts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true })
        });
        const payload = await readJsonResponse(response, '清空礼物失败');
        if (!payload.ok) throw new Error(payload.error || '清空失败');
        toast('已清空全部礼物记录');
        giftHistory = { page: 1, limit: GIFT_HISTORY_LIMIT, total: 0, totalPages: 1, items: [] };
        renderGiftHistory();
        if (window.AdminApp.state && window.AdminApp.state.reloadState) {
          window.AdminApp.state.reloadState();
        }
      } catch (error) {
        toast(error.message || '清空礼物失败');
      }
    });

    const prevBtn = document.getElementById('giftHistoryPrev');
    const nextBtn = document.getElementById('giftHistoryNext');
    prevBtn && prevBtn.addEventListener('click', () => {
      if (giftHistory.page > 1) loadGiftHistory(giftHistory.page - 1);
    });
    nextBtn && nextBtn.addEventListener('click', () => {
      if (giftHistory.page < giftHistory.totalPages) loadGiftHistory(giftHistory.page + 1);
    });

    // 可排序列点击
    document.querySelectorAll('#giftHistoryDrawer th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (!field) return;
        if (giftHistorySort.field === field) {
          giftHistorySort.direction = giftHistorySort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          giftHistorySort.field = field;
          giftHistorySort.direction = 'asc';
        }
        // 重新从第一页加载（后端排序）
        giftHistory.page = 1;
        loadGiftHistory(1);
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeGiftHistoryDrawer();
    });
  }

  function openGiftHistoryDrawer() {
    const drawer = document.getElementById('giftHistoryDrawer');
    const backdrop = document.getElementById('giftHistoryBackdrop');
    drawer && drawer.classList.add('open');
    backdrop && backdrop.classList.add('open');
  }

  function closeGiftHistoryDrawer() {
    const drawer = document.getElementById('giftHistoryDrawer');
    const backdrop = document.getElementById('giftHistoryBackdrop');
    drawer && drawer.classList.remove('open');
    backdrop && backdrop.classList.remove('open');
  }

  async function loadGiftHistory(page) {
    const seq = ++giftHistorySeq;
    const body = document.getElementById('giftHistoryBody');
    if (body) body.innerHTML = '<tr><td colspan="6" class="empty">加载中…</td></tr>';

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(GIFT_HISTORY_LIMIT),
        sortField: giftHistorySort.field,
        sortDirection: giftHistorySort.direction
      });
      const response = await fetch(`/api/gifts/history?${params}`);
      const payload = await readJsonResponse(response, '礼物流水加载失败');
      if (!response.ok || !payload.ok) throw new Error(payload.error || `礼物流水加载失败（HTTP ${response.status}）`);
      if (seq !== giftHistorySeq) return;
      giftHistory = { ...giftHistory, ...payload.data };
      renderGiftHistory();
    } catch (error) {
      if (seq !== giftHistorySeq) return;
      if (body) body.innerHTML = `<tr><td colspan="6" class="empty">加载失败：${escapeHtml(error.message)}</td></tr>`;
    }
  }

  function renderGiftHistory() {
    const totalEl = document.getElementById('giftHistoryTotal');
    const body = document.getElementById('giftHistoryBody');
    if (totalEl) totalEl.textContent = `共 ${giftHistory.total} 条`;

    if (!giftHistory.items || giftHistory.items.length === 0) {
      if (body) body.innerHTML = '<tr><td colspan="6" class="empty">暂无礼物记录</td></tr>';
    } else {
      if (body) body.innerHTML = giftHistory.items.map(renderGiftHistoryRow).join('');
    }

    // 排序箭头
    document.querySelectorAll('#giftHistoryDrawer th[data-sort]').forEach(th => {
      const arrow = th.querySelector('.sort-arrow');
      if (!arrow) return;
      if (th.dataset.sort === giftHistorySort.field) {
        arrow.textContent = giftHistorySort.direction === 'asc' ? ' ▲' : ' ▼';
      } else {
        arrow.textContent = '';
      }
    });

    const prev = document.getElementById('giftHistoryPrev');
    const next = document.getElementById('giftHistoryNext');
    const info = document.getElementById('giftHistoryPageInfo');
    if (prev) prev.disabled = giftHistory.page <= 1;
    if (next) next.disabled = giftHistory.page >= giftHistory.totalPages;
    if (info) info.textContent = `第 ${giftHistory.page}/${giftHistory.totalPages} 页`;
  }

  function renderGiftHistoryRow(item) {
    const price = item.sprint_count_price ?? item.total_price;
    const guardBadge = getGuardBadge(item);
    const blindBoxIcon = getBlindBoxIcon(item);
    const remarks = [];
    if (guardBadge) {
      remarks.push(`<span class="gift-remark-tag guard"><img class="gift-guard-icon" src="${escapeAttr(guardBadge.src)}" alt="${escapeAttr(guardBadge.name)}" style="width:16px;height:16px;vertical-align:middle" loading="lazy"> ${escapeHtml(guardBadge.name)}</span>`);
    }
    if (item.is_blind_box) {
      const blindProfit = item.blind_profit;
      const profitSign = blindProfit > 0 ? '+' : '';
      const profitClass = blindProfit > 0 ? 'profit-up' : blindProfit < 0 ? 'profit-down' : '';
      const iconHtml = blindBoxIcon
        ? `<img class="gift-blind-box-icon" src="${escapeAttr(blindBoxIcon.src)}" alt="${escapeAttr(blindBoxIcon.name)}" style="width:16px;height:16px;vertical-align:middle" loading="lazy">`
        : '🎁';
      remarks.push(`<span class="gift-remark-tag blind">${iconHtml} 盲盒 ${profitSign}${formatMoney(blindProfit || 0)}</span>`);
    }
    return `
      <tr>
        <td>${formatDateTime(item.created_at)}</td>
        <td class="gift-name-cell" title="${escapeAttr(item.gift_name || '')}">${escapeHtml(item.gift_name || '未知礼物')}</td>
        <td>${Number(item.num || 1)}</td>
        <td>${formatMoney(price)}</td>
        <td class="gift-user-cell" title="${escapeAttr(item.user_name || '')}">${escapeHtml(item.user_name || '观众')}</td>
        <td>${remarks.length ? remarks.join(' ') : '<span class="hint">—</span>'}</td>
      </tr>
    `;
  }

  // ── 最近礼物折叠切换 ──
  function initGiftRecentToggle() {
    const toggle = document.getElementById('giftRecentToggle');
    const section = toggle?.closest('.gift-recent-section');
    const heading = document.getElementById('giftRecentHeading');

    heading?.addEventListener('click', (e) => {
      if (e.target.closest('button:not(#giftRecentToggle)')) return;

      const collapsed = section?.classList.toggle('is-collapsed') || false;
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.title = collapsed ? '展开最近礼物' : '折叠最近礼物';
      }
    });
  }

  // ── 盲盒盈亏折叠切换 ──
  function initBlindBoxStatsToggle() {
    const toggle = document.getElementById('blindBoxStatsToggle');
    const section = toggle?.closest('.gift-blindbox-stats-section');
    const heading = document.getElementById('blindBoxStatsHeading');

    heading?.addEventListener('click', (e) => {
      if (e.target.closest('button:not(#blindBoxStatsToggle)')) return;

      const collapsed = section?.classList.toggle('is-collapsed') || false;
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.title = collapsed ? '展开盲盒盈亏' : '折叠盲盒盈亏';
      }
    });
  }

  // 在 DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initGiftRecentToggle();
      initBlindBoxStatsToggle();
    });
  } else {
    initGiftRecentToggle();
    initBlindBoxStatsToggle();
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = {
    renderGiftPanel,
    notifyNewGift,
    renderGiftRecentList,
    renderBlindBoxList,
    loadBlindBoxStats,
    renderBlindBoxStats,
    initGiftHistoryDrawer,
    openGiftHistoryDrawer,
    closeGiftHistoryDrawer,
    loadGiftHistory,
    initGiftRecentToggle,
    initBlindBoxStatsToggle
  };
})();
