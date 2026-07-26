// 编写人：Aurora
// 播放助手状态管理 + MediaSession。挂载到 window.AdminApp.playback
'use strict';

(function () {
  const U = window.AdminApp.utils;

  const playbackStorageKey = 'songAssistantPlaybackState:v1';

  function savePlaybackState(state) {
    try { localStorage.setItem(playbackStorageKey, JSON.stringify(state)); } catch (_) { /* best effort */ }
  }

  function restorePlaybackState() {
    try {
      const raw = localStorage.getItem(playbackStorageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function formatPlaybackTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }

  function formatPlaybackTrackMeta(track) {
    const artists = Array.isArray(track.artists) && track.artists.length
      ? track.artists.join(' / ') : '未知歌手';
    const parts = [artists, track.album || '', formatPlaybackTime((track.durationMs || 0) / 1000)].filter(Boolean);
    if (track.vip) parts.push('VIP');
    return parts.join(' · ');
  }

  function playbackHomeActionTitle(action) {
    return {
      personalized:'推荐歌单', daily:'每日推荐', radio:'心动 / 电台', liked:'我喜欢',
      'created-playlists':'我的歌单', 'collected-playlists':'收藏歌单',
      recent:'最近播放', 'playlist-tracks':'歌单歌曲'
    }[action] || '音乐内容';
  }

  function selectedPlaybackSourceName(source) {
    return source === 'netease' ? '网易云音乐' : 'QQ音乐';
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.playback = {
    playbackStorageKey, savePlaybackState, restorePlaybackState,
    formatPlaybackTime, formatPlaybackTrackMeta, playbackHomeActionTitle,
    selectedPlaybackSourceName
  };
})();
