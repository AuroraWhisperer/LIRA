// 队列和 SuperChat 的交互与展示。
'use strict';

import {
  copyText,
  value,
  withMultilingualFallback,
  toast,
  showError,
  api,
  dangerConfirm,
} from '../shared/utils.js';
import { escapeHtml, escapeAttr } from '../shared/html-escape.js';
import { formatTime, formatSuperChatPrice } from '../shared/display-format.js';
import { stateService } from './state.js';

const QUEUE_BOTTOM_HOLD_MS = 750;
const QUEUE_WHEEL_GESTURE_GAP_MS = 180;

let superChatUndo = null;
let superChatUndoTimer = null;
let superChatUndoHideTimer = null;
let superChatActions = Promise.resolve();
let superChatUndoRevision = 0;
let queueHeadId = null;

function initQueueForm() {
  document.getElementById('superChatUndoBtn')?.addEventListener('click', () => {
    if (!superChatUndo) return;
    const token = superChatUndo.token;
    enqueueSuperChatAction(async () => {
      try {
        await api('/api/superchats/undo', { token }, { notifyError: false });
        clearSuperChatUndo();
        await stateService.reloadState();
      } catch (error) {
        if (error.status === 409 || error.statusCode === 409 || error.code === 'SUPERCHAT_UNDO_EXPIRED') clearSuperChatUndo();
        throw error;
      }
    });
  });
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
  const nextButton = document.getElementById('nextBtn');
  nextButton.addEventListener('click', async () => {
    if (nextButton.disabled || queueHeadId === null) return;
    nextButton.disabled = true;
    try {
      await api('/api/queue/action', { action: 'done', id: queueHeadId }, { notifyError: false });
      await stateService.reloadState();
    } catch (error) {
      showError(error);
    } finally {
      nextButton.disabled = false;
    }
  });
  document.getElementById('clearBtn').addEventListener('click', async () => {
    const confirmed = await dangerConfirm({
      title: '清空点歌队列',
      message: '点歌队列中的全部歌曲都会被移除，此操作不可撤销。',
      deletes: ['点歌队首歌曲', '全部等待点歌'],
      confirmLabel: '清空点歌队列',
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

  // 触底后缓冲当前滚动；停顿后的新手势可以提前交给页面。
  function bindQueueWheel(list) {
    if (!list) return;
    const panel = list.closest('.queue-panel') || list;
    let bottomReleaseAt = null;
    let lastWheelAt = null;
    panel.addEventListener(
      'wheel',
      (event) => {
        const delta = normalizedWheelDelta(event, list);
        if (delta === 0) return;
        const now = event.timeStamp;
        const newGesture = lastWheelAt !== null && now - lastWheelAt >= QUEUE_WHEEL_GESTURE_GAP_MS;
        lastWheelAt = now;
        const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
        if (delta > 0 && maxScrollTop > 0 && list.scrollTop >= maxScrollTop) {
          if (bottomReleaseAt === null) bottomReleaseAt = now + QUEUE_BOTTOM_HOLD_MS;
          else if (newGesture) bottomReleaseAt = now;
          if (now < bottomReleaseAt) event.preventDefault();
          return;
        }

        bottomReleaseAt = null;
        const canScroll =
          maxScrollTop > 0 && (delta < 0 ? list.scrollTop > 0 : delta > 0 && list.scrollTop < maxScrollTop);
        if (!canScroll) return;

        event.preventDefault();
        list.scrollTop += delta * 0.3;
        if (delta > 0 && list.scrollTop >= maxScrollTop) bottomReleaseAt = now + QUEUE_BOTTOM_HOLD_MS;
      },
      { passive: false },
    );
  }

  bindQueueWheel(document.getElementById('superChatList'));
  bindQueueWheel(document.getElementById('queueList'));
}

function renderState(appState) {
  if (!appState) return;
  renderQueueState(appState.queue, appState.settings);
  renderSuperChatQueue(appState.superChats || []);
  applyAdminQueueFontPreview(appState.settings || {});
}

function renderQueueState(queue = {}, settings = {}) {
  const queueItems = [queue.current, ...(queue.waiting || [])].filter(Boolean);
  queueHeadId = queueItems[0]?.id ?? null;
  document.getElementById('queueSize').textContent = `${queueItems.length} 首`;
  const list = document.getElementById('queueList');
  if (queueItems.length === 0) {
    const paused = settings.paused === true || settings.paused === 'true';
    const monitoringOff = settings.danmakuMonitoringEnabled === false || settings.danmakuMonitoringEnabled === 'false';
    const hint = monitoringOff ? '弹幕监控已关闭，暂不接收观众点歌'
      : paused ? '点歌已暂停，恢复后可接收观众点歌' : '观众点歌后，会按顺序出现在这里';
    list.innerHTML = `
      <div class="empty queue-empty">
        <div class="empty-icon" aria-hidden="true"><img class="empty-queue-image" src="/img/admin/queue/admin-queue-song.webp" alt="" draggable="false"></div>
        <div class="empty-text">暂无点歌</div>
        <div class="empty-hint">${hint}</div>
      </div>
    `;
  } else {
    list.innerHTML = queueItems
      .map((item, index) => {
        const liveButton = index === 0
          ? `<button class="queue-live-button" type="button" aria-pressed="${Boolean(item.is_live)}" title="${item.is_live ? '取消 LIVE，恢复排队顺序' : '标记 LIVE，准备唱或正在唱，保留第 1 位'}" aria-label="${item.is_live ? '取消 LIVE' : '标记 LIVE'}" data-action="${item.is_live ? 'unlive' : 'live'}" data-id="${item.id}">LIVE</button>`
          : '';
        const pinButton =
          index === 0 && !item.is_pinned
            ? ''
            : `
              <button class="icon" title="${item.is_pinned ? '取消置顶' : '置顶'}" type="button" data-action="${item.is_pinned ? 'unpin' : 'pin'}" data-id="${item.id}">${item.is_pinned ? '↧' : '↑'}</button>`;

        // 根据歌曲名长度决定字体大小
        const pinMark = item.is_pinned
          ? '<svg class="queue-pin-icon" aria-hidden="true"><use href="/img/admin/workbench-icons.svg#pin"></use></svg>'
          : '';
        const songText = `${pinMark}${index + 1}. ${escapeHtml(item.song_name)}`;
        const textLength = (item.song_name || '').length;
        let lengthAttr = '';
        if (textLength > 35) {
          lengthAttr = ' data-length="very-long"';
        } else if (textLength > 20) {
          lengthAttr = ' data-length="long"';
        }

        return `
          <div class="queue-row${item.is_live ? ' is-live' : ''}">
            <div>
              <div class="song"${lengthAttr}>${songText}</div>
              <div class="meta">${escapeHtml(requesterLabel(item))} · ${escapeHtml(sourceLabel(item))} · ${formatTime(item.created_at)}</div>
            </div>
            <div class="queue-actions">
              ${liveButton}
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
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await queueAction(button.dataset.action, button.dataset.id);
      } catch (error) {
        if (error.code === 'QUEUE_LIVE_NOT_FIRST') await stateService.reloadState();
      } finally {
        button.disabled = false;
      }
    });
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
    button.addEventListener('click', () => superChatAction(button.dataset.scAction, button.dataset.id));
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
  const fontFamily = settings.overlayFontFamily || value('overlayFontFamily') || 'Microsoft YaHei';
  const fontWeight = settings.overlayFontWeight || value('overlayFontWeight') || '700';
  list.style.setProperty('--admin-queue-font-family', withMultilingualFallback(fontFamily));
  list.style.setProperty('--admin-queue-font-weight', fontWeight);
}

async function queueAction(action, id) {
  console.log('[queueAction]', action, id);
  const result = await api('/api/queue/action', { action, id });
  console.log('[queueAction] result:', result);
  await stateService.reloadState();
}

async function superChatAction(action, id) {
  return enqueueSuperChatAction(async () => {
    if (action === 'delete') {
      const revision = superChatUndoRevision;
      const response = await api('/api/superchats/delete', { id }, { notifyError: false });
      if (revision === superChatUndoRevision) showSuperChatUndo(response.undo);
    } else {
      await api('/api/superchats/action', { action, id }, { notifyError: false });
    }
    await stateService.reloadState();
  });
}

function enqueueSuperChatAction(action) {
  superChatActions = superChatActions.then(async () => {
    const button = document.getElementById('superChatUndoBtn');
    if (button) button.disabled = true;
    try { await action(); }
    catch (error) { showError(error); }
    finally { if (button) button.disabled = !superChatUndo; }
  });
  return superChatActions;
}

function showSuperChatUndo(undo) {
  if (!undo || undo.expiresAt <= Date.now()) { clearSuperChatUndo(); return; }
  clearTimeout(superChatUndoTimer);
  clearTimeout(superChatUndoHideTimer);
  superChatUndoHideTimer = null;
  superChatUndo = undo;
  const panel = document.getElementById('superChatUndo');
  const message = document.getElementById('superChatUndoMessage');
  if (message) message.textContent = `已删除 ${undo.count} 条 SC`;
  if (panel) {
    panel.hidden = false;
    panel.classList.remove('is-leaving');
  }
  superChatUndoTimer = setTimeout(expireSuperChatUndo, undo.expiresAt - Date.now());
}

export function clearSuperChatUndo() {
  superChatUndoRevision += 1;
  expireSuperChatUndo();
}

function expireSuperChatUndo() {
  clearTimeout(superChatUndoTimer);
  superChatUndoTimer = null;
  superChatUndo = null;
  const panel = document.getElementById('superChatUndo');
  const button = document.getElementById('superChatUndoBtn');
  if (button) button.disabled = true;
  clearTimeout(superChatUndoHideTimer);
  if (!panel || panel.hidden) return;
  panel.classList.add('is-leaving');
  superChatUndoHideTimer = setTimeout(() => {
    panel.hidden = true;
    panel.classList.remove('is-leaving');
    superChatUndoHideTimer = null;
  }, 1000);
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

export { initQueueForm, renderState, renderQueueState, renderSuperChatQueue, applyAdminQueueFontPreview };
