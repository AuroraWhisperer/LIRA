// 队列和 SuperChat 的交互与展示。
'use strict';

import {
  copyText,
  escapeHtml,
  escapeAttr,
  value,
  formatTime,
  formatSuperChatPrice,
  withMultilingualFallback,
  toast,
  showError,
  api,
  dangerConfirm,
} from '../shared/utils.js';
import { stateService } from './state.js';
import { publishQueue } from './legacy-admin-bridge.js';

function initQueueForm() {
  const randomButton = document.getElementById('randomSongBtn');
  randomButton.addEventListener('click', async () => {
    if (randomButton.disabled) return;
    randomButton.disabled = true;
    try {
      const result = await api('/api/queue/random', {}, { notifyError: false });
      await stateService.reloadState();
      toast(`已随机点歌：${result.data.song_name}`);
    } catch (error) {
      showError(error);
    } finally {
      randomButton.disabled = false;
    }
  });
  document
    .getElementById('nextBtn')
    .addEventListener('click', () => queueAction('next'));
  document.getElementById('clearBtn').addEventListener('click', async () => {
    const confirmed = await dangerConfirm({
      title: '清空全部队列',
      message: '当前歌曲和所有等待中的歌曲都会被移除，此操作不可撤销。',
      deletes: ['当前播放歌曲', '全部等待队列'],
      confirmLabel: '确认清空队列',
    });
    if (confirmed) await queueAction('clear');
  });

  // 将 wheel 事件的 deltaY 归一化为像素值（Windows 普通鼠标报告行模式 deltaMode=1）
  function normalizedWheelDelta(event, el) {
    switch (event.deltaMode) {
      case 1:
        return event.deltaY * 40; // 行模式：行高约 40px
      case 2:
        return event.deltaY * el.clientHeight; // 页模式：按容器高度换算
      default:
        return event.deltaY; // 像素模式：直接使用
    }
  }

  // Keep wheel input inside an overflowing queue, then let the page scroll at its edges.
  function bindQueueWheel(list) {
    if (!list) return;
    const panel = list.closest('.queue-panel') || list;
    panel.addEventListener(
      'wheel',
      (event) => {
        const delta = normalizedWheelDelta(event, list);
        const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
        const canScroll =
          maxScrollTop > 0 &&
          (delta < 0
            ? list.scrollTop > 0
            : delta > 0 && list.scrollTop < maxScrollTop);
        if (!canScroll) return;

        event.preventDefault();
        list.scrollTop += delta * 0.3;
      },
      { passive: false },
    );
  }

  bindQueueWheel(document.getElementById('superChatList'));
  bindQueueWheel(document.getElementById('queueList'));
}

function renderState(appState) {
  if (!appState) return;
  renderQueueState(appState.queue);
  renderSuperChatQueue(appState.superChats || []);
  applyAdminQueueFontPreview(appState.settings || {});
}

function renderQueueState(queue = {}) {
  const queueItems = [queue.current, ...(queue.waiting || [])].filter(Boolean);
  document.getElementById('queueSize').textContent = `${queueItems.length} 首`;
  const list = document.getElementById('queueList');
  if (queueItems.length === 0) {
    list.innerHTML = `
      <div class="empty queue-empty">
        <div class="empty-icon" aria-hidden="true"><img class="empty-queue-image" src="/img/admin/queue/admin-queue-song.webp" alt="" draggable="false"></div>
        <div class="empty-text">暂无点歌</div>
        <div class="empty-hint">观众点歌后，会按顺序出现在这里</div>
      </div>
    `;
  } else {
    list.innerHTML = queueItems
      .map((item, index) => {
        const pinButton =
          index === 0 && !item.is_pinned
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
      })
      .join('');
  }

  list.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () =>
      queueAction(button.dataset.action, button.dataset.id),
    );
  });
  bindQueueCopyButtons(list, '歌名已复制');
}

function renderSuperChatQueue(items) {
  const list = document.getElementById('superChatList');
  const size = document.getElementById('superChatSize');
  if (!list || !size) return;

  size.textContent = `${items.length} 条`;
  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty sc-empty">
        <div class="empty-icon" aria-hidden="true"><img class="empty-queue-image" src="/img/admin/queue/admin-queue-sc.webp" alt="" draggable="false"></div>
        <div class="empty-text">暂无醒目留言</div>
        <div class="empty-hint">收到醒目留言后，会优先显示在这里</div>
      </div>
    `;
    return;
  }

  list.innerHTML = items
    .map(
      (item, index) => `
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
  `,
    )
    .join('');

  list.querySelectorAll('[data-sc-action]').forEach((button) => {
    button.addEventListener('click', () =>
      superChatAction(button.dataset.scAction, button.dataset.id),
    );
  });
  bindQueueCopyButtons(list, 'SC 已复制');
}

function bindQueueCopyButtons(list, successMessage) {
  list.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await copyText(button.dataset.copy);
        toast(successMessage);
      } catch (_) {
        toast('复制失败，请重试');
      }
    });
  });
}

function applyAdminQueueFontPreview(settings = {}) {
  const list = document.getElementById('queueList');
  if (!list) return;
  const fontFamily =
    settings.overlayFontFamily ||
    value('overlayFontFamily') ||
    'Microsoft YaHei';
  const fontWeight =
    settings.overlayFontWeight || value('overlayFontWeight') || '700';
  list.style.setProperty(
    '--admin-queue-font-family',
    withMultilingualFallback(fontFamily),
  );
  list.style.setProperty('--admin-queue-font-weight', fontWeight);
}

async function queueAction(action, id) {
  console.log('[queueAction]', action, id);
  const result = await api('/api/queue/action', { action, id });
  console.log('[queueAction] result:', result);
  await stateService.reloadState();
}

async function superChatAction(action, id) {
  await api('/api/superchats/action', { action, id });
  await stateService.reloadState();
}

function requesterLabel(item) {
  const name = String((item && item.requester_name) || '').trim();
  if (name) return name;
  const uid = String((item && item.requester_uid) || '').trim();
  return uid ? `观众 ${uid}` : '观众';
}

function sourceLabel(itemOrSource) {
  const item =
    typeof itemOrSource === 'object' && itemOrSource ? itemOrSource : null;
  const source = item ? item.source : itemOrSource;
  if (source === 'random' || String(source || '').startsWith('random:')) {
    const scope = String(source || '').startsWith('random:')
      ? String(source).slice('random:'.length).trim()
      : randomScopeLabel(item && item.request_message);
    return scope ? `随机点歌 · ${scope}` : '随机点歌';
  }
  return (
    {
      admin: '手动',
      danmaku: '弹幕',
      superchat: '醒目留言',
      history: '历史补偿',
    }[source] ||
    source ||
    '未知'
  );
}

function randomScopeLabel(message) {
  const text = String(message || '')
    .trim()
    .replace(/\s+/g, ' ');
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

publishQueue({
  initQueueForm,
  renderState,
  renderSuperChatQueue,
  applyAdminQueueFontPreview,
  queueAction,
  superChatAction,
  requesterLabel,
  sourceLabel,
});

export {
  initQueueForm,
  renderState,
  renderQueueState,
  renderSuperChatQueue,
  applyAdminQueueFontPreview,
};
