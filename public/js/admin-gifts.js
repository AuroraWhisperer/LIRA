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
    const status = document.getElementById('giftSprintStatus');
    if (!status) return;

    if (!sprint.enabled) {
      status.textContent = '未开启';
      status.className = 'pill warn';
    } else if (live.connected && !String(live.message || '').includes('历史消息监听中')) {
      status.textContent = '礼物监听中';
      status.className = 'pill good';
    } else {
      status.textContent = live.message || '直播监听未连接';
      status.className = 'pill warn';
    }
    document.getElementById('giftSprintTarget').textContent = formatMoney(sprint.targetRmb);
    document.getElementById('giftSprintReceived').textContent = formatMoney(sprint.receivedRmb);
    document.getElementById('giftSprintRemaining').textContent = formatMoney(sprint.remainingRmb);
    document.getElementById('giftSprintCrystalBalls').textContent = `${Number(sprint.remainingCrystalBalls || 0)} 个`;

    const recent = Array.isArray(gifts.recent) ? gifts.recent : [];
    notifyNewGift(recent);
    renderGiftRecentList(recent);
    renderGiftCompatibilityStatus(compatibility);
    renderGiftDiagnosticsStatus(diagnostics);
  }

  function renderGiftCompatibilityStatus(compatibility) {
    const node = document.getElementById('giftCompatibilityStatus');
    if (!node) return;

    const status = compatibility.status || 'idle';
    const missing = Array.isArray(compatibility.missingGiftCommands) ? compatibility.missingGiftCommands : [];
    if (status === 'ok') {
      node.textContent = `blivedm 协议检查正常：${compatibility.checkedAt ? formatTime(compatibility.checkedAt) : '刚刚'} 已覆盖礼物 CMD`;
    } else if (status === 'cached') {
      node.textContent = compatibility.message || 'blivedm 检查超时，已使用上次成功结果';
    } else if (status === 'fallback') {
      node.textContent = compatibility.message || 'blivedm 检查超时，已使用内置协议';
    } else if (status === 'warn' && missing.length > 0) {
      node.textContent = `blivedm 有新礼物 CMD 未解析：${missing.join('、')}；已纳入运行时告警日志`;
    } else if (status === 'checking') {
      node.textContent = '正在检查 blivedm 最新礼物协议...';
    } else if (status === 'error') {
      node.textContent = compatibility.message || 'blivedm 协议检查失败，请检查网络';
    } else {
      node.textContent = compatibility.message || 'blivedm 协议检查等待中';
    }
  }

  function renderGiftDiagnosticsStatus(diagnostics) {
    const node = document.getElementById('giftDiagnosticsStatus');
    if (!node) return;

    const recentCommands = Array.isArray(diagnostics.recentCommands) ? diagnostics.recentCommands : [];
    const recentGiftLike = Array.isArray(diagnostics.recentGiftLikeCommands) ? diagnostics.recentGiftLikeCommands : [];
    const lastCommand = recentCommands[0];
    const lastGiftLike = recentGiftLike[0];
    const parts = [];
    if (diagnostics.lastPacketAt) {
      parts.push(`最近收包 ${formatTime(diagnostics.lastPacketAt)}`);
    }
    if (lastCommand) {
      parts.push(`最近 CMD ${lastCommand.cmd}`);
    }
    parts.push(`已解析礼物 ${Number(diagnostics.parsedGiftCount || 0)} 条`);
    if (lastGiftLike) {
      parts.push(`未解析礼物类 ${lastGiftLike.cmd}（${lastGiftLike.reason || 'unknown'}）`);
    }
    node.textContent = parts.join(' · ') || '等待直播消息诊断';
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
      const giftValueText = item.is_blind_box && item.blind_box_price !== null && item.blind_box_price !== undefined
        ? ` · 开出 ${formatMoney(item.total_price)}`
        : '';
      return `
        <div class="queue-row gift-row">
          <div>
            <div class="song">${escapeHtml(item.gift_name || '未知礼物')} x${Number(item.num || 1)}</div>
            <div class="meta">${escapeHtml(item.user_name || '观众')} · 计入 ${formatMoney(sprintPrice)}${giftValueText} · ${formatTime(item.created_at)}</div>
          </div>
        </div>
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

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.gifts = {
    renderGiftPanel,
    renderGiftCompatibilityStatus,
    renderGiftDiagnosticsStatus,
    notifyNewGift,
    renderGiftRecentList,
    checkGiftProtocol
  };
})();
