// 编写人：Aurora
// 首页/Drawer 处理模块
'use strict';

import * as PlaybackUtils from '../utils.js';
import { HomeService } from '../services/home-service.js';

/**
 * 创建首页处理模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 首页处理函数集合
 */
export function createHomeHandler(deps) {
  const {
    playbackState,
    homeService,
    uiRenderer,
    escapeHtml,
    toast,
    showError,
    readJsonResponse,
    savePlaybackState,
    renderPlayback,
    renderPlaybackHomeResults
  } = deps;

  // === Drawer 管理 ===
  function openPlaybackDrawer(title, subtitle, loading, loadingHint = '') {
    uiRenderer.getDrawer().open(title, subtitle, loading, loadingHint);
  }

  function closePlaybackDrawer() {
    uiRenderer.getDrawer().close();
    homeService.clearHomeState();
    homeService.clearHistory();
  }

  function playbackDrawerGoBack() {
    const previous = homeService.goBack();
    if (previous) {
      renderPlaybackHomeResults(previous.action, previous.title);
    } else {
      uiRenderer.getDrawer().goBack();
    }
  }

  function updateDrawerActions(showPlayAll, action = '') {
    uiRenderer.getDrawer().updateActions(showPlayAll, action);
  }

  function setPlaybackDrawerLoading(message) {
    uiRenderer.getDrawer().setLoading(message);
  }

  function setPlaybackDrawerError(message) {
    uiRenderer.getDrawer().setError(message);
  }

  // === 队列弹窗管理 ===
  function openQueuePopup() {
    const queuePopup = uiRenderer.getQueuePopup();
    queuePopup.open();
    queuePopup.render(playbackState);
    if (playbackState.queueType === 'playlist') {
      queuePopup.scrollToCurrent();
    }
  }

  function closeQueuePopup() {
    uiRenderer.getQueuePopup().close();
  }

  function toggleQueuePopup() {
    uiRenderer.getQueuePopup().toggle();
    if (uiRenderer.getQueuePopup().isOpen) {
      uiRenderer.getQueuePopup().render(playbackState);
      if (playbackState.queueType === 'playlist') {
        uiRenderer.getQueuePopup().scrollToCurrent();
      }
    }
  }

  // === 本地播放历史 ===
  function loadPlaybackLocalRecentHistory() {
    document.querySelectorAll('[data-playback-home-action]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.playbackHomeAction === 'recent');
    });

    const result = homeService.loadLocalRecentHistory();
    openPlaybackDrawer('播放历史', `${result.items.length} 首`, false);

    const body = document.getElementById('playbackDrawerBody');
    if (!body) return;

    if (!result.items.length) {
      body.innerHTML = '<p class="hint" style="text-align:center;padding:40px 0;">暂无播放记录</p>';
      updateDrawerActions(false);
      return;
    }

    body.innerHTML = result.items.map((track, index) => `
      <div class="queue-row playback-home-row" data-playback-home-track-row-index="${index}">
        <div class="playback-row-main">
          ${PlaybackUtils.renderArtwork(track)}
          <div>
            <div class="song">${escapeHtml(track.title || '')}</div>
            <div class="meta">${escapeHtml(PlaybackUtils.formatTrackMeta(track))}</div>
          </div>
        </div>
        <div class="queue-actions">
          <button type="button" data-playback-home-track-action="normal" data-playback-home-track-index="${index}" title="添加到播放队列末尾">入队</button>
          ${result.action === 'radio'
            ? `<button type="button" data-playback-home-track-action="radio" data-playback-home-track-index="${index}" title="切换到电台队列并播放">电台</button>`
            : `<button type="button" data-playback-home-track-action="requested" data-playback-home-track-index="${index}" title="插入到当前播放歌曲之后">插队</button>`
          }
          <button type="button" data-playback-home-track-action="play" data-playback-home-track-index="${index}" title="立即播放这首歌">播放</button>
        </div>
      </div>
    `).join('');
    updateDrawerActions(true);
  }

  // === 首页内容加载 ===
  /**
   * @param {string} action - 加载的动作类型
   * @param {Function} getAuthState - 获取认证状态的函数
   */
  async function loadPlaybackHomeContent(action, getAuthState) {
    const authState = getAuthState();
    if (!authState || !authState.loggedIn) {
      toast('请先登录播放器');
      return;
    }

    if (action === 'recent') {
      loadPlaybackLocalRecentHistory();
      return;
    }

    const actionName = HomeService.getActionName(action);
    openPlaybackDrawer(actionName, '正在加载...', true, '首次加载会稍慢');

    document.querySelectorAll('[data-playback-home-action]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.playbackHomeAction === action);
    });

    try {
      const result = await homeService.loadContent(action);
      renderPlaybackHomeResults(result.action);
    } catch (error) {
      setPlaybackDrawerError(error.message || String(error));
      showError(error);
    }
  }

  async function loadPlaybackPlaylistTracks(index) {
    const homeState = homeService.getHomeState();
    const playlist = homeState.items[index];
    if (!playlist) return;

    setPlaybackDrawerLoading(`正在打开歌单：${playlist.title || playlist.id}`);

    try {
      const result = await homeService.loadPlaylistTracks(index);
      renderPlaybackHomeResults(result.action, result.title);
    } catch (error) {
      setPlaybackDrawerError(error.message || String(error));
      showError(error);
    }
  }

  async function refreshPlaybackHomeContent() {
    setPlaybackDrawerLoading('正在刷新...');

    try {
      const result = await homeService.refreshContent();
      renderPlaybackHomeResults(result.action);
    } catch (error) {
      const homeState = homeService.getHomeState();
      renderPlaybackHomeResults(homeState.action);
      setPlaybackDrawerError(error.message || String(error));
      showError(error);
    }
  }

  // === Home 交互 ===
  function getHomeCollectionContext(homeState) {
    const currentPlaylist = homeState.action === 'playlist-tracks'
      ? homeService.getCurrentPlaylist()
      : null;
    const title = currentPlaylist?.title || HomeService.getActionName(homeState.action);
    const source = playbackState.selectedSource || 'qq';
    const sourceId = homeState.action === 'playlist-tracks'
      ? `playlist:${currentPlaylist?.id || title}`
      : homeState.action;
    return { title, sourceKey: `${source}:${sourceId}` };
  }

  /**
   * @param {string} action - 批量操作类型
   * @param {Object} queueCallbacks - 队列操作回调
   */
  function handlePlaybackHomeBulkAction(action, queueCallbacks) {
    const homeState = homeService.getHomeState();
    if (homeState.itemType !== 'track' || !homeState.items.length) return;

    let tracks = homeState.items.map(PlaybackUtils.normalizeOnlineTrack);
    if (action === 'shuffle-all') {
      tracks = PlaybackUtils.shuffleTracks(tracks);
      playbackState.mode = 'shuffle';
    }

    if (action === 'play-all' || action === 'shuffle-all') {
      const queueType = homeState.action === 'radio' ? 'radio' : 'playlist';
      const collection = getHomeCollectionContext(homeState);
      queueCallbacks.startPlaybackCollection(
        tracks,
        0,
        queueType,
        collection.title,
        collection.sourceKey
      );
      toast(queueType === 'radio'
        ? `开始播放电台，共载入 ${tracks.length} 首`
        : `开始播放歌单，共 ${tracks.length} 首`);
    } else {
      queueCallbacks.appendPlaybackTracks(tracks);
      queueCallbacks.rebuildPlaybackShuffleOrder();
      savePlaybackState();
      renderPlayback();
      toast(`已加入 ${tracks.length} 首到当前队列`);
    }
  }

  function handlePlaybackDrawerHeaderPlayAll(queueCallbacks) {
    const homeState = homeService.getHomeState();
    if (homeState.itemType !== 'track' || !homeState.items.length) return;

    const tracks = homeState.items.map(PlaybackUtils.normalizeOnlineTrack);
    let startIndex = 0;
    const queueType = homeState.action === 'radio' ? 'radio' : 'playlist';
    const collection = getHomeCollectionContext(homeState);

    if (playbackState.mode === 'shuffle') {
      startIndex = Math.floor(Math.random() * tracks.length);
    }

    queueCallbacks.startPlaybackCollection(
      tracks,
      startIndex,
      queueType,
      collection.title,
      collection.sourceKey
    );
    const label = queueType === 'radio' ? '电台' : '歌单';
    toast(playbackState.mode === 'shuffle'
      ? `随机播放${label}，共 ${tracks.length} 首`
      : `播放全部${label}，共 ${tracks.length} 首`);
  }

  // === 轨道菜单 ===
  function toggleTrackMenu(index) {
    const menu = document.querySelector(`[data-playback-home-track-menu-for="${index}"]`);
    if (!menu) return;

    const isHidden = menu.hasAttribute('hidden');

    document.querySelectorAll('.track-menu').forEach((m) => {
      if (m !== menu) m.setAttribute('hidden', '');
    });

    if (isHidden) {
      menu.removeAttribute('hidden');
      setTimeout(() => {
        const closeMenu = (event) => {
          if (!event.target.closest('.track-menu-wrapper')) {
            menu.setAttribute('hidden', '');
            document.removeEventListener('click', closeMenu);
          }
        };
        document.addEventListener('click', closeMenu);
      }, 0);
    } else {
      menu.setAttribute('hidden', '');
    }
  }

  // === 轨道操作 ===
  /**
   * 处理首页轨道的交互操作
   * @param {string} action - 操作类型
   * @param {number} index - 轨道索引
   * @param {Object} callbacks - 回调函数集合
   */
  function handlePlaybackHomeTrackAction(action, index, callbacks) {
    const track = homeService.getItemByIndex(index);
    if (!track) return;

    if (action === 'remove') {
      const homeState = homeService.getHomeState();
      void callbacks.removeTrackFromPlaylist(track, homeState.action);
      return;
    }

    if (action === 'add-to-playlist') {
      void callbacks.addTrackToPlaylist(track);
      return;
    }

    const homeState = homeService.getHomeState();

    if (action === 'play-context' || action === 'play') {
      const tracks = homeState.items.map(PlaybackUtils.normalizeOnlineTrack);
      const queueType = homeState.action === 'radio' ? 'radio' : 'playlist';
      const collection = getHomeCollectionContext(homeState);
      const selectedTrack = tracks[index];
      const activeIndex = queueType === 'playlist'
        && playbackState.queueType === 'playlist'
        && playbackState.queueSourceKey === collection.sourceKey
        ? playbackState.normalQueueTracks.findIndex((item) => item.id === selectedTrack.id)
        : -1;

      if (activeIndex >= 0) {
        callbacks.jumpToPlaylistTrack(activeIndex);
      } else {
        callbacks.startPlaybackCollection(
          tracks,
          index,
          queueType,
          collection.title,
          collection.sourceKey
        );
      }
      return;
    }

    callbacks.queuePlaybackTrack(PlaybackUtils.normalizeOnlineTrack(track), action, {
      requestedBy: '音乐首页'
    });
  }

  return {
    // Drawer management
    openPlaybackDrawer,
    closePlaybackDrawer,
    playbackDrawerGoBack,
    updateDrawerActions,
    setPlaybackDrawerLoading,
    setPlaybackDrawerError,
    // Queue popup
    openQueuePopup,
    closeQueuePopup,
    toggleQueuePopup,
    // Content loading
    loadPlaybackLocalRecentHistory,
    loadPlaybackHomeContent,
    loadPlaybackPlaylistTracks,
    refreshPlaybackHomeContent,
    // Interactions
    handlePlaybackHomeBulkAction,
    handlePlaybackDrawerHeaderPlayAll,
    handlePlaybackHomeTrackAction,
    toggleTrackMenu
  };
}
