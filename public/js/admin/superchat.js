import { api, showError } from '../shared/utils.js';
import { escapeHtml, escapeAttr } from '../shared/html-escape.js';
import { formatTime, formatSuperChatPrice } from '../shared/display-format.js';
import { stateService } from './state.js';
import { bindQueueCopyButtons, bindQueueWheel } from './queue-list-view.js';

let superChatUndo = null;
let superChatUndoTimer = null;
let superChatUndoHideTimer = null;
let superChatActions = Promise.resolve();
let superChatUndoRevision = 0;
let lifecycleRevision = 0;
let disposed = false;
let undoButton = null;
let removeWheelListener = null;

export function initSuperChatForm() {
  if (undoButton) return;
  disposed = false;
  undoButton = document.getElementById('superChatUndoBtn');
  undoButton?.addEventListener('click', undoSuperChat);
  removeWheelListener = bindQueueWheel(document.getElementById('superChatList'));
}

function undoSuperChat() {
  if (!superChatUndo) return;
  const token = superChatUndo.token;
  return enqueueSuperChatAction(async (isCurrent) => {
    try {
      await api('/api/superchats/undo', { token }, { notifyError: false });
      if (!isCurrent()) return;
      clearSuperChatUndo();
      await stateService.reloadState();
    } catch (error) {
      if (isCurrent() && (error.status === 409 || error.statusCode === 409 || error.code === 'SUPERCHAT_UNDO_EXPIRED')) clearSuperChatUndo();
      throw error;
    }
  });
}

export function disposeSuperChats() {
  if (disposed) return;
  disposed = true;
  lifecycleRevision += 1;
  superChatUndoRevision += 1;
  clearTimeout(superChatUndoTimer);
  clearTimeout(superChatUndoHideTimer);
  superChatUndoTimer = null;
  superChatUndoHideTimer = null;
  superChatUndo = null;
  superChatActions = Promise.resolve();
  undoButton?.removeEventListener('click', undoSuperChat);
  if (undoButton) undoButton.disabled = true;
  undoButton = null;
  removeWheelListener?.();
  removeWheelListener = null;
  const panel = document.getElementById('superChatUndo');
  if (panel) { panel.hidden = true; panel.classList.remove('is-leaving'); }
}

export function renderSuperChatQueue(items) {
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

async function superChatAction(action, id) {
  return enqueueSuperChatAction(async (isCurrent) => {
    if (action === 'delete') {
      const revision = superChatUndoRevision;
      const response = await api('/api/superchats/delete', { id }, { notifyError: false });
      if (isCurrent() && revision === superChatUndoRevision) showSuperChatUndo(response.undo);
    } else {
      await api('/api/superchats/action', { action, id }, { notifyError: false });
    }
    if (isCurrent()) await stateService.reloadState();
  });
}

function enqueueSuperChatAction(action) {
  const revision = lifecycleRevision;
  const isCurrent = () => !disposed && revision === lifecycleRevision;
  superChatActions = superChatActions.then(async () => {
    if (!isCurrent()) return;
    const button = document.getElementById('superChatUndoBtn');
    if (button) button.disabled = true;
    try { await action(isCurrent); }
    catch (error) { if (isCurrent()) showError(error); }
    finally { if (isCurrent() && button) button.disabled = !superChatUndo; }
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
  if (disposed) return;
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
