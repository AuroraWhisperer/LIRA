'use strict';
import { toast as defaultToast } from '../shared/utils.js';
import { readApiResponse } from '../shared/json-response.js';
import { bilibiliAvatarSource } from '../shared/bilibili-avatar.js';

import { createCustomReplyEditor } from './danmaku-libraries.js';
import { initDanmakuDailyBots } from './danmaku-daily-bots.js';
import { initDanmakuOverlaySettings } from './danmaku-overlay-settings.js';
import { initDanmakuOverlayFilters } from './danmaku-overlay-filters.js';
import { initDanmakuWelcome } from './danmaku-welcome.js';
import { initDanmakuPkReport } from './danmaku-pk-report.js';
import { initFixedReplyEditor } from './danmaku-fixed-replies.js';
import { initDanmakuTabs } from './danmaku-tabs.js';
import { initDanmakuCloudReplies } from './danmaku-cloud-replies.js';
import { initDanmakuViewerNames } from './danmaku-viewer-names.js';
import { initDanmakuQueryReplies } from './danmaku-query-replies.js';
import { initGiftInteractionControls } from './gifts/interaction-controls.js';
import { initDanmakuGiftThanks } from './danmaku-gift-thanks.js';
import { isLiveStatusDegraded } from './live-status-presentation.js';

let initialized = false;
let refreshState = null;
let autoBotRunning = false;
let autoBotController = null;
let autoBotContext = null;
let dailyBots = null;

