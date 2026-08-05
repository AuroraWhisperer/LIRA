'use strict';

(function () {
  let initialized = false;
  let refreshState = null;

  function init() {
    const form = document.getElementById('danmakuSendForm');
    const message = document.getElementById('danmakuMessage');
    const counter = document.getElementById('danmakuCounter');
    const sendButton = document.getElementById('danmakuSendBtn');
    const target = document.getElementById('danmakuReplyTarget');
    const toggle = document.getElementById('danmakuReplyToggle');
    const status = document.getElementById('danmakuToolStatus');
    const accountState = document.getElementById('danmakuAccountState');
    const roomState = document.getElementById('danmakuRoomState');
    const refreshButton = document.getElementById('danmakuRefreshBtn');
    const resultState = document.getElementById('danmakuSendResult');
    if (initialized || !form || !message || typeof form.addEventListener !== 'function') return;
    initialized = true;

    const toast = window.AdminApp?.utils?.toast || (() => {});
    const updateCounter = () => { counter.textContent = `${Array.from(message.value).length} 字`; };
    const setResult = (text, kind = '') => {
      resultState.textContent = text;
      resultState.className = `danmaku-send-result${kind ? ` ${kind}` : ''}`;
    };

    refreshState = async () => {
      refreshButton.disabled = true;
      try {
        const response = await fetch('/api/bilibili/danmaku/state');
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || '获取发送状态失败');
        const state = payload.data || {};
        const requester = state.requester || {};
        accountState.textContent = state.loggedIn ? (state.accountName || `UID ${state.accountUid || '-'}`) : '未登录';
        accountState.title = state.loggedIn && state.accountUid ? `UID ${state.accountUid}` : '';
        roomState.textContent = state.roomId ? (state.roomName || `房间 ${state.roomId}`) : '未设置';
        roomState.title = state.roomId ? `房间 ${state.roomId}` : '';
        target.textContent = requester.name
          ? `${requester.name}${requester.uid ? `（UID ${requester.uid}）` : ''}`
          : '暂无最近的随机点歌人';
        toggle.disabled = !requester.name;
        toggle.checked = state.autoReplyEnabled === true;
        toggle.disabled = !state.canSend;
        status.textContent = state.canSend ? (state.connected ? '可发送，监听已连接' : '可发送，监听未连接') : state.unavailableReason;
        status.className = state.canSend ? 'good' : 'warn';
        sendButton.disabled = !state.canSend;
      } catch (error) {
        accountState.textContent = '状态未知';
        roomState.textContent = '状态未知';
        status.textContent = error.message || '无法获取发送状态';
        status.className = 'warn';
        sendButton.disabled = true;
      } finally {
        refreshButton.disabled = false;
      }
    };

    message.addEventListener('input', updateCounter);
    message.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) form.requestSubmit();
    });
    refreshButton.addEventListener('click', refreshState);
    toggle.addEventListener('change', async () => {
      const enabled = toggle.checked ? 'true' : 'false';
      try {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enableRandomTagReply: enabled })
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || '保存设置失败');
        toast(enabled === 'true' ? '随机点歌自动回复已开启' : '随机点歌自动回复已关闭');
      } catch (error) {
        toggle.checked = !toggle.checked;
        toast(error.message || '保存设置失败');
      }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = message.value.trim();
      if (!text) return;
      sendButton.disabled = true;
      setResult('正在发送...');
      try {
        const response = await fetch('/api/bilibili/danmaku/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || '发送弹幕失败');
        message.value = '';
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

  function refresh() {
    return refreshState ? refreshState() : Promise.resolve();
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.danmakuTool = { init, refresh };
})();
