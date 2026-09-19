'use strict';

import { bilibiliAvatarSource } from './settings-auth.js';

export function createBilibiliRoomProfile({ documentRef, fetchRef, apiToken }) {
  const input = documentRef.getElementById('roomId');
  const status = documentRef.getElementById('bilibiliRoomStatus');
  const avatar = documentRef.getElementById('bilibiliRoomAvatar');
  const name = documentRef.getElementById('bilibiliRoomName');
  let savedRoomId;
  let requestVersion = 0;

  function clearAvatar() {
    avatar.hidden = true;
    avatar.alt = '';
    avatar.removeAttribute('src');
  }

  function render(statusText, statusClass, displayName) {
    status.textContent = statusText;
    status.className = `pill ${statusClass}`;
    name.textContent = displayName;
    name.title = displayName;
    clearAvatar();
  }

  async function refresh(roomId, force = false) {
    const nextRoomId = String(roomId || '').trim();
    if (!force && nextRoomId === savedRoomId) return;
    savedRoomId = nextRoomId;
    const version = ++requestVersion;
    if (!savedRoomId) {
      render('未设置', 'warn', '填写直播间号后保存设置');
      return;
    }
    render('已设置', 'good', '正在读取房主资料…');
    try {
      const response = await fetchRef('/api/bilibili/room/profile', {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('Room profile unavailable');
      if (version !== requestVersion) return;
      const profile = result.data;
      render(
        '已设置',
        'good',
        profile.name || '暂未获取到房主昵称',
      );
      const source = bilibiliAvatarSource(profile.avatarUrl, apiToken);
      if (source) {
        avatar.src = source;
        avatar.alt = profile.name ? `${profile.name}的头像` : '房主头像';
        avatar.hidden = false;
      }
    } catch (_) {
      if (version !== requestVersion) return;
      render('读取失败', 'warn', '请检查房间号并重新保存设置');
    }
  }

  input.addEventListener('input', () => {
    if (input.value.trim() === savedRoomId) {
      void refresh(savedRoomId, true);
      return;
    }
    requestVersion += 1;
    render('待保存', 'warn', '保存设置后显示房主资料');
  });
  avatar.addEventListener('error', clearAvatar);

  return { refresh };
}
