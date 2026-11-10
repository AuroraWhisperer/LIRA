// 点歌队列的交互与展示。
'use strict';

import {
  value,
  toast,
  showError,
  api,
  dangerConfirm,
} from '../shared/utils.js';
import { escapeHtml, escapeAttr } from '../shared/html-escape.js';
import { withMultilingualFallback } from '../shared/font-family.js';
import { formatTime } from '../shared/display-format.js';
import { stateService } from './state.js';
import { bindQueueCopyButtons, bindQueueWheel } from './queue-list-view.js';

let queueHeadId = null;
const queueRenderSignatures = new WeakMap();

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

  bindQueueWheel(document.getElementById('queueList'));
}

function renderQueueState(queue = {}, settings = {}) {
  const queueItems = [queue.current, ...(queue.waiting || [])].filter(Boolean);
  queueHeadId = queueItems[0]?.id ?? null;
  const list = document.getElementById('queueList');
  const signature = JSON.stringify([queueItems, queueItems.length ? null : [settings.paused, settings.danmakuMonitoringEnabled]]);
  if (queueRenderSignatures.get(list) === signature) return;
  document.getElementById('queueSize').textContent = `${queueItems.length} 首`;
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
  queueRenderSignatures.set(list, signature);
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

export { initQueueForm, renderQueueState, applyAdminQueueFontPreview };
