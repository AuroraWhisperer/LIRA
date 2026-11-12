'use strict';

import { bilibiliAvatarSource } from '../shared/bilibili-avatar.js';

let currentRoomProfile = null;

export function getBilibiliRoomProfileSnapshot(roomId) {
  const expectedRoomId = String(roomId || '').trim();
  if (!currentRoomProfile || currentRoomProfile.roomId !== expectedRoomId) return null;
  return { ...currentRoomProfile };
}

export function createBilibiliRoomProfile({ documentRef, fetchRef, apiToken, onProfileChange = () => {} }) {
  const input = documentRef.getElementById('roomId');
  const status = documentRef.getElementById('bilibiliRoomStatus');
  const hint = documentRef.getElementById('bilibiliRoomHint');
  const avatar = documentRef.getElementById('bilibiliRoomAvatar');
  const name = documentRef.getElementById('bilibiliRoomName');
  const overview = documentRef.getElementById('bilibiliRoomOverview');
  const refreshButton = documentRef.getElementById('bilibiliRoomRefreshBtn');
  const fields = Object.fromEntries(
    ['Title', 'Level', 'Followers', 'Uid', 'Medal', 'Id', 'LiveStatus', 'Area', 'Announcement']
      .map((field) => [field, documentRef.getElementById(`bilibiliRoom${field}`)]),
  );
  let savedRoomId;
  let requestVersion = 0;

  function clearAvatar() {
    avatar.hidden = true;
    avatar.alt = '';
    avatar.removeAttribute('src');
  }

  function render(statusText, statusClass, hintText, profile = null) {
    status.textContent = statusText;
    status.className = `pill ${statusClass}`;
    hint.textContent = hintText;
    overview.hidden = !profile;
    name.textContent = profile?.name || '';
    name.title = name.textContent;
    clearAvatar();
    currentRoomProfile = null;
    if (profile) {
      name.textContent = profile.name || '暂未获取到房主昵称';
      const source = bilibiliAvatarSource(profile.avatarUrl, apiToken);
      currentRoomProfile = { roomId: savedRoomId, uid: String(profile.uid || ''), name: name.textContent, avatarSource: source };
      fields.Title.textContent = profile.title || '暂未获取到直播标题';
      fields.Title.title = fields.Title.textContent;
      fields.Level.hidden = !Number.isInteger(profile.level);
      fields.Level.textContent = fields.Level.hidden ? '' : `主播 Lv.${profile.level}`;
      fields.Followers.textContent = Number.isInteger(profile.followers) ? profile.followers.toLocaleString('zh-CN') : '—';
      fields.Uid.textContent = profile.uid || '—';
      fields.Medal.textContent = profile.medalName ?? '—';
      if (profile.medalName === '') fields.Medal.textContent = '未开通';
      fields.Id.textContent = profile.roomId;
      fields.LiveStatus.textContent = ({ 0: '未开播', 1: '直播中', 2: '轮播中' })[profile.liveStatus] || '状态未知';
      fields.LiveStatus.className = profile.liveStatus === 1 ? 'pill good' : 'pill';
      fields.Area.textContent = [profile.parentAreaName, profile.areaName].filter(Boolean).join(' / ') || '—';
      fields.Announcement.textContent = profile.announcement === '' ? '暂无公告' : (profile.announcement ?? '暂未获取');
      fields.Announcement.title = fields.Announcement.textContent;
      if (source) {
        avatar.src = source;
        avatar.alt = profile.name ? `${profile.name}的头像` : '房主头像';
        avatar.hidden = false;
      }
    }
    onProfileChange(currentRoomProfile);
  }

  async function refresh(roomId, force = false) {
    const nextRoomId = String(roomId || '').trim();
    if (!force && nextRoomId === savedRoomId) return;
    const keepProfile = nextRoomId === savedRoomId && currentRoomProfile;
    savedRoomId = nextRoomId;
    const version = ++requestVersion;
    refreshButton.disabled = true;
    if (!savedRoomId) {
      render('未设置', 'warn', '填写直播间号后保存设置');
      return;
    }
    if (!keepProfile) render('已设置', 'good', '正在读取房主资料…');
    try {
      const response = await fetchRef('/api/bilibili/room/profile', {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('Room profile unavailable');
      if (version !== requestVersion) return;
      render('已设置', 'good', '', result.data);
    } catch (_) {
      if (version !== requestVersion) return;
      render('读取失败', 'warn', '请检查房间号并重新保存设置');
    } finally {
      if (version === requestVersion) refreshButton.disabled = false;
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
  refreshButton.addEventListener('click', () => refresh(savedRoomId, true));
  avatar.addEventListener('error', () => {
    clearAvatar();
    if (currentRoomProfile) {
      currentRoomProfile = { ...currentRoomProfile, avatarSource: '' };
      onProfileChange(currentRoomProfile);
    }
  });

  return { refresh };
}
