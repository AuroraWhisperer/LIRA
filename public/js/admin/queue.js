// 编写人：Aurora
// 队列和 SuperChat 管理
'use strict';

(function () {
  const {
    escapeHtml,
    escapeAttr,
    value,
    setValue,
    formatTime,
    formatSuperChatPrice,
    withMultilingualFallback,
    toast,
    api,
    dangerConfirm
  } = window.AdminApp.utils;

  function initQueueForm() {
    document.getElementById('manualForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/queue/add', {
        songName: value('manualSong'),
        artist: value('manualArtist'),
        requesterName: value('manualRequester') || '主播',
        source: 'admin'
      });
      setValue('manualSong', '');
      setValue('manualArtist', '');
      toast('已添加到队列');
      if (window.AdminApp.state && window.AdminApp.state.reloadState) {
        await window.AdminApp.state.reloadState();
      }
    });

    document.getElementById('nextBtn').addEventListener('click', () => queueAction('next'));
    document.getElementById('clearBtn').addEventListener('click', async () => {
      const confirmed = await dangerConfirm({
        title: '清空全部队列',
        message: '当前歌曲和所有等待中的歌曲都会被移除，此操作不可撤销。',
        deletes: ['当前播放歌曲', '全部等待队列'],
        confirmLabel: '确认清空队列'
      });
      if (confirmed) await queueAction('clear');
    });

    // 将 wheel 事件的 deltaY 归一化为像素值（Windows 普通鼠标报告行模式 deltaMode=1）
    function normalizedWheelDelta(event, el) {
      switch (event.deltaMode) {
        case 1: return event.deltaY * 40;          // 行模式：行高约 40px
        case 2: return event.deltaY * el.clientHeight; // 页模式：按容器高度换算
        default: return event.deltaY;              // 像素模式：直接使用
      }
    }

    // Keep wheel input inside an overflowing queue, then let the page scroll at its edges.
    function bindQueueWheel(list) {
      if (!list) return;
      const panel = list.closest('.queue-panel') || list;
      panel.addEventListener('wheel', (event) => {
        const delta = normalizedWheelDelta(event, list);
        const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
        const canScroll = maxScrollTop > 0 && (
          delta < 0 ? list.scrollTop > 0 : delta > 0 && list.scrollTop < maxScrollTop
        );
        if (!canScroll) return;

        event.preventDefault();
        list.scrollTop += delta * 0.3;
      }, { passive: false });
    }

    bindQueueWheel(document.getElementById('superChatList'));
    bindQueueWheel(document.getElementById('queueList'));
  }

  function renderState(appState, songs) {
    if (!appState) return;
    const current = appState.queue.current;
    const waiting = appState.queue.waiting || [];
    const queueItems = [current].concat(waiting).filter(Boolean);
    const settings = appState.settings || {};
    const superChats = Array.isArray(appState.superChats) ? appState.superChats : [];
    const gifts = appState.gifts || {};
    const giftSprint = appState.giftSprint || {};

    document.getElementById('songCount').textContent = `歌库 ${appState.songCount || 0} 首`;
    const totalCount = queueItems.length;
    document.getElementById('queueSize').textContent = `${totalCount} 首`;
    renderSuperChatQueue(superChats);

    // 先填充表单（确保盲盒 textarea 等已就绪），再渲染礼物面板
    if (window.AdminApp.forms && window.AdminApp.forms.fillForm) {
      window.AdminApp.forms.fillForm(settings);
    }
    const giftToggle = document.getElementById('giftDetectToggle');
    if (giftToggle) giftToggle.checked = settings.enableGiftSprint !== 'false';

    const autoUpdateToggle = document.getElementById('autoUpdateToggle');
    const autoUpdateLabel = document.getElementById('autoUpdateLabel');
    if (autoUpdateToggle) {
      autoUpdateToggle.checked = settings.enableAutoUpdate === 'true';
      if (autoUpdateLabel) {
        autoUpdateLabel.textContent = autoUpdateToggle.checked ? '已开启' : '已关闭';
      }
    }

    if (window.AdminApp.gifts && window.AdminApp.gifts.renderGiftPanel) {
      window.AdminApp.gifts.renderGiftPanel(gifts, giftSprint, appState.liveStatus || {}, appState.bilibiliDiagnostics || {}, settings);
    }

    // 盲盒盈亏统计（独立加载，不阻塞渲染）
    if (window.AdminApp.gifts && window.AdminApp.gifts.loadBlindBoxStats) {
      window.AdminApp.gifts.loadBlindBoxStats();
    }

    const live = appState.liveStatus || {};
    const liveStatus = document.getElementById('liveStatus');
    const ownerName = live.ownerName || '';
    const roomId = live.roomId || '';
    const statusText = live.message || '弹幕监听未启用';
    const isLive = live.connected;

    let html = '';
    if (isLive && ownerName) {
      html = `<span class="owner-name">${escapeHtml(ownerName)}</span> ${escapeHtml(statusText)}`;
    } else if (ownerName) {
      html = `${escapeHtml(statusText)} <span class="owner-name">${escapeHtml(ownerName)}</span>`;
    } else {
      html = escapeHtml(statusText);
    }
    if (!isLive && roomId) {
      html += ` <span class="room-id-hint">· ${escapeHtml(roomId)}</span>`;
    }
    liveStatus.innerHTML = html;
    liveStatus.className = isLive ? 'pill good' : (live.enabled ? 'pill warn' : 'pill');

    const list = document.getElementById('queueList');
    applyAdminQueueFontPreview(settings);
    if (queueItems.length === 0) {
      list.innerHTML = `
        <div class="empty queue-empty">
          <div class="empty-icon">🎵</div>
          <div class="empty-text">暂无点歌</div>
          <div class="empty-hint">观众点歌后会显示在这里</div>
        </div>
      `;
    } else {
      list.innerHTML = queueItems.map((item, index) => {
        const pinButton = index === 0 && !item.is_pinned
          ? ''
          : `
                <button class="icon" title="${item.is_pinned ? '取消置顶' : '置顶'}" type="button" data-action="${item.is_pinned ? 'unpin' : 'pin'}" data-id="${item.id}">${item.is_pinned ? '↧' : '↑'}</button>`;

        // 根据歌曲名长度决定字体大小
        const songText = `${item.is_pinned ? '📌 ' : ''}${index + 1}. ${escapeHtml(item.song_name)}`;
        const textLength = (item.song_name || '').length;
        let lengthAttr = '';
        if (textLength > 35) {
          lengthAttr = ' data-length="very-long"';
        } else if (textLength > 20) {
          lengthAttr = ' data-length="long"';
        }

        return `
            <div class="queue-row">
              <div>
                <div class="song"${lengthAttr}>${songText}</div>
                <div class="meta">${escapeHtml(requesterLabel(item))} · ${escapeHtml(sourceLabel(item))} · ${formatTime(item.created_at)}</div>
              </div>
              <div class="queue-actions">
                ${pinButton}
                <button class="icon" title="复制歌名" type="button" data-copy="${escapeAttr(item.song_name)}">⧉</button>
                <button class="icon" title="删除" type="button" data-action="delete" data-id="${item.id}">×</button>
              </div>
            </div>
          `;
      }).join('');
    }

    if (window.AdminApp.songs && window.AdminApp.songs.renderCategoryFilter) {
      const categories = window.AdminApp.state.getCategories();
      window.AdminApp.songs.renderCategoryFilter(categories);
    }

    document.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => queueAction(button.dataset.action, button.dataset.id));
    });
    document.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(button.dataset.copy);
        toast('歌名已复制');
      });
    });
  }

  function renderSuperChatQueue(items) {
    const list = document.getElementById('superChatList');
    const size = document.getElementById('superChatSize');
    if (!list || !size) return;

    size.textContent = `${items.length} 条`;
    if (items.length === 0) {
      list.innerHTML = `
        <div class="empty sc-empty">
          <div class="empty-icon">💬</div>
          <div class="empty-text">暂无醒目留言</div>
          <div class="empty-hint">SC 消息会显示在这里</div>
        </div>
      `;
      return;
    }

    list.innerHTML = items.map((item, index) => `
      <div class="queue-row sc-row ${item.status === 'assisted' ? 'assisted' : ''}">
        <div>
          <div class="song">
            <span class="sc-admin-price">SC ¥${escapeHtml(formatSuperChatPrice(item.price))}</span>
            ${index + 1}. ${escapeHtml(item.message || '醒目留言')}
          </div>
          <div class="meta">${escapeHtml(item.user_name || '观众')} · ${formatTime(item.created_at)}${item.status === 'assisted' ? ' <span class="sc-badge-assisted">✓ 已处理</span>' : ''}</div>
        </div>
        <div class="queue-actions">
          <button class="icon" title="${item.status === 'assisted' ? '取消处理' : '标记已处理'}" type="button" data-sc-action="${item.status === 'assisted' ? 'unassist' : 'assist'}" data-id="${item.id}">${item.status === 'assisted' ? '↺' : '✓'}</button>
          <button class="icon" title="复制 SC" type="button" data-copy="${escapeAttr(item.message || '')}">⧉</button>
          <button class="icon" title="删除 SC" type="button" data-sc-action="delete" data-id="${item.id}">×</button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('[data-sc-action]').forEach((button) => {
      button.addEventListener('click', () => superChatAction(button.dataset.scAction, button.dataset.id));
    });
  }

  function applyAdminQueueFontPreview(settings = {}) {
    const list = document.getElementById('queueList');
    if (!list) return;
    const fontFamily = settings.overlayFontFamily || value('overlayFontFamily') || 'Microsoft YaHei';
    const fontWeight = settings.overlayFontWeight || value('overlayFontWeight') || '700';
    list.style.setProperty('--admin-queue-font-family', withMultilingualFallback(fontFamily));
    list.style.setProperty('--admin-queue-font-weight', fontWeight);
  }

  async function queueAction(action, id) {
    console.log('[queueAction]', action, id);
    const result = await api('/api/queue/action', { action, id });
    console.log('[queueAction] result:', result);
    if (window.AdminApp.state && window.AdminApp.state.reloadState) {
      await window.AdminApp.state.reloadState();
    }
  }

  async function superChatAction(action, id) {
    await api('/api/superchats/action', { action, id });
    if (window.AdminApp.state && window.AdminApp.state.reloadState) {
      await window.AdminApp.state.reloadState();
    }
  }

  function requesterLabel(item) {
    const name = String((item && item.requester_name) || '').trim();
    if (name) return name;
    const uid = String((item && item.requester_uid) || '').trim();
    return uid ? `观众 ${uid}` : '观众';
  }

  function sourceLabel(itemOrSource) {
    const item = typeof itemOrSource === 'object' && itemOrSource ? itemOrSource : null;
    const source = item ? item.source : itemOrSource;
    if (source === 'random' || String(source || '').startsWith('random:')) {
      const scope = String(source || '').startsWith('random:')
        ? String(source).slice('random:'.length).trim()
        : randomScopeLabel(item && item.request_message);
      return scope ? `随机点歌 · ${scope}` : '随机点歌';
    }
    return {
      admin: '手动',
      danmaku: '弹幕',
      superchat: '醒目留言',
      history: '历史补偿',
    }[source] || source || '未知';
  }

  function randomScopeLabel(message) {
    const text = String(message || '').trim().replace(/\s+/g, ' ');
    if (!text.startsWith('随机')) return '';
    if (text.startsWith('随机点歌')) {
      return stripRandomScopePrefix(text.slice('随机点歌'.length));
    }
    if (text.startsWith('随机 ')) {
      return stripRandomScopePrefix(text.slice('随机 '.length));
    }
    const scope = stripRandomScopePrefix(text.slice('随机'.length));
    return scope === '点歌' ? '' : scope;
  }

  function stripRandomScopePrefix(val) {
    let text = String(val || '').trim();
    while (text && '+＋:：-—'.includes(text[0])) {
      text = text.slice(1).trim();
    }
    return text;
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.queue = {
    initQueueForm,
    renderState,
    renderSuperChatQueue,
    applyAdminQueueFontPreview,
    queueAction,
    superChatAction,
    requesterLabel,
    sourceLabel
  };
})();
