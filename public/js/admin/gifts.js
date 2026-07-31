// 编写人：Aurora
// 礼物和冲刺管理
'use strict';

(function () {
  const {
    escapeHtml,
    formatTime,
    formatMoney,
    toast,
    readJsonResponse
  } = window.AdminApp.utils;

  let latestGiftNoticeKey = null;

  function renderGiftPanel(gifts, sprint, live, compatibility, diagnostics) {
    // 礼物检测 toggle & 状态
    const toggle = document.getElementById('giftDetectToggle');
    const label = document.getElementById('giftDetectLabel');
    if (toggle && label) {
      toggle.checked = sprint.enabled === true;
      label.textContent = sprint.enabled ? '已开启' : '已关闭';
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

    // 诊断合并为一行
    renderGiftStatusLine(compatibility, diagnostics);

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

  function renderGiftStatusLine(compatibility, diagnostics) {
    const node = document.getElementById('giftStatusLine');
    if (!node) return;

    const parts = [];
    const compStatus = (compatibility && compatibility.status) || 'idle';

    // 协议状态
    if (compStatus === 'ok') {
      parts.push('协议正常');
    } else if (compStatus === 'warn') {
      const missing = Array.isArray(compatibility.missingGiftCommands) ? compatibility.missingGiftCommands : [];
      if (missing.length > 0) {
        parts.push(`新CMD未解析：${missing.join('、')}`);
      }
    } else if (compStatus === 'checking') {
      parts.push('检查协议中…');
    } else if (compStatus === 'error') {
      parts.push('协议检查失败');
    }

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

  // 保留旧接口兼容（不再操作独立 DOM）
  function renderGiftCompatibilityStatus(compatibility) {
    // 合并到 giftStatusLine，由 renderGiftPanel 统一刷新
  }

  function renderGiftDiagnosticsStatus(diagnostics) {
    // 合并到 giftStatusLine，由 renderGiftPanel 统一刷新
  }

  function notifyNewGift(items) {
    const newest = items[0];
    const newestId = newest ? Number(newest.id || 0) : 0;
    if (!newestId) return;
    const newestKey = [
      newestId,
      Number(newest.num || 1),
      Number(newest.sprint_count_price ?? newest.total_price ?? 0)
    ].join(':');

    if (latestGiftNoticeKey === null) {
      latestGiftNoticeKey = newestKey;
      return;
    }

    if (newestKey === latestGiftNoticeKey) return;
    latestGiftNoticeKey = newestKey;
    toast(`收到礼物：${newest.gift_name || '未知礼物'} x${Number(newest.num || 1)}，计入 ${formatMoney(newest.sprint_count_price ?? newest.total_price)}`);
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
      let cardClass = 'gift-card';
      let blindLine = '';

      if (item.is_blind_box && item.blind_box_name) {
        const profitSign = blindProfit > 0 ? '+' : '';
        const profitClass = blindProfit > 0 ? 'profit-up' : blindProfit < 0 ? 'profit-down' : '';
        cardClass += blindProfit > 0 ? ' profit' : blindProfit < 0 ? ' loss' : '';
        blindLine = `<span>🎁${escapeHtml(item.blind_box_name)} 成本 ${formatMoney(item.blind_box_price)} <span class="${profitClass}">${profitSign}${formatMoney(blindProfit)}</span></span>`;
      } else if (item.is_blind_box && item.blind_box_price !== null && item.blind_box_price !== undefined) {
        blindLine = `<span>开出 ${formatMoney(item.total_price)}</span>`;
      }

      return `
        <div class="${cardClass}">
          <div class="gift-name">${escapeHtml(item.gift_name || '未知礼物')} x${Number(item.num || 1)}${item.is_blind_box ? ' 🎁' : ''}</div>
          <div class="gift-meta">
            <span>${escapeHtml(item.user_name || '观众')}</span>
            <span>计入 ${formatMoney(sprintPrice)}</span>
            ${blindLine}
            <span>${formatTime(item.created_at)}</span>
          </div>
        </div>
      `;
    }).join('');
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
      const outputs = Array.isArray(item.outputs) ? item.outputs.map(o => escapeHtml(o)).join('、') : '—';
      return `
        <span class="blind-box-chip">
          🎁 ${name} · ¥${price} → ${outputs}
          <button class="chip-delete" data-blind-index="${index}" title="删除">✕</button>
        </span>
      `;
    }).join('');
  }

  async function checkGiftProtocol() {
    const btn = document.getElementById('giftProtocolCheckBtn');
    btn.disabled = true;
    btn.textContent = '检查中...';
    try {
      const response = await fetch('/api/gifts/blivedm/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const payload = await readJsonResponse(response, '协议检查失败');
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `协议检查失败（HTTP ${response.status}）`);
      }
      const appState = window.AdminApp.state.getAppState();
      if (appState) {
        appState.blivedmCompatibility = payload.data || {};
      }
      if (window.AdminApp.queue && window.AdminApp.queue.renderState) {
        const songs = window.AdminApp.state.getSongs();
        window.AdminApp.queue.renderState(appState, songs);
      }
      toast((payload.data && payload.data.message) || '协议检查完成');
    } catch (error) {
      toast(error.message || String(error));
    } finally {
      btn.disabled = false;
      btn.textContent = '检查协议';
    }
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
      if (summary) summary.innerHTML = '<span class="hint">统计加载失败</span>';
      const body = document.getElementById('blindBoxStatsBody');
      if (body) body.innerHTML = '<tr><td colspan="5" class="empty">加载失败</td></tr>';
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
    if (summaryEl) {
      if (!summary || summary.boxCount === 0) {
        summaryEl.innerHTML = '<span class="hint">今天还没有盲盒礼物</span>';
      } else {
        const profitSign = summary.totalProfit > 0 ? '+' : '';
        const profitClass = summary.totalProfit > 0 ? 'profit-up' : summary.totalProfit < 0 ? 'profit-down' : '';
        summaryEl.innerHTML = `
          <div class="stats-summary-row">
            <span class="stat-chip">📦 ${summary.boxCount} 个盒子</span>
            <span class="stat-chip">💰 成本 ¥${formatMoney(summary.totalCost)}</span>
            <span class="stat-chip">🎁 开出 ¥${formatMoney(summary.totalValue)}</span>
            <span class="stat-chip ${profitClass}">${summary.totalProfit >= 0 ? '📈' : '📉'} 盈亏 <strong>${profitSign}¥${formatMoney(Math.abs(summary.totalProfit))}</strong></span>
          </div>
        `;
      }
    }

    // 用户明细表
    const body = document.getElementById('blindBoxStatsBody');
    if (!body) return;

    if (!perUser || perUser.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="empty">暂无数据</td></tr>';
      return;
    }

    body.innerHTML = perUser.map((user) => {
      const profitSign = user.totalProfit > 0 ? '+' : '';
      const profitClass = user.totalProfit > 0 ? 'profit-up' : user.totalProfit < 0 ? 'profit-down' : '';
      return `
        <tr>
          <td class="user-cell">${escapeHtml(user.userName)}</td>
          <td>${user.boxCount}</td>
          <td>¥${formatMoney(user.totalCost)}</td>
          <td>¥${formatMoney(user.totalValue)}</td>
          <td class="${profitClass}">${profitSign}¥${formatMoney(Math.abs(user.totalProfit))}</td>
        </tr>
      `;
    }).join('');
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = {
    renderGiftPanel,
    renderGiftCompatibilityStatus,
    renderGiftDiagnosticsStatus,
    notifyNewGift,
    renderGiftRecentList,
    renderBlindBoxList,
    checkGiftProtocol,
    loadBlindBoxStats,
    renderBlindBoxStats
  };
})();