const wait = (ms, signal) => new Promise((resolve) => {
  const finish = () => {
    clearTimeout(timer);
    signal.removeEventListener('abort', finish);
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal.addEventListener('abort', finish, { once: true });
  if (signal.aborted) finish();
});

function init({ toast = defaultToast, reconnectBilibili } = {}) {
  dailyBots ||= initDanmakuDailyBots({ toast });
  const elements = getElements();
  if (initialized || !elements) return;

  const saveSetting = async (key, value) => {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    const payload = await readApiResponse(response, '保存设置失败');
    return payload.data;
  };
  const customReplyEditor = createCustomReplyEditor({
    document,
    saveSetting,
    toast,
  });
  if (!customReplyEditor) return;
  initDanmakuOverlaySettings(elements, toast);
  initDanmakuOverlayFilters();
  const welcome = initDanmakuWelcome({ toast });
  const pk = initDanmakuPkReport({ toast });
  const cloudReplies = initDanmakuCloudReplies({ toast });
  const viewerNames = initDanmakuViewerNames();
  initDanmakuQueryReplies();
  const thanks = initDanmakuGiftThanks({ toast });
  initGiftInteractionControls({ notify: toast, onState: thanks?.updateState });
  document.getElementById('dailyBotRefresh')?.addEventListener('click', () => {
    void welcome?.refresh();
    void pk?.refresh();
    void cloudReplies?.refresh();
    void viewerNames?.refresh();
  });
  initDanmakuTabs();
  initFixedReplyEditor();
  bindBridgeAvatar(elements.accountAvatar, elements.accountFallback);
  bindBridgeAvatar(elements.roomAvatar, elements.roomFallback);
  initialized = true;

  const updateCounter = () => {
    elements.counter.textContent = `${Array.from(elements.message.value).length} 字`;
  };
  const setResult = (text, kind = '') => {
    elements.resultState.textContent = text;
    elements.resultState.className = `danmaku-send-result${kind ? ` ${kind}` : ''}`;
  };
  const stopObsoleteBatch = () => {
    if (!autoBotRunning) return;
    autoBotController?.abort();
    setResult('直播账号或房间已变更，已停止剩余自动发送，请确认目标后重试。', 'warn');
  };

  let stateRevision = 0;
  refreshState = async ({ reconnectIfDisconnected = false } = {}) => {
    const revision = ++stateRevision;
    elements.refreshButton.disabled = true;
    try {
      const response = await fetch('/api/bilibili/danmaku/state');
      const payload = await readApiResponse(response, '获取发送状态失败');
      if (revision !== stateRevision) return;
      let state = payload.data || {};
      if (autoBotContext && state.sendSession !== autoBotContext.sendSession) stopObsoleteBatch();
      const monitoringEnabled = document.getElementById('danmakuMonitoringEnabled')?.checked;
      if (reconnectIfDisconnected && !state.connected && state.roomId && monitoringEnabled !== false) {
        await reconnectBilibili?.({ silent: true });
        if (revision !== stateRevision) return;
        const refreshedResponse = await fetch('/api/bilibili/danmaku/state');
        const refreshedPayload = await readApiResponse(refreshedResponse, '获取刷新后的发送状态失败');
        state = refreshedPayload.data || {};
      }
      if (revision !== stateRevision) return;
      renderState(elements, state, {
        customReplyEditor,
      });
    } catch (error) {
      if (revision !== stateRevision) return;
      elements.accountState.textContent = '状态未知';
      elements.roomState.textContent = '状态未知';
      updateBridgeAvatar(elements.accountAvatar, elements.accountFallback, '', { empty: true });
      updateBridgeAvatar(elements.roomAvatar, elements.roomFallback, '', { empty: true });
      elements.status.textContent = error.message || '无法获取发送状态';
      elements.status.className = 'warn';
      elements.sendButton.disabled = true;
    } finally {
      if (revision === stateRevision) elements.refreshButton.disabled = false;
    }
  };

  elements.message.addEventListener('input', updateCounter);
  elements.message.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.ctrlKey) elements.form.requestSubmit();
  });
  document.addEventListener('app:bilibili-auth-changed', () => {
    stopObsoleteBatch();
    void refreshState();
  });
  window.addEventListener('app:settings-state', (event) => {
    if (autoBotContext && event.detail?.roomId !== undefined && String(event.detail.roomId) !== autoBotContext.roomId) {
      stopObsoleteBatch();
    }
  });
  elements.refreshButton.addEventListener('click', refreshState);
  bindSettingToggle(elements.replyToggle, {
    key: 'enableRandomTagReply',
    saveSetting,
    toast,
  });
  bindSettingToggle(elements.customReplyToggle, {
    key: 'enableCustomReplyBot',
    saveSetting,
    toast,
  });
  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const draft = elements.message.value;
    const text = draft.trim();
    if (!text) return;
    elements.sendButton.disabled = true;
    setResult('正在发送...');
    try {
      const response = await fetch('/api/bilibili/danmaku/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const payload = await readApiResponse(response, '发送弹幕失败');
      if (elements.message.value === draft) elements.message.value = '';
      updateCounter();
      const count = Number(payload.data?.count) || 1;
      setResult(count > 1 ? `已拆成 ${count} 条弹幕发送。` : `已发送：${payload.data?.message || text}`, 'good');
      if (count > 1) toast(`弹幕已拆成 ${count} 条发送`);
      else if (payload.data?.replyUname) toast(`弹幕已发送并 @${payload.data.replyUname}`);
    } catch (error) {
      setResult(error.message || '发送弹幕失败', 'warn');
      toast(error.message || '发送弹幕失败', { type: 'error' });
    } finally {
      await refreshState();
    }
  });
  elements.autoButton.addEventListener('click', async () => {
    if (autoBotRunning) {
      autoBotController.abort();
      setResult('已停止后续自动发送；正在发送或已发出的弹幕无法撤回。');
      return;
    }
    autoBotRunning = true;
    const controller = new AbortController();
    autoBotController = controller;
    elements.autoButton.textContent = '停止自动发送';
    elements.autoButton.title = '停止剩余弹幕；已发送的弹幕无法撤回';
    try {
      const response = await fetch('/api/bilibili/danmaku/state');
      const payload = await readApiResponse(response, '获取发送状态失败');
      const state = payload.data || {};
      if (controller.signal.aborted) return;
      if (!state.loggedIn) {
        toast('未登录账号，请先登录后再使用自动发送');
        return;
      }
      if (!state.roomId) {
        toast('未选择直播间，请先配置直播间后再使用自动发送');
        return;
      }
      if (!state.canSend) {
        toast(state.unavailableReason || '当前无法发送弹幕');
        return;
      }
      if (typeof state.sendSession !== 'string' || !state.sendSession) throw new Error('发送会话无效，请刷新后重试。');
      autoBotContext = { sendSession: state.sendSession, roomId: String(state.roomId) };
      const queue = [...Array(10).fill('钓鱼'), ...Array(5).fill('打劫')];
      toast(`开始自动发送：钓鱼 ×10、打劫 ×5，每 5 秒一条（共 ${queue.length} 条）`);
      for (let index = 0; index < queue.length; index += 1) {
        if (controller.signal.aborted) break;
        const message = queue[index];
        setResult(`自动发送中 ${index + 1}/${queue.length}：${message}`);
        const sendResponse = await fetch('/api/bilibili/danmaku/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, sendSession: state.sendSession }),
        });
        await readApiResponse(sendResponse, '发送弹幕失败');
        if (index < queue.length - 1) await wait(5000, controller.signal);
      }
      if (controller.signal.aborted) return;
      setResult('自动发送完成：钓鱼 ×10、打劫 ×5', 'good');
      toast('自动发送完成：钓鱼 ×10、打劫 ×5');
    } catch (error) {
      if (!controller.signal.aborted) {
        setResult(error.message || '自动发送失败', 'warn');
        toast(error.message || '自动发送失败', { type: 'error' });
      }
    } finally {
      autoBotRunning = false;
      autoBotController = null;
      autoBotContext = null;
      elements.autoButton.textContent = '自动钓鱼/打劫（15 条）';
      elements.autoButton.title = '自动发送 钓鱼×10、打劫×5，每 5 秒一条';
      await refreshState();
    }
  });
}

