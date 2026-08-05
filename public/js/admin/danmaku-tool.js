'use strict';

(function () {
  let initialized = false;
  let refreshState = null;
  let blessings = [];
  let blessingsDirty = false;

  function init() {
    const form = document.getElementById('danmakuSendForm');
    const message = document.getElementById('danmakuMessage');
    const counter = document.getElementById('danmakuCounter');
    const sendButton = document.getElementById('danmakuSendBtn');
    const target = document.getElementById('danmakuReplyTarget');
    const toggle = document.getElementById('danmakuReplyToggle');
    const checkinToggle = document.getElementById('danmakuCheckinToggle');
    const status = document.getElementById('danmakuToolStatus');
    const accountState = document.getElementById('danmakuAccountState');
    const roomState = document.getElementById('danmakuRoomState');
    const refreshButton = document.getElementById('danmakuRefreshBtn');
    const resultState = document.getElementById('danmakuSendResult');
    const blessingList = document.getElementById('danmakuBlessingList');
    const blessingCount = document.getElementById('danmakuBlessingCount');
    const blessingInput = document.getElementById('danmakuBlessingInput');
    const blessingAddButton = document.getElementById('danmakuBlessingAddBtn');
    const blessingSaveButton = document.getElementById('danmakuBlessingSaveBtn');
    const blessingStatus = document.getElementById('danmakuBlessingStatus');
    if (
      initialized || !form || !message || !toggle || !checkinToggle || !blessingList
      || !blessingInput || !blessingAddButton || !blessingSaveButton
      || typeof form.addEventListener !== 'function'
    ) return;
    initialized = true;

    const toast = window.AdminApp?.utils?.toast || (() => {});
    const updateCounter = () => { counter.textContent = `${Array.from(message.value).length} 字`; };
    const setResult = (text, kind = '') => {
      resultState.textContent = text;
      resultState.className = `danmaku-send-result${kind ? ` ${kind}` : ''}`;
    };
    const setBlessingStatus = (text, kind = '') => {
      blessingStatus.textContent = text;
      blessingStatus.className = `hint${kind ? ` ${kind}` : ''}`;
    };
    const markBlessingsDirty = () => {
      blessingsDirty = true;
      blessingSaveButton.disabled = false;
      setBlessingStatus('有尚未保存的更改', 'warn');
    };
    const renderBlessings = () => {
      blessingList.replaceChildren();
      blessingCount.textContent = `${blessings.length} 条`;
      if (blessings.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'danmaku-blessing-empty';
        empty.textContent = '还没有祝福语';
        blessingList.appendChild(empty);
        return;
      }

      blessings.forEach((text, index) => {
        const row = document.createElement('div');
        row.className = 'danmaku-blessing-row';

        const number = document.createElement('span');
        number.className = 'danmaku-blessing-index';
        number.textContent = String(index + 1).padStart(2, '0');

        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 60;
        input.value = text;
        input.setAttribute('aria-label', `第 ${index + 1} 条祝福语`);
        input.addEventListener('input', () => {
          blessings[index] = input.value;
          markBlessingsDirty();
        });

        const deleteButton = document.createElement('button');
        deleteButton.className = 'danmaku-blessing-delete';
        deleteButton.type = 'button';
        deleteButton.title = '删除祝福语';
        deleteButton.setAttribute('aria-label', `删除第 ${index + 1} 条祝福语`);
        deleteButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        deleteButton.addEventListener('click', () => {
          blessings.splice(index, 1);
          renderBlessings();
          markBlessingsDirty();
        });

        row.append(number, input, deleteButton);
        blessingList.appendChild(row);
      });
    };
    const loadBlessings = (rawValue) => {
      if (blessingsDirty) return;
      try {
        const parsed = JSON.parse(String(rawValue || '[]'));
        blessings = Array.isArray(parsed)
          ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
      } catch (_) {
        blessings = [];
      }
      renderBlessings();
      blessingSaveButton.disabled = true;
      setBlessingStatus(`已读取 ${blessings.length} 条`, 'good');
    };
    const addBlessing = () => {
      const text = blessingInput.value.trim();
      if (!text) {
        toast('请输入祝福语');
        blessingInput.focus();
        return;
      }
      blessings.push(text);
      blessingInput.value = '';
      renderBlessings();
      markBlessingsDirty();
      blessingList.lastElementChild?.querySelector('input')?.focus();
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
          : '暂无可回复的点歌记录';
        toggle.disabled = !requester.name;
        toggle.checked = state.autoReplyEnabled === true;
        toggle.disabled = !state.canSend;
        checkinToggle.checked = state.checkinBotEnabled === true;
        checkinToggle.disabled = !state.canSend;
        loadBlessings(state.checkinBlessings);
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
    blessingAddButton.addEventListener('click', addBlessing);
    blessingInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addBlessing();
    });
    blessingSaveButton.addEventListener('click', async () => {
      const cleaned = blessings.map((item) => item.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        toast('请至少保留一条祝福语');
        setBlessingStatus('至少需要一条祝福语', 'warn');
        return;
      }

      blessingSaveButton.disabled = true;
      setBlessingStatus('正在保存');
      try {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkinBlessings: JSON.stringify(cleaned) })
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || '保存祝福语失败');
        blessings = cleaned;
        blessingsDirty = false;
        renderBlessings();
        setBlessingStatus(`已保存 ${blessings.length} 条`, 'good');
        toast('签到祝福语已保存');
      } catch (error) {
        blessingSaveButton.disabled = false;
        setBlessingStatus('保存失败', 'warn');
        toast(error.message || '保存祝福语失败');
      }
    });
    bindSettingToggle(toggle, {
      key: 'enableRandomTagReply',
      onText: '随机点歌自动回复已开启',
      offText: '随机点歌自动回复已关闭'
    });
    bindSettingToggle(checkinToggle, {
      key: 'enableCheckinBot',
      onText: '签到机器人已开启',
      offText: '签到机器人已关闭'
    });
    function bindSettingToggle(element, options) {
      element.addEventListener('change', async () => {
        const enabled = element.checked ? 'true' : 'false';
        try {
          const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [options.key]: enabled })
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.error || '保存设置失败');
          toast(enabled === 'true' ? options.onText : options.offText);
        } catch (error) {
          element.checked = !element.checked;
          toast(error.message || '保存设置失败');
        }
      });
    }
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
