'use strict';

import { createBlessingEditor, createCustomReplyEditor, createFortuneEditor } from './danmaku-libraries.js';

let initialized = false;
let refreshState = null;

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

  refreshState = async () => {
    elements.refreshButton.disabled = true;
    try {
      const response = await fetch('/api/bilibili/danmaku/state');
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '获取发送状态失败');
      renderState(elements, payload.data || {}, { blessingEditor, fortuneEditor, customReplyEditor });
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
  refreshState();
}

function getElements() {
  const elements = {
    form: document.getElementById('danmakuSendForm'),
    message: document.getElementById('danmakuMessage'),
    counter: document.getElementById('danmakuCounter'),
    sendButton: document.getElementById('danmakuSendBtn'),
    replyTarget: document.getElementById('danmakuReplyTarget'),
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
  const requester = state.requester || {};
  elements.accountState.textContent = state.loggedIn ? (state.accountName || `UID ${state.accountUid || '-'}`) : '未登录';
  elements.accountState.title = state.loggedIn && state.accountUid ? `UID ${state.accountUid}` : '';
  elements.roomState.textContent = state.roomId ? (state.roomName || `房间 ${state.roomId}`) : '未设置';
  elements.roomState.title = state.roomId ? `房间 ${state.roomId}` : '';
  elements.replyTarget.textContent = requester.name
    ? `${requester.name}${requester.uid ? `（UID ${requester.uid}）` : ''}`
    : '暂无可回复的点歌记录';
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
  elements.status.className = state.canSend ? 'good' : 'warn';
  elements.sendButton.disabled = !state.canSend;
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

function refresh() {
  return refreshState ? refreshState() : Promise.resolve();
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.danmakuTool = { init, refresh };