function getElements() {
  const elements = {
    form: document.getElementById('danmakuSendForm'),
    message: document.getElementById('danmakuMessage'),
    counter: document.getElementById('danmakuCounter'),
    sendButton: document.getElementById('danmakuSendBtn'),
    autoButton: document.getElementById('danmakuAutoBtn'),
    replyToggle: document.getElementById('danmakuReplyToggle'),
    customReplyToggle: document.getElementById('danmakuCustomReplyToggle'),
    status: document.getElementById('danmakuToolStatus'),
    accountState: document.getElementById('danmakuAccountState'),
    accountAvatar: document.getElementById('danmakuAccountAvatar'),
    accountFallback: document.getElementById('danmakuAccountFallback'),
    roomState: document.getElementById('danmakuRoomState'),
    roomAvatar: document.getElementById('danmakuRoomAvatar'),
    roomFallback: document.getElementById('danmakuRoomFallback'),
    refreshButton: document.getElementById('danmakuRefreshBtn'),
    previewOverlayButton: document.getElementById('danmakuPreviewOverlayBtn'),
    styleChip: document.getElementById('danmakuStyleChip'),
    styleSaveState: document.getElementById('danmakuStyleSaveState'),
    resultState: document.getElementById('danmakuSendResult'),
  };
  elements.styleButtons = Array.from(document.querySelectorAll('[data-danmaku-style]'));
  return Object.values(elements).some((element) => !element) || elements.styleButtons.length === 0 ? null : elements;
}

function renderState(elements, state, editors) {
  const accountLabel = state.loggedIn ? state.accountName || `UID ${state.accountUid || '-'}` : '未登录';
  const roomLabel = state.roomId ? state.roomName || `房间 ${state.roomId}` : '未设置';
  elements.accountState.textContent = accountLabel;
  elements.accountState.title = state.loggedIn && state.accountUid ? `${accountLabel} · UID ${state.accountUid}` : accountLabel;
  elements.roomState.textContent = roomLabel;
  elements.roomState.title = state.roomId ? `${roomLabel} · 房间 ${state.roomId}` : roomLabel;
  updateBridgeAvatar(elements.accountAvatar, elements.accountFallback, state.accountAvatarUrl, { empty: !state.loggedIn });
  updateBridgeAvatar(elements.roomAvatar, elements.roomFallback, state.roomAvatarUrl, { empty: !state.roomId });
  elements.replyToggle.checked = state.autoReplyEnabled === true;
  elements.customReplyToggle.checked = state.customReplyBotEnabled === true;
  editors.customReplyEditor.load(state.customReplyRules);
  const degraded = state.connected && isLiveStatusDegraded({ message: state.liveMessage });
  elements.status.textContent = state.canSend
    ? degraded
      ? '可发送 · 弹幕可能延迟'
      : state.connected
        ? '可发送 · 监听已连接'
        : '可发送 · 监听未连接'
    : state.unavailableReason;
  elements.status.className = state.canSend && !degraded
    ? (state.connected ? 'connection-good' : 'connection-bad') : 'warn';
  elements.sendButton.disabled = !state.canSend;
  elements.autoButton.disabled = !autoBotRunning && !state.canSend;
}

function bindBridgeAvatar(imgEl, fallbackEl) {
  const reset = () => {
    imgEl.hidden = true;
    imgEl.removeAttribute('src');
    delete imgEl.dataset.loaded;
    fallbackEl.toggleAttribute('hidden', false);
  };
  imgEl.addEventListener('load', () => {
    if (!imgEl.getAttribute('src')) return;
    imgEl.dataset.loaded = 'true';
    fallbackEl.toggleAttribute('hidden', true);
  });
  imgEl.addEventListener('error', reset);
}

function updateBridgeAvatar(imgEl, fallbackEl, avatarUrl, { empty = false } = {}) {
  const frameEl = imgEl.parentElement;
  if (frameEl) frameEl.dataset.empty = empty ? 'true' : 'false';
  const avatarSource = empty ? '' : bilibiliAvatarSource(avatarUrl, window.__API_TOKEN__);
  if (!avatarSource) {
    imgEl.hidden = true;
    imgEl.removeAttribute('src');
    delete imgEl.dataset.loaded;
    fallbackEl.toggleAttribute('hidden', false);
    return;
  }
  if (imgEl.getAttribute('src') === avatarSource) {
    if (imgEl.complete && imgEl.naturalWidth > 0) {
      imgEl.hidden = false;
      imgEl.dataset.loaded = 'true';
      fallbackEl.toggleAttribute('hidden', true);
    }
    return;
  }
  imgEl.hidden = false;
  imgEl.dataset.loaded = 'false';
  fallbackEl.toggleAttribute('hidden', false);
  imgEl.src = avatarSource;
  if (imgEl.complete && imgEl.naturalWidth > 0) {
    imgEl.dataset.loaded = 'true';
    fallbackEl.toggleAttribute('hidden', true);
  }
}

function bindSettingToggle(element, options) {
  element.addEventListener('change', async () => {
    const enabled = element.checked ? 'true' : 'false';
    try {
      await options.saveSetting(options.key, enabled);
    } catch (error) {
      element.checked = !element.checked;
      options.toast(error.message || '保存设置失败', { type: 'error' });
    }
  });
}

function refresh(options) {
  void dailyBots?.refresh();
  return refreshState ? refreshState(options) : Promise.resolve();
}

export const danmakuTool = { init, refresh };
