'use strict';
import { toast as defaultToast } from '../shared/utils.js';
import { readApiResponse } from '../shared/json-response.js';
import { publishDanmakuTool } from './legacy-admin-bridge.js';

import { createCustomReplyEditor } from './danmaku-libraries.js';
import { initDanmakuDailyBots } from './danmaku-daily-bots.js';
import { initDanmakuOverlaySettings } from './danmaku-overlay-settings.js';
import { initDanmakuOverlayFilters } from './danmaku-overlay-filters.js';
import { initDanmakuWelcome } from './danmaku-welcome.js';
import { initDanmakuPkReport } from './danmaku-pk-report.js';
import { initFixedReplyEditor } from './danmaku-fixed-replies.js';
import { initDanmakuCloudReplies } from './danmaku-cloud-replies.js';
import { initDanmakuQueryReplies } from './danmaku-query-replies.js';
import { initGiftInteractionControls } from './gifts/interaction-controls.js';
import { isLiveStatusDegraded } from './live-status-presentation.js';

let initialized = false;
let refreshState = null;
let autoBotRunning = false;
let autoBotController = null;
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
  initDanmakuQueryReplies();
  initGiftInteractionControls({ surface: 'danmaku', notify: toast });
  document.getElementById('dailyBotRefresh')?.addEventListener('click', () => {
    void welcome?.refresh();
    void pk?.refresh();
    void cloudReplies?.refresh();
  });
  initFixedReplyEditor();
  initialized = true;

  const updateCounter = () => {
    elements.counter.textContent = `${Array.from(elements.message.value).length} 字`;
  };
  const setResult = (text, kind = '') => {
    elements.resultState.textContent = text;
    elements.resultState.className = `danmaku-send-result${kind ? ` ${kind}` : ''}`;
  };

  refreshState = async ({ reconnectIfDisconnected = false } = {}) => {
    elements.refreshButton.disabled = true;
    try {
      const response = await fetch('/api/bilibili/danmaku/state');
      const payload = await readApiResponse(response, '获取发送状态失败');
      let state = payload.data || {};
      const monitoringEnabled = document.getElementById('danmakuMonitoringEnabled')?.checked;
      if (reconnectIfDisconnected && !state.connected && state.roomId && monitoringEnabled !== false) {
        await reconnectBilibili?.({ silent: true });
        const refreshedResponse = await fetch('/api/bilibili/danmaku/state');
        const refreshedPayload = await readApiResponse(refreshedResponse, '获取刷新后的发送状态失败');
        state = refreshedPayload.data || {};
      }
      renderState(elements, state, {
        customReplyEditor,
      });
    } catch (error) {
      elements.accountState.textContent = '状态未知';
      elements.roomState.textContent = '状态未知';
      elements.status.textContent = error.message || '无法获取发送状态';
      elements.status.className = 'warn';
      elements.sendButton.disabled = true;
    } finally {
      elements.refreshButton.disabled = false;
    }
  };

  elements.message.addEventListener('input', updateCounter);
  elements.message.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.ctrlKey) elements.form.requestSubmit();
  });
  document.addEventListener('app:bilibili-auth-changed', () => refreshState());
  elements.refreshButton.addEventListener('click', refreshState);
  bindSettingToggle(elements.replyToggle, {
    key: 'enableRandomTagReply',
    onText: '点歌自动回复已开启',
    offText: '点歌自动回复已关闭',
    saveSetting,
    toast,
  });
  bindSettingToggle(elements.customReplyToggle, {
    key: 'enableCustomReplyBot',
    onText: '关键词回复已开启',
    offText: '关键词回复已关闭',
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
      toast(
        count > 1
          ? `弹幕已拆成 ${count} 条发送`
          : payload.data?.replyUname
            ? `弹幕已发送并 @${payload.data.replyUname}`
            : '弹幕已发送',
      );
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
      const queue = [...Array(10).fill('钓鱼'), ...Array(5).fill('打劫')];
      toast(`开始自动发送：钓鱼 ×10、打劫 ×5，每 5 秒一条（共 ${queue.length} 条）`);
      for (let index = 0; index < queue.length; index += 1) {
        if (controller.signal.aborted) break;
        const message = queue[index];
        setResult(`自动发送中 ${index + 1}/${queue.length}：${message}`);
        const sendResponse = await fetch('/api/bilibili/danmaku/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        const sendPayload = await sendResponse.json();
        if (!sendResponse.ok || !sendPayload.ok) throw new Error(sendPayload.error || '发送弹幕失败');
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
    roomState: document.getElementById('danmakuRoomState'),
    refreshButton: document.getElementById('danmakuRefreshBtn'),
    overlayUrl: document.getElementById('danmakuOverlayUrl'),
    openOverlayButton: document.getElementById('danmakuOpenOverlayBtn'),
    previewOverlayButton: document.getElementById('danmakuPreviewOverlayBtn'),
    styleChip: document.getElementById('danmakuStyleChip'),
    styleSaveState: document.getElementById('danmakuStyleSaveState'),
    fullscreenDurationField: document.getElementById('danmakuFullscreenDurationField'),
    fullscreenDuration: document.getElementById('danmakuFullscreenDurationSeconds'),
    resultState: document.getElementById('danmakuSendResult'),
  };
  elements.styleButtons = Array.from(document.querySelectorAll('[data-danmaku-style]'));
  return Object.values(elements).some((element) => !element) || elements.styleButtons.length === 0 ? null : elements;
}

function renderState(elements, state, editors) {
  elements.accountState.textContent = state.loggedIn ? state.accountName || `UID ${state.accountUid || '-'}` : '未登录';
  elements.accountState.title = state.loggedIn && state.accountUid ? `UID ${state.accountUid}` : '';
  elements.roomState.textContent = state.roomId ? state.roomName || `房间 ${state.roomId}` : '未设置';
  elements.roomState.title = state.roomId ? `房间 ${state.roomId}` : '';
  elements.replyToggle.checked = state.autoReplyEnabled === true;
  elements.replyToggle.disabled = !state.canSend;
  elements.customReplyToggle.checked = state.customReplyBotEnabled === true;
  elements.customReplyToggle.disabled = !state.canSend;
  editors.customReplyEditor.load(state.customReplyRules);
  const degraded = state.connected && isLiveStatusDegraded({ message: state.liveMessage });
  elements.status.textContent = state.canSend
    ? degraded
      ? '可发送，弹幕可能延迟'
      : state.connected
        ? '可发送，监听已连接'
        : '可发送，监听未连接'
    : state.unavailableReason;
  elements.status.className = state.canSend && !degraded
    ? (state.connected ? 'connection-good' : 'connection-bad') : 'warn';
  elements.sendButton.disabled = !state.canSend;
  elements.autoButton.disabled = !autoBotRunning && !state.canSend;
}

function bindSettingToggle(element, options) {
  element.addEventListener('change', async () => {
    const enabled = element.checked ? 'true' : 'false';
    try {
      await options.saveSetting(options.key, enabled);
      options.toast(enabled === 'true' ? options.onText : options.offText);
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
publishDanmakuTool(danmakuTool);
