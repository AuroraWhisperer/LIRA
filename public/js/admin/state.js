// 编写人：Aurora
// 全局状态管理和数据加载
'use strict';

(function () {
  const { showError } = window.AdminApp.utils;

  // Global state
  let appState = null;
  let songs = [];
  let categories = [];
  let songReloadTimer = null;
  let shuttingDown = false;
  let songLanguages = new Set();
  let songArtists = new Set();
  let songTags = new Set();

  function connectSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    const status = document.getElementById('wsStatus');

    ws.addEventListener('open', () => {
      status.textContent = '前端实时连接正常';
      status.className = 'pill good';
    });

    ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'snapshot') {
        appState = payload.state;
        if (window.AdminApp.queue && window.AdminApp.queue.renderState) {
          window.AdminApp.queue.renderState(appState, songs);
        }
        scheduleSongReload();
      }
    });

    ws.addEventListener('close', () => {
      if (shuttingDown) {
        status.textContent = '程序已退出';
        status.className = 'pill warn';
        return;
      }
      status.textContent = '前端连接断开，重连中';
      status.className = 'pill warn';
      setTimeout(connectSocket, 1600);
    });
  }

  async function reloadAll() {
    await reloadState();
    await reloadSongs();
  }

  async function reloadState() {
    const response = await fetch('/api/state');
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '读取状态失败');
    appState = payload.data;
    categories = appState.categories || [];
    if (window.AdminApp.queue && window.AdminApp.queue.renderState) {
      window.AdminApp.queue.renderState(appState, songs);
    }
  }

  async function reloadSongs() {
    const { value } = window.AdminApp.utils;
    const params = new URLSearchParams();
    if (value('songSearch')) params.set('query', value('songSearch'));
    if (value('categoryFilter')) params.set('category', value('categoryFilter'));
    if (value('languageFilter')) params.set('language', value('languageFilter'));
    if (value('artistFilter')) params.set('artist', value('artistFilter'));
    if (value('tagFilter')) params.set('tags', value('tagFilter'));
    if (value('enabledFilter') === 'true') params.set('enabledOnly', 'true');

    const response = await fetch(`/api/songs?${params}`);
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || '读取歌库失败');
    songs = payload.data || [];
    await reloadState();
    if (window.AdminApp.songs && window.AdminApp.songs.renderSongs) {
      window.AdminApp.songs.renderSongs(songs, songLanguages, songArtists, songTags);
    }
  }

  function scheduleSongReload() {
    clearTimeout(songReloadTimer);
    songReloadTimer = setTimeout(() => reloadSongs().catch(showError), 240);
  }

  function getAppState() {
    return appState;
  }

  function getSongs() {
    return songs;
  }

  function getCategories() {
    return categories;
  }

  function getSongLanguages() {
    return songLanguages;
  }

  function getSongArtists() {
    return songArtists;
  }

  function setShuttingDown(value) {
    shuttingDown = value;
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.state = {
    connectSocket,
    reloadAll,
    reloadState,
    reloadSongs,
    scheduleSongReload,
    getAppState,
    getSongs,
    getCategories,
    getSongLanguages,
    getSongArtists,
    setShuttingDown
  };
})();
