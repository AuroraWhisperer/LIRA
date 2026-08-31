'use strict';

function reloadAfterPartialClearAll(response, { alertRef, locationRef }) {
  if (response?.partial !== true) return false;
  const committed = response.data?.committed || [];
  const failed = response.data?.failed || [];
  alertRef(
    `数据库清空部分失败：\n\n` +
      `✓ 已提交：${committed.join(', ')}\n` +
      `✗ 失败：${failed.join(', ')}\n\n` +
      `数据库处于不一致状态，页面将重新加载。`,
  );
  locationRef.reload();
  return true;
}

export function createSettingsOperations({
  documentRef,
  windowRef,
  locationRef,
  localStorageRef,
  fetchRef,
  alertRef,
  api,
  readJsonResponse,
  toast,
  showStackedToast,
  dangerConfirm,
  showConfirmationDialog,
  getState,
  getQueue,
  getForms,
}) {
  async function clearDatabase() {
    const confirmed = await dangerConfirm({
      title: '清空歌库',
      message: '只会删除歌曲和分类，直播间号、主题颜色和其他设置会保留。',
      deletes: ['歌曲', '分类'],
      keeps: ['直播间号', '主题颜色', '所有设置'],
      confirmLabel: '确认清空歌库',
    });
    if (!confirmed) return;
    await api('/api/database/clear', { confirm: true });
    toast('歌库已清空');
    await getState()?.reloadAll?.();
  }

  async function clearSuperChats() {
    const confirmed = await dangerConfirm({
      title: '清空 SC 记录',
      message: '确认清空所有 SC（醒目留言）记录？',
      deletes: ['SC 记录'],
      confirmLabel: '确认清空',
    });
    if (!confirmed) return;
    const response = await api('/api/database/clear-superchats', {
      confirm: true,
    });
    toast(`SC 记录已清空（共 ${response.data.deletedCount} 条）`);
    await getState()?.reloadState?.();
  }

  async function clearAll() {
    const confirmed = await dangerConfirm({
      title: '清空全部数据',
      message: '将清除业务数据，并清理 QQ 音乐、网易云音乐的缓存。',
      deletes: [
        '歌曲与点歌数据',
        'SC、礼物与加班机记录',
        '播放、签到与 AI 运行数据',
        'QQ 音乐、网易云音乐缓存',
      ],
      keeps: [
        '直播间号、主题与其他设置',
        'AI 配置、主题预设',
        '加班机规则、收藏与歌单',
      ],
      confirmLabel: '确认清空全部',
    });
    if (!confirmed) return;

    try {
      const response = await api('/api/database/clear-all', { confirm: true });
      if (typeof windowRef.musicAPI?.clearCache === 'function') {
        try {
          await windowRef.musicAPI.clearCache();
        } catch (error) {
          void error;
        }
      }
      try {
        for (
          let index = (localStorageRef?.length || 0) - 1;
          index >= 0;
          index--
        ) {
          const key = localStorageRef.key(index);
          if (key?.startsWith('playbackCache:'))
            localStorageRef.removeItem(key);
        }
      } catch (error) {
        void error;
      }

      if (reloadAfterPartialClearAll(response, { alertRef, locationRef }))
        return;

      const deleted = response.data.deletedCounts;
      const total = response.data.totalDeleted || 0;
      toast(
        `全部数据已清空 — ` +
          `歌曲 ${deleted.songs} · 队列 ${deleted.queue} · 记录 ${deleted.requests} · ` +
          `SC ${deleted.sc} · 礼物 ${deleted.gifts} · 播放 ${deleted.playHistory} · ` +
          `签到 ${deleted.checkins}（共 ${total} 条），配置已保留`,
      );
      await getState()?.reloadAll?.();
    } catch (error) {
      if (
        reloadAfterPartialClearAll(error.payload, { alertRef, locationRef })
      ) {
        return;
      }
      toast('清空失败：' + (error.message || String(error)));
    }
  }

  function renderShutdownScreen(isDesktop) {
    const hintText = isDesktop
      ? '点击下方按钮重新启动 LIRA，恢复直播服务。'
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
          <h1 class="shutdown-title ui-page-title">LIRA 已退出</h1>
          <p class="shutdown-subtitle ui-page-subtitle">本地服务已安全关闭</p>
          <ul class="shutdown-checklist ui-body">
            <li><span class="check-mark">✓</span> 本地 HTTP 服务已停止</li>
            <li><span class="check-mark">✓</span> 端口已释放</li>
            <li><span class="check-mark">✓</span> 弹幕监听已断开</li>
            <li><span class="check-mark">✓</span> 数据已保存</li>
          </ul>
          <div class="shutdown-actions">
            ${isDesktop ? `<button id="restartAppBtn" class="primary shutdown-restart-btn" type="button">🔄 重新启动</button>` : ''}
            <button id="closeWindowBtn" class="${isDesktop ? '' : 'primary'}" type="button">${isDesktop ? '关闭窗口' : '关闭页面'}</button>
          </div>
          <p class="shutdown-hint ui-caption">${hintText}</p>
        </section>
      </main>
    `;
  }

  async function shutdownServer() {
    const confirmed = await showConfirmationDialog({
      variant: 'caution',
      title: '退出 LIRA？',
      description:
        '应用会关闭本地服务、断开弹幕连接并释放端口。已保存的数据不会受到影响。',
      confirmLabel: '退出 LIRA',
      initialFocus: 'cancel',
    });
    if (!confirmed) return;
    await getState()?.setShuttingDown?.(true);
    const shutdownBtn = documentRef.getElementById('shutdownBtn');
    shutdownBtn.disabled = true;
    shutdownBtn.textContent = '正在退出';
    const wsStatus = documentRef.getElementById('wsStatus');
    wsStatus.hidden = false;
    wsStatus.textContent = '正在退出';
    wsStatus.className = 'pill warn';
    try {
      await api('/api/system/shutdown', { confirm: true });
    } catch (error) {
      void error;
    }

    const isDesktop = Boolean(windowRef.songAssistantDesktop);
    documentRef.body.innerHTML = renderShutdownScreen(isDesktop);
    if (isDesktop) {
      documentRef
        .getElementById('restartAppBtn')
        .addEventListener('click', async () => {
          const button = documentRef.getElementById('restartAppBtn');
          button.disabled = true;
          button.textContent = '正在重新启动…';
          try {
            await windowRef.songAssistantDesktop.restart();
          } catch (error) {
            void error;
            button.textContent = '重启失败，请手动启动';
          }
        });
    }
    documentRef
      .getElementById('closeWindowBtn')
      .addEventListener('click', () => {
        if (isDesktop) windowRef.songAssistantDesktop.closeWindow();
        else windowRef.close();
      });
  }

  async function reconnectBilibili() {
    const button = documentRef.getElementById('reconnectBtn');
    button.disabled = true;
    button.textContent = '刷新中…';
    try {
      const response = await fetchRef('/api/bilibili/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await readJsonResponse(response, '刷新直播失败');
      const appState = getState()?.getAppState?.();
      if (payload.data?.liveStatus) {
        if (appState) appState.liveStatus = payload.data.liveStatus;
        getQueue()?.renderState?.(appState, getState()?.getSongs?.());
      }
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error || `刷新直播失败（HTTP ${response.status}）`,
        );
      }
      if (payload.data?.liveStatus) {
        showStackedToast({
          key: 'live-refresh-ok',
          title: '直播状态已刷新',
          message:
            payload.data.liveStatus.message || '弹幕连接已重新建立',
          className: 'admin-live-refresh-toast',
          duration: 2800,
        });
      } else {
        throw new Error('刷新直播失败：服务未返回直播状态。');
      }
    } catch (error) {
      const customMessage = getForms()?.reconnectErrorMessage?.(error);
      toast(customMessage || error.message || String(error));
    } finally {
      button.disabled = false;
      button.textContent = '刷新直播';
    }
  }

  return {
    clearDatabase,
    clearSuperChats,
    clearAll,
    renderShutdownScreen,
    shutdownServer,
    reconnectBilibili,
  };
}
