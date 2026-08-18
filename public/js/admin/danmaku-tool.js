'use strict';

import { createBlessingEditor, createCustomReplyEditor, createFortuneEditor } from './danmaku-libraries.js';

let initialized = false;
let refreshState = null;
let autoBotRunning = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function init() {
  const elements = getElements();
  if (initialized || !elements) return;

  const toast = window.AdminApp?.utils?.toast || (() => {});
  const saveSetting = async (key, value) => {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || '保存设置失败');
    return payload.data;
  };
  const blessingEditor = createBlessingEditor({ document, saveSetting, toast });
  const fortuneEditor = createFortuneEditor({ document, saveSetting, toast });
  const customReplyEditor = createCustomReplyEditor({ document, saveSetting, toast });
  if (!blessingEditor || !fortuneEditor || !customReplyEditor) return;
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
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '获取发送状态失败');
      let state = payload.data || {};
      if (reconnectIfDisconnected && !state.connected) {
        await window.AdminApp.settings?.reconnectBilibili?.();
        const refreshedResponse = await fetch('/api/bilibili/danmaku/state');
        const refreshedPayload = await refreshedResponse.json();
        if (!refreshedResponse.ok || !refreshedPayload.ok) {
          throw new Error(refreshedPayload.error || '获取刷新后的发送状态失败');
        }
        state = refreshedPayload.data || {};
      }
      renderState(elements, state, { blessingEditor, fortuneEditor, customReplyEditor });
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
    onText: '随机点歌自动回复已开启',
    offText: '随机点歌自动回复已关闭',
    saveSetting,
    toast
  });
  bindSettingToggle(elements.checkinToggle, {
    key: 'enableCheckinBot',
    onText: '签到机器人已开启',
    offText: '签到机器人已关闭',
    saveSetting,
    toast
  });
  bindSettingToggle(elements.fortuneToggle, {
    key: 'enableFortuneBot',
    onText: '抽签机器人已开启',
    offText: '抽签机器人已关闭',
    saveSetting,
    toast
  });
  bindSettingToggle(elements.customReplyToggle, {
    key: 'enableCustomReplyBot',
    onText: 'DIY 关键词回复已开启',
    offText: 'DIY 关键词回复已关闭',
    saveSetting,
    toast
  });
  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = elements.message.value.trim();
    if (!text) return;
    elements.sendButton.disabled = true;
    setResult('正在发送...');
    try {
      const response = await fetch('/api/bilibili/danmaku/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '发送弹幕失败');
      elements.message.value = '';
      updateCounter();
      const count = Number(payload.data?.count) || 1;
      setResult(count > 1 ? `已拆成 ${count} 条弹幕发送。` : `已发送：${payload.data?.message || text}`, 'good');
      toast(count > 1 ? `弹幕已拆成 ${count} 条发送` : (payload.data?.replyUname ? `弹幕已发送并 @${payload.data.replyUname}` : '弹幕已发送'));
    } catch (error) {
      setResult(error.message || '发送弹幕失败', 'warn');
      toast(error.message || '发送弹幕失败');
    } finally {
      await refreshState();
    }
  });
  elements.autoButton.addEventListener('click', async () => {
    if (autoBotRunning) return;
    autoBotRunning = true;
    elements.autoButton.disabled = true;
    try {
      const response = await fetch('/api/bilibili/danmaku/state');
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '获取发送状态失败');
      const state = payload.data || {};
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
        const message = queue[index];
        setResult(`自动发送中 ${index + 1}/${queue.length}：${message}`);
        const sendResponse = await fetch('/api/bilibili/danmaku/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        const sendPayload = await sendResponse.json();
        if (!sendResponse.ok || !sendPayload.ok) throw new Error(sendPayload.error || '发送弹幕失败');
        if (index < queue.length - 1) await wait(5000);
      }
      setResult('自动发送完成：钓鱼 ×10、打劫 ×5', 'good');
      toast('自动发送完成：钓鱼 ×10、打劫 ×5');
    } catch (error) {
      setResult(error.message || '自动发送失败', 'warn');
      toast(error.message || '自动发送失败');
    } finally {
      autoBotRunning = false;
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
    checkinToggle: document.getElementById('danmakuCheckinToggle'),
    fortuneToggle: document.getElementById('danmakuFortuneToggle'),
    customReplyToggle: document.getElementById('danmakuCustomReplyToggle'),
    status: document.getElementById('danmakuToolStatus'),
    accountState: document.getElementById('danmakuAccountState'),
    roomState: document.getElementById('danmakuRoomState'),
    refreshButton: document.getElementById('danmakuRefreshBtn'),
    resultState: document.getElementById('danmakuSendResult')
  };
  return Object.values(elements).some((element) => !element) ? null : elements;
}

function renderState(elements, state, editors) {
  elements.accountState.textContent = state.loggedIn ? (state.accountName || `UID ${state.accountUid || '-'}`) : '未登录';
  elements.accountState.title = state.loggedIn && state.accountUid ? `UID ${state.accountUid}` : '';
  elements.roomState.textContent = state.roomId ? (state.roomName || `房间 ${state.roomId}`) : '未设置';
  elements.roomState.title = state.roomId ? `房间 ${state.roomId}` : '';
  elements.replyToggle.checked = state.autoReplyEnabled === true;
  elements.replyToggle.disabled = !state.canSend;
  elements.checkinToggle.checked = state.checkinBotEnabled === true;
  elements.checkinToggle.disabled = !state.canSend;
  elements.fortuneToggle.checked = state.fortuneBotEnabled === true;
  elements.fortuneToggle.disabled = !state.canSend;
  elements.customReplyToggle.checked = state.customReplyBotEnabled === true;
  elements.customReplyToggle.disabled = !state.canSend;
  editors.blessingEditor.load(state.checkinBlessings);
  editors.fortuneEditor.load(state.fortunePool);
  editors.customReplyEditor.load(state.customReplyRules);
  elements.status.textContent = state.canSend
    ? (state.connected ? '可发送，监听已连接' : '可发送，监听未连接')
    : state.unavailableReason;
  elements.status.className = state.canSend
    ? (state.connected ? 'connection-good' : 'connection-bad')
    : 'warn';
  elements.sendButton.disabled = !state.canSend;
  elements.autoButton.disabled = autoBotRunning || !state.canSend;
}

function bindSettingToggle(element, options) {
  element.addEventListener('change', async () => {
    const enabled = element.checked ? 'true' : 'false';
    try {
      await options.saveSetting(options.key, enabled);
      options.toast(enabled === 'true' ? options.onText : options.offText);
    } catch (error) {
      element.checked = !element.checked;
      options.toast(error.message || '保存设置失败');
    }
  });
}

function refresh(options) {
  return refreshState ? refreshState(options) : Promise.resolve();
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.danmakuTool = { init, refresh };
