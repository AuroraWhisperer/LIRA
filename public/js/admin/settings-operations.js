'use strict';

import { clearSuperChatUndo } from './superchat.js';
import { clearStoredPlaybackState } from '../playback/state/storage.js';

function reconnectErrorMessage(error) {
  const text = String(error?.message ?? error ?? '');
  if (error?.code === 'INVALID_RESPONSE' || (error?.status && !error.payload)) {
    const detail = error.status >= 400 ? `（HTTP ${error.status}）` : '';
    return `未能读取本地服务返回的直播间状态${detail}，请稍后重新连接。`;
  }
  if (/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(text)) {
    return '重新连接直播间失败：本地服务未响应，请重启 LIRA 后再试。';
  }
  return text || '重新连接直播间失败，请稍后重试。';
}

async function finishReconnectAnimation(button) {
  const icon = button.querySelector('svg');
  const spin = icon.getAnimations().find((animation) => animation.animationName === 'topbar-refresh-spin');
  if (!spin) return;
  const duration = spin.effect.getTiming().duration;
  const turn = (spin.currentTime / duration) % 1;
  // The two arrows have the same silhouette every half turn.
  const endTurn = Math.ceil(turn * 2) / 2;
  const settle = icon.animate([
    { transform: `rotate(${turn * 360}deg)` },
    { transform: `rotate(${endTurn * 360}deg)` },
  ], { duration: Math.min(240, (endTurn - turn) * duration), easing: 'ease-out' });
  spin.cancel();
  await settle.finished.catch(() => {});
  settle.cancel();
}

