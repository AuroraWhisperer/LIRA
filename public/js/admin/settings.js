// 编写人：Aurora
// 基础设置和系统操作
'use strict';

(function () {
  const {
    value,
    toast,
    showStackedToast,
    api,
    readJsonResponse,
    dangerConfirm,
    localOverlayOrigin
  } = window.AdminApp.utils;

  function initBilibiliAuth() {
    const statusEl = document.getElementById('bilibiliAuthStatus');
    const uidEl = document.getElementById('bilibiliAuthUid');
    const loginBtn = document.getElementById('bilibiliLoginBtn');
    const logoutBtn = document.getElementById('bilibiliLogoutBtn');

    // 检查是否在 Electron 桌面环境中
    const isDesktop = !!window.bilibiliAuth;
    if (!isDesktop) {
      statusEl.textContent = 'Web 模式（不可用）';
      statusEl.className = 'pill';
      loginBtn.disabled = true;
      loginBtn.title = 'Bilibili 扫码登录仅在桌面版中可用';
      return;
    }

    async function refreshAuthState() {
      try {
        const state = await window.bilibiliAuth.getAuthState();
        if (state && state.loggedIn) {
          statusEl.textContent = '已登录';
          statusEl.className = 'pill good';
          uidEl.textContent = state.uid ? `UID: ${state.uid}` : '';
          loginBtn.style.display = 'none';
          logoutBtn.style.display = '';
        } else {
          statusEl.textContent = '未登录';
          statusEl.className = 'pill warn';
          uidEl.textContent = '';
          loginBtn.style.display = '';
          logoutBtn.style.display = 'none';
        }
      } catch (err) {
        statusEl.textContent = '状态未知';
        statusEl.className = 'pill';
      }
    }

    loginBtn.addEventListener('click', async () => {
      loginBtn.disabled = true;
      loginBtn.textContent = '⏳ 请在弹出窗口中扫码…';
      try {
        const result = await window.bilibiliAuth.login();
        if (result && result.state) {
          await refreshAuthState();
          // 登录成功后提示重连以使用新 cookie
          toast('Bilibili 登录成功！建议点击"刷新直播"以使用登录态重连。');
        }
      } catch (err) {
        toast('登录失败：' + (err.message || String(err)));
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = '📱 扫码登录 Bilibili';
      }
    });

    logoutBtn.addEventListener('click', async () => {
      const confirmed = await window.AdminApp.utils.logoutConfirm({
        title: '退出登录',
        platform: 'Bilibili',
        message: '退出后弹幕连接将回退到匿名模式。建议点击"刷新直播"重连。',
        icon: '→',
        confirmLabel: '确认退出'
      });
      if (!confirmed) return;

      logoutBtn.disabled = true;
      logoutBtn.textContent = '退出中…';
      try {
        await window.bilibiliAuth.logout();
        await refreshAuthState();
        toast('Bilibili 已退出登录。建议点击"刷新直播"重连。');
      } catch (err) {
        toast('退出失败：' + (err.message || String(err)));
      } finally {
        logoutBtn.disabled = false;
        logoutBtn.textContent = '退出登录';
      }
    });

    // 初始加载状态
    refreshAuthState();
  }

  async function saveSettings(updates) {
    await api('/api/settings', updates);
  }

  function initSettingsForm() {
    document.getElementById('settingsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/settings', collectSettings());
      toast('设置已保存');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    document.getElementById('giftSprintForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/settings', {
        giftSprintTargetRmb: value('giftSprintTargetRmb')
      });
      toast('冲刺目标已保存');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    // 礼物检测 toggle（checkbox 立即生效）
    document.getElementById('giftDetectToggle').addEventListener('change', async (event) => {
      const enabled = event.target.checked ? 'true' : 'false';
      try {
        await api('/api/settings', {
          enableGiftSprint: enabled
        });
        toast(enabled === 'true' ? '礼物检测已开启' : '礼物检测已关闭');
        if (window.AdminApp.state && window.AdminApp.state.reloadState) {
          await window.AdminApp.state.reloadState();
        }
      } catch (error) {
        toast('保存失败：' + (error.message || String(error)));
        const currentSettings = window.AdminApp.state.getAppState();
        if (currentSettings && currentSettings.settings) {
          event.target.checked = currentSettings.settings.enableGiftSprint === 'true';
        }
      }
    });

    // 礼物提示 toggle（checkbox 立即生效）
    document.getElementById('enableGiftNotification').addEventListener('change', async (event) => {
      const enabled = event.target.checked ? 'true' : 'false';
      try {
        await api('/api/settings', {
          enableGiftNotification: enabled
        });
        toast(enabled === 'true' ? '礼物提示已开启' : '礼物提示已关闭');
      } catch (error) {
        toast('保存失败：' + (error.message || String(error)));
        const currentSettings = window.AdminApp.state.getAppState();
        if (currentSettings && currentSettings.settings) {
          event.target.checked = currentSettings.settings.enableGiftNotification === 'true';
        }
      }
    });

    document.getElementById('giftSprintResetBtn').addEventListener('click', async () => {
      if (!confirm('确认重置本轮已收金额？礼物流水会保留。')) return;
      await api('/api/gifts/sprint/reset', {});
      toast('本轮冲刺已重置');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    // 盲盒映射：表单添加
    document.getElementById('blindBoxAddBtn').addEventListener('click', async () => {
      const name = (value('blindBoxName') || '').trim();
      const price = parseFloat(value('blindBoxPrice'));
      const outputsRaw = (value('blindBoxOutputs') || '').trim();

      if (!name) { toast('请输入盲盒名'); return; }
      if (isNaN(price) || price < 0) { toast('请输入有效成本'); return; }
      if (!outputsRaw) { toast('请输入可能开出的礼物'); return; }

      const outputs = outputsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean).map(s => {
        // 支持 "礼物名" 或 "礼物名:价格" 两种格式
        const colonIdx = s.lastIndexOf(':');
        if (colonIdx > 0) {
          const giftName = s.slice(0, colonIdx).trim();
          const giftPrice = parseFloat(s.slice(colonIdx + 1).trim());
          if (giftName && !isNaN(giftPrice) && giftPrice > 0) {
            return { name: giftName, price: giftPrice };
          }
        }
        return s; // 纯名称，无独立价格
      });
      if (outputs.length === 0) { toast('请输入可能开出的礼物'); return; }

      // 读取现有配置
      const textarea = document.getElementById('giftBlindBoxConfig');
      let config = [];
      const raw = (textarea.value || '').trim();
      if (raw) {
        try {
          config = JSON.parse(raw);
          if (!Array.isArray(config)) config = [];
        } catch (e) { config = []; }
      }

      config.push({ name, price, outputs });
      const newRaw = JSON.stringify(config, null, 2);
      textarea.value = newRaw;
      await saveSettings({ giftBlindBoxConfig: newRaw });
      toast(`已添加盲盒「${name}」`);

      // 清空输入
      document.getElementById('blindBoxName').value = '';
      document.getElementById('blindBoxPrice').value = '';
      document.getElementById('blindBoxOutputs').value = '';

      if (window.AdminApp.gifts && window.AdminApp.gifts.renderBlindBoxList) {
        window.AdminApp.gifts.renderBlindBoxList();
      }
    });

    // 盲盒映射：chip 删除（事件委托）
    document.getElementById('blindBoxList').addEventListener('click', async (event) => {
      const btn = event.target.closest('.chip-delete');
      if (!btn) return;
      const index = parseInt(btn.dataset.blindIndex, 10);
      if (isNaN(index)) return;

      const textarea = document.getElementById('giftBlindBoxConfig');
      const raw = (textarea.value || '').trim();
      let config = [];
      try { config = JSON.parse(raw); if (!Array.isArray(config)) config = []; } catch (e) { config = []; }

      if (index < 0 || index >= config.length) return;
      const removed = config[index];
      config.splice(index, 1);
      const newRaw = config.length > 0 ? JSON.stringify(config, null, 2) : '';
      textarea.value = newRaw;
      await saveSettings({ giftBlindBoxConfig: newRaw });
      toast(`已移除盲盒「${removed.name || '未命名'}」`);

      if (window.AdminApp.gifts && window.AdminApp.gifts.renderBlindBoxList) {
        window.AdminApp.gifts.renderBlindBoxList();
      }
    });

    // 盲盒映射：高级编辑 toggle
    document.getElementById('blindBoxAdvancedToggle').addEventListener('click', () => {
      const advanced = document.getElementById('blindBoxAdvanced');
      const btn = document.getElementById('blindBoxAdvancedToggle');
      if (advanced.hidden) {
        advanced.hidden = false;
        btn.textContent = '高级 ▴';
      } else {
        advanced.hidden = true;
        btn.textContent = '高级 ▾';
      }
    });

    // 盲盒映射：JSON 直接保存
    document.getElementById('giftBlindBoxSaveBtn').addEventListener('click', async () => {
      const textarea = document.getElementById('giftBlindBoxConfig');
      let raw = textarea.value.trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) throw new Error('配置必须是 JSON 数组');
          raw = JSON.stringify(parsed); // 规范化
        } catch (e) {
          toast('盲盒配置 JSON 格式错误：' + e.message);
          return;
        }
      }
      await saveSettings({ giftBlindBoxConfig: raw });
      toast('盲盒配置已保存');
      if (window.AdminApp.gifts && window.AdminApp.gifts.renderBlindBoxList) {
        window.AdminApp.gifts.renderBlindBoxList();
      }
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    // 盲盒投屏：所有控件变更时实时更新 URL
    const blindboxControls = [
      'blindboxOverlayTitle', 'blindboxOverlayTop',
      'blindboxWinnersOnly', 'blindboxHeartBoxOnly'
    ];
    for (const id of blindboxControls) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('input', () => updateBlindboxOverlayUrl());
      el.addEventListener('change', () => {
        updateBlindboxOverlayUrl();
        // 标题变更时自动保存
        if (id === 'blindboxOverlayTitle') {
          saveSettings({ blindboxOverlayTitle: el.value.trim() }).catch(() => {});
        }
      });
    }

    // 盲盒投屏：复制链接
    document.getElementById('blindboxCopyUrlBtn').addEventListener('click', async () => {
      const url = buildBlindboxOverlayUrl();
      try {
        await navigator.clipboard.writeText(url);
        toast('投屏地址已复制');
      } catch (e) {
        prompt('复制以下地址：', url);
      }
    });

    // 初始化 URL 显示
    updateBlindboxOverlayUrl();

    document.getElementById('importBtn').addEventListener('click', () => {
      if (window.AdminApp.imports && window.AdminApp.imports.importSongs) {
        window.AdminApp.imports.importSongs();
      }
    });
    document.getElementById('clearDatabaseBtn').addEventListener('click', clearDatabase);
    document.getElementById('clearSuperChatsBtn').addEventListener('click', clearSuperChats);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('shutdownBtn').addEventListener('click', shutdownServer);
    document.getElementById('reconnectBtn').addEventListener('click', reconnectBilibili);

    if (window.songAssistantDesktop) {
      const minBtn = document.getElementById('winMinBtn');
      const maxBtn = document.getElementById('winMaxBtn');
      const closeBtn = document.getElementById('winCloseBtn');
      if (minBtn) minBtn.addEventListener('click', () => window.songAssistantDesktop.minimizeWindow());
      if (maxBtn) maxBtn.addEventListener('click', () => window.songAssistantDesktop.maximizeWindow());
      if (closeBtn) closeBtn.addEventListener('click', () => window.songAssistantDesktop.closeWindow());

      // 监听窗口最大化状态变化，切换图标
      if (maxBtn) {
        window.songAssistantDesktop.onWindowMaximized((isMaximized) => {
          const maximizeIcon = maxBtn.querySelector('.maximize-icon');
          const restoreIcon = maxBtn.querySelector('.restore-icon');
          if (maximizeIcon && restoreIcon) {
            if (isMaximized) {
              maximizeIcon.style.display = 'none';
              restoreIcon.style.display = 'block';
            } else {
              maximizeIcon.style.display = 'block';
              restoreIcon.style.display = 'none';
            }
          }
        });
      }
    }
  }

  function buildBlindboxOverlayUrl() {
    const base = `${localOverlayOrigin(location)}/blindbox`;
    const params = [];
    const add = (key, value) => { if (value) params.push(`${key}=${encodeURIComponent(value)}`); };

    const top = val('blindboxOverlayTop');
    if (top !== '') add('top', top);

    const title = val('blindboxOverlayTitle').trim();
    if (title) add('title', title);

    if (checked('blindboxWinnersOnly')) add('winners', '1');
    if (checked('blindboxHeartBoxOnly')) add('heartBox', '1');

    return params.length ? `${base}?${params.join('&')}` : base;
  }

  function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function checked(id) { const el = document.getElementById(id); return el ? el.checked : false; }

  function updateBlindboxOverlayUrl() {
    const url = buildBlindboxOverlayUrl();
    const code = document.getElementById('blindboxOverlayUrl');
    const liveLink = document.getElementById('blindboxLiveLink');
    if (code) code.textContent = url;
    if (liveLink) liveLink.href = url;
  }

  function collectSettings() {
    return {
      roomId: value('roomId'),
      enableBilibili: value('enableBilibili'),
      paused: value('paused'),
      queueLimit: value('queueLimit'),
      userCooldownSeconds: value('userCooldownSeconds'),
      onlyFromLibrary: value('onlyFromLibrary'),
      allowDuplicate: value('allowDuplicate')
    };
  }

  async function clearDatabase() {
    const ok = await dangerConfirm({
      title: '清空歌库',
      message: '只会删除歌曲和分类，直播间号、主题颜色和其他设置会保留。',
      deletes: ['歌曲', '分类'],
      keeps: ['直播间号', '主题颜色', '所有设置'],
      confirmLabel: '确认清空歌库'
    });
    if (!ok) return;
    await api('/api/database/clear', { confirm: true });
    toast('歌库已清空');
    if (window.AdminApp.state && window.AdminApp.state.reloadAll) {
      await window.AdminApp.state.reloadAll();
    }
  }

  async function clearSuperChats() {
    const ok = await dangerConfirm({
      title: '清空 SC 记录',
      message: '确认清空所有 SC（醒目留言）记录？',
      deletes: ['SC 记录'],
      confirmLabel: '确认清空'
    });
    if (!ok) return;
    const response = await api('/api/database/clear-superchats', { confirm: true });
    toast(`SC 记录已清空（共 ${response.data.deletedCount} 条）`);
    if (window.AdminApp.state && window.AdminApp.state.reloadState) {
      await window.AdminApp.state.reloadState();
    }
  }

  async function clearAll() {
    const ok = await dangerConfirm({
      title: '清空全部数据',
      message: '此操作将删除以下所有数据：',
      deletes: ['歌库', '分类', '点歌队列', '点歌记录', 'SC 记录'],
      keeps: ['直播间号', '主题颜色', '所有设置'],
      confirmLabel: '确认清空全部'
    });
    if (!ok) return;
    const response = await api('/api/database/clear-all', { confirm: true });
    const d = response.data.deletedCounts;
    toast(`全部数据已清空 — 歌曲 ${d.songs} · 队列 ${d.queue} · 记录 ${d.requests} · SC ${d.sc}（共 ${response.data.totalDeleted} 条），设置已保留`);
    if (window.AdminApp.state && window.AdminApp.state.reloadAll) {
      await window.AdminApp.state.reloadAll();
    }
  }

  function renderShutdownScreen(isDesktop) {
    const hintText = isDesktop
      ? '点击下方按钮重新启动点歌助手，恢复直播服务。'
      : '本地服务已关闭，端口已释放。<br>再次使用时双击项目里的 <code>一键启动.bat</code>。';
    return `
      <main class="app-shell shutdown-screen">
        <section class="shutdown-card">
          <div class="shutdown-icon" aria-hidden="true">
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
              <circle cx="36" cy="36" r="34" stroke="currentColor" stroke-width="2.5" opacity="0.25"/>
              <circle cx="36" cy="36" r="30" stroke="currentColor" stroke-width="1.5" opacity="0.12"/>
              <path d="M36 16V36M36 46.5V48" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
              <circle cx="36" cy="56" r="2.5" fill="currentColor" opacity="0.7"/>
            </svg>
          </div>
          <h1 class="shutdown-title">点歌助手已退出</h1>
          <p class="shutdown-subtitle">本地服务已安全关闭</p>
          <ul class="shutdown-checklist">
            <li><span class="check-mark">✓</span> 本地 HTTP 服务已停止</li>
            <li><span class="check-mark">✓</span> 端口已释放</li>
            <li><span class="check-mark">✓</span> 弹幕监听已断开</li>
            <li><span class="check-mark">✓</span> 数据已保存</li>
          </ul>
          <div class="shutdown-actions">
            ${isDesktop ? `<button id="restartAppBtn" class="primary shutdown-restart-btn" type="button">🔄 重新启动</button>` : ''}
            <button id="closeWindowBtn" class="${isDesktop ? '' : 'primary'}" type="button">${isDesktop ? '关闭窗口' : '关闭页面'}</button>
          </div>
          <p class="shutdown-hint">${hintText}</p>
        </section>
      </main>
    `;
  }

  async function shutdownServer() {
    if (!confirm('确认退出点歌助手？退出后会关闭本地服务并释放端口。')) {
      return;
    }
    if (window.AdminApp.state && window.AdminApp.state.setShuttingDown) {
      window.AdminApp.state.setShuttingDown(true);
    }
    document.getElementById('shutdownBtn').disabled = true;
    document.getElementById('shutdownBtn').textContent = '正在退出';
    document.getElementById('wsStatus').textContent = '正在退出';
    document.getElementById('wsStatus').className = 'pill warn';

    try {
      await api('/api/system/shutdown', { confirm: true });
    } catch (_) {
      // Server may close before responding.
    }

    const isDesktop = !!window.songAssistantDesktop;
    document.body.innerHTML = renderShutdownScreen(isDesktop);

    if (isDesktop) {
      document.getElementById('restartAppBtn').addEventListener('click', async () => {
        const btn = document.getElementById('restartAppBtn');
        btn.disabled = true;
        btn.textContent = '正在重新启动…';
        try {
          await window.songAssistantDesktop.restart();
        } catch (_) {
          btn.textContent = '重启失败，请手动启动';
        }
      });
    }

    document.getElementById('closeWindowBtn').addEventListener('click', () => {
      if (isDesktop) {
        window.songAssistantDesktop.closeWindow();
      } else {
        window.close();
      }
    });
  }

  async function reconnectBilibili() {
    const btn = document.getElementById('reconnectBtn');
    btn.disabled = true;
    btn.textContent = '刷新中…';
    try {
      const response = await fetch('/api/bilibili/reconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const payload = await readJsonResponse(response, '刷新直播失败');
      const appState = window.AdminApp.state.getAppState();
      if (payload.data && payload.data.liveStatus) {
        if (appState) {
          appState.liveStatus = payload.data.liveStatus;
        }
        if (window.AdminApp.queue && window.AdminApp.queue.renderState) {
          const songs = window.AdminApp.state.getSongs();
          window.AdminApp.queue.renderState(appState, songs);
        }
      }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `刷新直播失败（HTTP ${response.status}）`);
      }
      if (payload.data && payload.data.liveStatus) {
        showStackedToast({
          key: 'live-refresh-ok',
          title: '直播状态已刷新',
          message: '弹幕连接已重新建立',
          className: 'admin-live-refresh-toast',
          duration: 2800
        });
      } else {
        throw new Error('刷新直播失败：服务未返回直播状态。');
      }
    } catch (error) {
      if (window.AdminApp.forms && window.AdminApp.forms.reconnectErrorMessage) {
        toast(window.AdminApp.forms.reconnectErrorMessage(error));
      } else {
        toast(error.message || String(error));
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '刷新直播';
    }
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.settings = {
    initBilibiliAuth,
    initSettingsForm,
    collectSettings,
    clearDatabase,
    clearSuperChats,
    clearAll,
    shutdownServer,
    reconnectBilibili,
    renderShutdownScreen,
    updateBlindboxOverlayUrl
  };
})();
