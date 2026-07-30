// 编写人：Aurora
// 基础设置和系统操作
'use strict';

(function () {
  const {
    value,
    toast,
    api,
    readJsonResponse
  } = window.AdminApp.utils;

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
        enableGiftSprint: value('enableGiftSprint'),
        giftSprintTargetRmb: value('giftSprintTargetRmb')
      });
      toast('礼物冲刺设置已保存');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    document.getElementById('giftSprintResetBtn').addEventListener('click', async () => {
      if (!confirm('确认重置本轮礼物冲刺已收金额？礼物流水会保留，只是不再计入本轮冲刺。')) return;
      await api('/api/gifts/sprint/reset', {});
      toast('本轮礼物冲刺已重置');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

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
    document.getElementById('giftProtocolCheckBtn').addEventListener('click', () => {
      if (window.AdminApp.gifts && window.AdminApp.gifts.checkGiftProtocol) {
        window.AdminApp.gifts.checkGiftProtocol();
      }
    });

    if (window.songAssistantDesktop) {
      const minBtn = document.getElementById('winMinBtn');
      const maxBtn = document.getElementById('winMaxBtn');
      const closeBtn = document.getElementById('winCloseBtn');
      if (minBtn) minBtn.addEventListener('click', () => window.songAssistantDesktop.minimizeWindow());
      if (maxBtn) maxBtn.addEventListener('click', () => window.songAssistantDesktop.maximizeWindow());
      if (closeBtn) closeBtn.addEventListener('click', () => window.songAssistantDesktop.closeWindow());
    }
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
    if (!confirm('确认清空歌库？只会删除歌曲和分类，直播间号、主题颜色和其他设置会保留。')) {
      return;
    }
    await api('/api/database/clear', { confirm: true });
    toast('歌库已清空');
    if (window.AdminApp.state && window.AdminApp.state.reloadAll) {
      await window.AdminApp.state.reloadAll();
    }
  }

  async function clearSuperChats() {
    if (!confirm('确认清空所有 SC（醒目留言）记录？此操作不可撤销。')) {
      return;
    }
    const response = await api('/api/database/clear-superchats', { confirm: true });
    toast(`SC 记录已清空（共 ${response.data.deletedCount} 条）`);
    if (window.AdminApp.state && window.AdminApp.state.reloadState) {
      await window.AdminApp.state.reloadState();
    }
  }

  async function clearAll() {
    if (!confirm('⚠️ 确认清空全部数据？\n\n这将删除：歌库、分类、点歌队列、点歌记录、SC 记录\n保留：直播间号、主题颜色、所有设置\n\n此操作不可撤销！')) {
      return;
    }
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
        toast('直播状态已刷新');
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
    initSettingsForm,
    collectSettings,
    clearDatabase,
    clearSuperChats,
    clearAll,
    shutdownServer,
    reconnectBilibili,
    renderShutdownScreen
  };
})();