function clearLocalPlaybackData(localStorageRef) {
  try {
    clearStoredPlaybackState(localStorageRef);
    for (let index = (localStorageRef?.length || 0) - 1; index >= 0; index--) {
      const key = localStorageRef.key(index);
      if (key?.startsWith('playbackCache:')) localStorageRef.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

const CLEAR_DATA_NAMES = {
  songDb: '歌库、点歌及 AI 运行数据', superChatDb: '醒目留言', giftDb: '礼物与加班机记录',
  musicDb: '播放记录与队列进度', checkinDb: '签到记录',
};

function clearDataName(key) {
  return CLEAR_DATA_NAMES[key] || '其他本地数据';
}

function reportPartialClearAll(response, localFailures, alertRef) {
  const committed = response.data?.committed || [];
  const failed = response.data?.failed || [];
  const phase = response.data?.phase || response.phase;
  const phaseText = phase === 'runtime-reset' ? '数据已清空，但运行状态未能刷新。'
    : phase === 'resume' ? '数据已清空，但写入尚未恢复。'
      : '部分数据未能清空，请核对以下结果。';
  if (response.error) console.warn('[clear-all]', response.error);
  alertRef(
    `${phaseText}\n\n` +
      (committed.length ? `✓ 已清空：${committed.map(clearDataName).join('、')}\n` : '') +
      (failed.length ? `✗ 清空失败：${failed.map(clearDataName).join('、')}\n` : '') +
      (localFailures.length ? `本机清理失败：${localFailures.join('、')}\n` : '') +
      (response.data?.rollbackFailed?.length ? `状态待核对：${response.data.rollbackFailed.map(clearDataName).join('、')}\n` : '') +
      '\n' +
      `礼物导入与加班机写入仍暂停，刷新页面不会恢复。请从「百宝箱 → 设置 → 系统与关于 → 本地数据与诊断」打开日志目录并检查数据；确认后可再次完整清空，成功后恢复写入。\n` +
      (localFailures.length ? '请先核对本机播放状态。' : '页面将重新加载。'),
  );
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
}) {
  async function clearDatabase() {
    const confirmed = await dangerConfirm({
      title: '清空歌库',
      message: '清空成功后，LIRA 会尝试同步清空后的歌库。请先核对下方要删除和保留的内容。',
      deletes: ['歌曲', '曲风', '歌单导入记录'],
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
      confirmLabel: '清空 SC 记录',
    });
    if (!confirmed) return;
    const response = await api('/api/database/clear-superchats', {
      confirm: true,
    });
    clearSuperChatUndo();
    toast(`SC 记录已清空（共 ${response.data.deletedCount} 条）`);
    await getState()?.reloadState?.();
  }

  async function clearAll() {
    const confirmed = await dangerConfirm({
      title: '清空歌库及使用记录',
      message: '清空成功后，当前播放会停止，页面会重新加载。加班机会关闭，初始时长和剩余时间都会归零，礼物加减时规则会保留。LIRA 会尝试同步清空后的歌库。请先核对下方清单。',
      deletes: ['歌曲与点歌数据', 'SC、礼物与加班机记录', '播放、签到与 AI 运行数据', 'QQ 音乐、网易云音乐缓存'],
      keeps: [
        '直播间号、主题与其他设置',
        'AI 配置、主题预设',
        '加班机规则、收藏与歌单',
        '粉丝档案、互动记录与提醒状态',
      ],
      confirmLabel: '清空歌库及使用记录',
    });
    if (!confirmed) return;

    let response;
    try {
      response = await api('/api/database/clear-all', { confirm: true }, { notifyError: false });
    } catch (error) {
      if (error.payload?.partial !== true) {
        toast('清空失败：' + (error.message || String(error)), { type: 'error' });
        return;
      }
      response = error.payload;
    }

    const partial = response.partial === true;
    const committed = response.data?.committed || [];
    const localFailures = [];
    if (!partial || committed.includes('musicDb')) {
      if (typeof windowRef.musicAPI?.clearCache === 'function') {
        try {
          await windowRef.musicAPI.clearCache();
        } catch {
          localFailures.push('音乐缓存');
        }
      }
      if (!clearLocalPlaybackData(localStorageRef)) localFailures.push('本机播放状态');
    }
    if (!partial || committed.includes('superChatDb')) clearSuperChatUndo();
    if (partial) {
      reportPartialClearAll(response, localFailures, alertRef);
      if (!localFailures.length) locationRef.reload();
      return;
    }
    if (localFailures.length) {
      alertRef(`数据库已清空，${localFailures.join('、')}未能清理。请核对本机播放状态。`);
      return;
    }

    const deleted = response.data.deletedCounts;
    const total = response.data.totalDeleted || 0;
    const resultNode = documentRef.getElementById('clearAllResult');
    if (resultNode) {
      resultNode.hidden = false;
      resultNode.textContent =
        `歌曲 ${deleted.songs} · 队列 ${deleted.queue} · 记录 ${deleted.requests} · ` +
        `SC ${deleted.sc} · 礼物 ${deleted.gifts} · 播放 ${deleted.playHistory} · ` +
        `签到 ${deleted.checkins}（共 ${total} 条），配置已保留`;
    }
    toast(`已清空共 ${total} 条数据，配置已保留`, { type: 'success' });
    locationRef.reload();
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
            <li><span class="check-mark">✓</span> 本地服务已停止</li>
            <li><span class="check-mark">✓</span> 端口已释放</li>
            <li><span class="check-mark">✓</span> 本机连接已断开；云端监听与已开启的机器人继续运行</li>
            <li><span class="check-mark">✓</span> 已保存的数据保留</li>
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
      description: '本地服务和本机浏览器源会停止。云端监听和已开启的云端机器人会继续运行。已保存的数据会保留。',
      confirmLabel: '退出 LIRA',
      initialFocus: 'cancel',
    });
    if (!confirmed) return;
    const shutdownBtn = documentRef.getElementById('shutdownBtn');
    const buttonText = shutdownBtn.textContent;
    shutdownBtn.disabled = true;
    shutdownBtn.textContent = '正在退出';
    try {
      await api('/api/system/shutdown', { confirm: true }, { notifyError: false });
    } catch (error) {
      // A shutdown broadcast confirms acceptance even if its HTTP response was lost.
      if (!getState()?.shuttingDown) {
        shutdownBtn.disabled = false;
        shutdownBtn.textContent = buttonText;
        toast('退出请求失败：' + (error.message || String(error)), { type: 'error' });
        return;
      }
    }
    getState()?.setShuttingDown?.(true);

    const isDesktop = Boolean(windowRef.songAssistantDesktop);
    documentRef.body.innerHTML = renderShutdownScreen(isDesktop);
    if (isDesktop) {
      documentRef.getElementById('restartAppBtn').addEventListener('click', async () => {
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
    documentRef.getElementById('closeWindowBtn').addEventListener('click', () => {
      if (isDesktop) windowRef.songAssistantDesktop.closeWindow();
      else windowRef.close();
    });
  }

  async function reconnectBilibili({ silent = false } = {}) {
    const button = documentRef.getElementById('reconnectBtn');
    let reconnectedStatus;
    if (!silent) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-label', '正在连接直播间');
      button.title = '正在连接直播间';
    }
    try {
      const response = await fetchRef('/api/bilibili/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await readJsonResponse(response, '重新连接直播间失败');
      const appState = getState()?.getAppState?.();
      if (payload?.data?.liveStatus) {
        if (appState) appState.liveStatus = payload.data.liveStatus;
        getQueue()?.renderState?.(appState, getState()?.getSongs?.());
      }
      if (!response.ok || !payload?.ok) {
        const detail = response.ok ? '' : `（HTTP ${response.status}）`;
        throw Object.assign(new Error(payload?.error || `重新连接直播间失败${detail}，请稍后重试。`), { status: response.status, payload });
      }
      if (payload?.data?.liveStatus) {
        reconnectedStatus = payload.data.liveStatus;
      } else {
        throw new Error('重新连接直播间失败：服务未返回直播状态。');
      }
    } catch (error) {
      if (error.status && !error.payload?.error) console.warn('[bilibili:reconnect]', `HTTP ${error.status}`, error.code || '');
      if (!silent) toast(reconnectErrorMessage(error), { type: 'error' });
    } finally {
      if (!silent) {
        await finishReconnectAnimation(button);
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.setAttribute('aria-label', '重新连接直播间');
        button.title = '重新连接直播间';
        if (reconnectedStatus) showStackedToast({
          key: 'live-refresh-ok',
          type: 'success',
          message: `已重新连接直播间\n${reconnectedStatus.message || '弹幕连接已重新建立'}`,
          className: 'admin-live-refresh-toast',
          duration: 2800,
          update: true,
        });
      }
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
