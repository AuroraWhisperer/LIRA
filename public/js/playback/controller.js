// 编写人：Aurora
// 播放控制器主模块
'use strict';

import * as PlaybackUtils from './utils.js';
import * as PlaybackComponents from './ui/components.js';
import { UIRenderer } from './ui/index.js';
import { StateManager } from './state/manager.js';
import { StorageManager } from './state/storage.js';
import { QueueManager } from './queue/manager.js';
import { PlayerController } from './player/controller.js';
import { ProviderManager } from './provider/manager.js';
import { ContentLoader } from './content/loader.js';
import { LocalFileManager } from './local/manager.js';
import { CacheManager } from './cache/manager.js';

import { PlaybackConfig } from './config.js';
import { SearchService } from './services/search-service.js';
import { StreamService } from './services/stream-service.js';
import { LyricService } from './services/lyric-service.js';
import { MatchService } from './services/match-service.js';
import { ImportService } from './services/import-service.js';
import { HomeService } from './services/home-service.js';

import { createInitializer } from './core/initializer.js';
import { createEventHandlers } from './core/event-handlers.js';
import { createRenderer } from './core/renderer.js';
import { createRadioMode } from './features/radio-mode.js';
import { createStreamHandler } from './features/stream-handler.js';
import { createPlaybackControls } from './features/playback-controls.js';
import { createQueueOperations } from './features/queue-operations.js';

export function createPlaybackController(initialOptions = {}) {
  // 在函数内部访问 AdminApp.utils，确保它已经加载
  const U = window.AdminApp.utils;
  const escapeHtml = U.escapeHtml;
  const escapeAttr = U.escapeAttr;
  const value = U.value;
  const formatBytes = U.formatBytes;
  const formatCompactNumber = U.formatCompactNumber;

  let getSongs = () => [];
  let reloadSongs = async () => {};
  let toast = U.toast;
  let showError = U.showError;
  let api = U.api;
  let readJsonResponse = U.readJsonResponse;

  // 使用配置常量
  const playbackStorageKey = PlaybackConfig.STORAGE_KEY;
  const playbackClientId = PlaybackConfig.CLIENT_ID;
  const playbackStateSaveDebounceMs = PlaybackConfig.STATE_SAVE_DEBOUNCE_MS;
  let playbackStateSaveTimer = null;
  let playbackStateSavePending = null;
  const playbackStreamRefreshMarginMs = PlaybackConfig.STREAM_REFRESH_MARGIN_MS;
  const playbackStreamMaxRetries = PlaybackConfig.STREAM_MAX_RETRIES;
  const playbackRadioRefillThreshold = PlaybackConfig.RADIO_REFILL_THRESHOLD;
  const playbackRadioRefillBatchSize = PlaybackConfig.RADIO_REFILL_BATCH_SIZE;

  // 状态和存储管理器
  const stateManager = new StateManager();
  const storageManager = new StorageManager();
  const playbackState = stateManager.getState();

  // 提供商管理器
  const providerManager = new ProviderManager({
    state: playbackState,
    onStateChange: () => {
      renderPlayback();
    },
    onError: (error) => showError(error)
  });
  providerManager.setJsonResponseReader((r, msg) => readJsonResponse(r, msg));

  // 缓存管理器（会话级：关闭 exe 时清空）
  const cacheManager = new CacheManager();

  // 内容加载器
  const contentLoader = new ContentLoader({
    state: playbackState,
    providerManager: providerManager,
    cacheManager: cacheManager,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg),
    onBackgroundUpdate: (update) => {
      // 后台静默刷新检测到变化：更新当前抽屉内容
      if (homeService.getHomeState().action === update.action) {
        homeService._applyBackgroundUpdate(update);
        renderPlaybackHomeResults(update.action, update.title);
        toast(HomeService.getActionName(update.action) + '已自动更新');
      }
    }
  });

  // 本地文件管理器
  const localFileManager = new LocalFileManager({
    onError: (error) => showError(error)
  });

  // 队列管理器
  const queueManager = new QueueManager({
    state: playbackState,
    radioRefillThreshold: playbackRadioRefillThreshold,
    radioRefillBatchSize: playbackRadioRefillBatchSize
  });

  // 播放器控制器（稍后设置音频元素）
  const playerController = new PlayerController({
    state: playbackState,
    queueManager: queueManager,
    onTrackChange: (track, options) => {
      playPlaybackTrack(track, options);
    },
    onStateChange: () => {
      renderPlayback();
      savePlaybackState();
    },
    onError: (error) => {
      showError(error);
    }
  });

  // 搜索服务
  const searchService = new SearchService({
    state: playbackState,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg),
    toast: (msg) => toast(msg)
  });

  // 流媒体服务
  const streamService = new StreamService({
    refreshMarginMs: playbackStreamRefreshMarginMs,
    maxRetries: playbackStreamMaxRetries,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg),
    toast: (msg) => toast(msg)
  });

  // 歌词服务
  const lyricService = new LyricService({
    state: playbackState,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg)
  });

  // 匹配服务
  const matchService = new MatchService({
    state: playbackState,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg),
    toast: (msg) => toast(msg)
  });

  // 导入服务
  const importService = new ImportService({
    matchService: matchService,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg),
    toast: (msg) => toast(msg)
  });

  // 首页服务
  const homeService = new HomeService({
    state: playbackState,
    contentLoader: contentLoader,
    onError: (error) => showError(error),
    readJsonResponse: (r, msg) => readJsonResponse(r, msg),
    toast: (msg) => toast(msg)
  });

  let playbackAuthState = null;
  let playbackProviderHealth = null;
  let playbackProviderRefreshId = 0;
  let playbackRadioRefillRunning = false;
  let playbackInitialized = false;

  // UI 渲染器
  const uiRenderer = new UIRenderer();

  function getPlaybackAudio() {
    return document.getElementById('music-player');
  }

  // === 渲染函数 ===
  function renderPlayback() {
    console.log('[Playback] renderPlayback called, selectedSource:', playbackState.selectedSource);
    const audio = getPlaybackAudio();

    // 获取歌词服务的窗口状态
    const lyricWindowState = lyricService.getWindowState();

    // 使用 UI 渲染器渲染所有界面
    uiRenderer.renderAll(playbackState, audio, {
      lyric: lyricWindowState
    });

    // 渲染音乐源状态
    console.log('[Playback] Calling renderProviderState with:', playbackState.selectedSource);
    uiRenderer.renderProviderState(
      playbackAuthState,
      playbackProviderHealth,
      playbackState.selectedSource
    );

    // 更新"添加到歌单"按钮状态
    const addToPlaylistBtn = document.getElementById('playbackAddToPlaylistBtn');
    if (addToPlaylistBtn) {
      const track = playbackState.current;
      const canAdd = canAddTrackToPlaylist(track);
      addToPlaylistBtn.disabled = !canAdd;
      addToPlaylistBtn.title = canAdd ? `添加到${track.source === 'netease' ? '网易云音乐' : 'QQ 音乐'}歌单` : '当前歌曲无法添加到歌单';
    }

    // 渲染搜索结果和待确认弹窗
    renderPlaybackSearchResults();
    renderPendingConfirmPopup();

    // 同步进度条显示（含 restoredTime，方便退出重进后看到上次的播放位置）
    renderPlaybackProgress();
  }

  function renderPlaybackProgress() {
    const audio = getPlaybackAudio();
    const trackDurationMs = playbackState.current ? playbackState.current.durationMs : 0;
    uiRenderer.renderProgress(audio, playbackState.restoredTime, trackDurationMs);
    uiRenderer.updateMediaSessionPosition(audio);
  }

  function renderFullscreenPlayer() {
    const audio = getPlaybackAudio();
    uiRenderer.getFullscreenPlayer().render(playbackState.current, audio);
  }

  function renderPendingConfirmPopup() {
    const popup = document.getElementById('pendingConfirmPopup');
    if (!popup) return;

    const pending = playbackState.pendingRequests[0];
    if (!pending) {
      popup.classList.remove('visible');
      return;
    }

    const track = pending.track || {};
    const songName = document.getElementById('pendingConfirmSongName');
    const matchInfo = document.getElementById('pendingConfirmMatchInfo');
    const requester = document.getElementById('pendingConfirmRequester');
    const count = document.getElementById('pendingConfirmCount');

    if (songName) songName.textContent = pending.songName || track.title || '';
    if (matchInfo) {
      const reasons = Array.isArray(pending.reasons) ? pending.reasons.join('；') : '';
      matchInfo.textContent = `匹配：${track.title || ''} · ${PlaybackUtils.formatTrackMeta(track)} · ${pending.score || 0} 分${reasons ? ' · ' + reasons : ''}`;
    }
    if (requester) requester.textContent = `点歌人：${pending.requesterName || '观众'}`;
    if (count) count.textContent = playbackState.pendingRequests.length > 1 ? `+${playbackState.pendingRequests.length - 1}` : '';

    popup.classList.add('visible');
  }

  function renderPlaybackSearchResults() {
    const resultNode = document.getElementById('playbackSearchResults');
    if (!resultNode) return;

    const searchResults = searchService.getResults();
    if (!searchResults.length) {
      resultNode.innerHTML = playbackState.selectedSource === 'netease'
        ? '输入关键词后可搜索网易云音乐。'
        : '输入关键词后可搜索 QQ 音乐。';
      return;
    }

    resultNode.innerHTML = searchResults.map((track, index) => `
      <div class="queue-row playback-search-row">
        <div class="playback-row-main">
          ${PlaybackUtils.renderArtwork(track)}
          <div>
            <div class="song">${escapeHtml(track.title || '')}</div>
            <div class="meta">${escapeHtml(PlaybackUtils.formatTrackMeta(track))}</div>
          </div>
        </div>
        <div class="queue-actions">
          <button type="button" data-playback-search-action="normal" data-playback-search-index="${index}" title="添加到播放队列末尾">入队</button>
          <button type="button" data-playback-search-action="requested" data-playback-search-index="${index}" title="插入到当前播放歌曲之后">插队</button>
          <button type="button" data-playback-search-action="play" data-playback-search-index="${index}" title="立即播放这首歌">播放</button>
          ${canAddTrackToPlaylist(track)
            ? `<button type="button" data-playback-search-action="add-to-playlist" data-playback-search-index="${index}" title="添加到音乐歌单">歌单</button>`
            : ''}
        </div>
      </div>
    `).join('');
  }

  function renderPlaybackHomeResults(action = '', title = '') {
    const homeState = homeService.getHomeState();
    uiRenderer.getDrawer().renderContent(
      homeState.items,
      homeState.itemType,
      action,
      title,
      homeState.page
    );
  }

  function updatePlaybackMediaSession() {
    const audio = getPlaybackAudio();
    uiRenderer.updateMediaSession(playbackState.current, audio, {
      onTogglePlayback: togglePlayback,
      onPrevious: playbackPrevious,
      onNext: () => playbackNext(false)
    });
  }

  async function syncPlaybackLyricWindow(force = false) {
    const audio = getPlaybackAudio();
    const track = playbackState.current || null;
    const changed = await lyricService.syncWindow(track, audio, force);
    if (changed) renderPlayback();
  }

  // === 状态保存 ===
  function savePlaybackState() {
    const audio = getPlaybackAudio();
    const serialize = (track) => {
      if (!track) return null;
      return {
        id: track.id,
        source: track.source,
        title: track.title,
        artists: track.artists,
        album: track.album,
        coverUrl: track.coverUrl || '',
        durationMs: track.durationMs,
        fileName: track.fileName,
        filePath: track.filePath || '',
        sourceTrackId: track.sourceTrackId,
        sourceAlbumId: track.sourceAlbumId,
        playable: track.playable,
        vip: track.vip,
        unavailable: (track.source === 'local' && !track.objectUrl) || false,
        playedAt: track.playedAt || 0
      };
    };
    const payload = {
      current: serialize(playbackState.current),
      currentOrigin: playbackState.currentOrigin,
      requestedQueue: playbackState.requestedQueue.map(serialize).filter(Boolean),
      normalQueue: playbackState.normalQueue.map(serialize).filter(Boolean),
      normalQueueTracks: playbackState.normalQueueTracks.map(serialize).filter(Boolean),
      radioQueue: playbackState.radioQueue.map(serialize).filter(Boolean),
      queueType: playbackState.queueType,
      queueTitle: playbackState.queueTitle,
      playlistIndex: playbackState.playlistIndex,
      pendingRequests: playbackState.pendingRequests.map((item) => ({
        ...item,
        track: serialize(item.track)
      })).filter((item) => item.track),
      currentTime: audio && audio.readyState >= 1 && Number.isFinite(audio.currentTime) ? audio.currentTime : playbackState.restoredTime,
      volume: playbackState.volume,
      mode: playbackState.mode,
      selectedSource: playbackState.selectedSource,
      shuffleOrder: playbackState.shuffleOrder,
      shuffleCursor: playbackState.shuffleCursor,
      history: playbackState.history.slice(-50).map(serialize).filter(Boolean),
      displayHistory: playbackState.displayHistory.slice(0, 200).map(serialize).filter(Boolean)
    };
    schedulePlaybackStateSave(payload);
  }

  function schedulePlaybackStateSave(payload) {
    playbackStateSavePending = payload;
    if (playbackStateSaveTimer) clearTimeout(playbackStateSaveTimer);
    playbackStateSaveTimer = setTimeout(flushPlaybackStateSave, playbackStateSaveDebounceMs);
  }

  function flushPlaybackStateSave() {
    if (playbackStateSaveTimer) {
      clearTimeout(playbackStateSaveTimer);
      playbackStateSaveTimer = null;
    }
    if (!playbackStateSavePending) return;
    const payload = playbackStateSavePending;
    playbackStateSavePending = null;
    fetch('/api/playback/queue-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: playbackClientId, payload })
    }).catch(() => {});
  }

  function flushPlaybackStateOnUnload() {
    if (!playbackStateSavePending && playbackState.current) {
      savePlaybackState();
    }
    if (!playbackStateSavePending) return;
    const payload = playbackStateSavePending;
    playbackStateSavePending = null;
    if (playbackStateSaveTimer) {
      clearTimeout(playbackStateSaveTimer);
      playbackStateSaveTimer = null;
    }

    if (window.musicAPI && typeof window.musicAPI.savePlaybackState === 'function') {
      try {
        window.musicAPI.savePlaybackState(playbackClientId, payload);
      } catch (_) {}
    }

    const body = JSON.stringify({ clientId: playbackClientId, payload });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const token = window.__API_TOKEN__;
      const beaconUrl = `/api/playback/queue-state${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      navigator.sendBeacon(beaconUrl, blob);
    } else {
      fetch('/api/playback/queue-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    }
  }

  // === Provider 管理 ===
  async function refreshSelectedMusicProviderState() {
    const platform = playbackState.selectedSource;
    const refreshId = ++playbackProviderRefreshId;
    const [authResult, healthResult] = await Promise.allSettled([
      providerManager.refreshAuthState({ platform, notify: false }),
      providerManager.checkProviderHealth({ platform, silent: true, notify: false })
    ]);

    if (refreshId !== playbackProviderRefreshId || playbackState.selectedSource !== platform) return;
    playbackAuthState = authResult.status === 'fulfilled'
      ? authResult.value
      : providerManager.getAuthState(platform);
    playbackProviderHealth = providerManager.getProviderHealth(platform);
    if (!playbackProviderHealth && healthResult.status === 'rejected') {
      playbackProviderHealth = {
        source: platform,
        ok: false,
        status: 'error',
        message: healthResult.reason?.message || String(healthResult.reason)
      };
    }
    renderPlayback();
  }

  async function refreshSelectedMusicAuthState() {
    const platform = playbackState.selectedSource;
    const authState = await providerManager.refreshAuthState({ platform, notify: false });
    if (playbackState.selectedSource === platform) {
      playbackAuthState = authState;
      renderPlayback();
    }
    return authState;
  }

  async function checkSelectedMusicProviderHealth(options = {}) {
    const platform = playbackState.selectedSource;
    try {
      const healthState = await providerManager.checkProviderHealth({
        platform,
        silent: true,
        notify: false
      });
      if (playbackState.selectedSource !== platform) return healthState;
      playbackProviderHealth = healthState;
      if (!options.silent) {
        const healthOk = playbackProviderHealth && playbackProviderHealth.ok;
        if (typeof U.showStackedToast === 'function') {
          U.showStackedToast({
            key: `playback-health:${platform}`,
            title: healthOk ? '接口检查通过' : '接口状态异常',
            message: playbackProviderHealth.message || '音乐接口检查完成',
            className: healthOk ? 'playback-health-toast-good' : 'playback-health-toast-warn',
            duration: 3800
          });
        } else {
          toast(playbackProviderHealth.message || '音乐接口检查完成');
        }
      }
    } catch (error) {
      if (playbackState.selectedSource !== platform) return providerManager.getProviderHealth(platform);
      playbackProviderHealth = {
        source: platform,
        ok: false,
        status: 'error',
        message: error.message || String(error)
      };
      if (!options.silent) showError(error);
    }
    renderPlayback();
    return playbackProviderHealth;
  }

  async function loginSelectedMusicProvider() {
    if (!window.musicAPI || typeof window.musicAPI.login !== 'function') {
      toast('扫码登录需要在桌面版里使用');
      return;
    }

    const button = document.getElementById('playbackLoginBtn');
    if (button) button.disabled = true;
    try {
      await window.musicAPI.login(playbackState.selectedSource);
      await refreshSelectedMusicProviderState();
      U.showStackedToast({
        key: 'music-cookie-refreshed',
        title: 'Cookie 已刷新',
        message: 'QQ音乐登录窗口已关闭',
        className: 'music-cookie-refreshed-toast',
        duration: 3600
      });
    } catch (error) {
      showError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function showPlaybackLoginPrompt() {
    const sourceName = PlaybackUtils.getSourceName(playbackState.selectedSource);
    if (typeof U.showStackedToast !== 'function') {
      toast(`请先登录${sourceName}`);
      return;
    }

    U.showStackedToast({
      key: `playback-login-required:${playbackState.selectedSource}`,
      title: `请先登录${sourceName}`,
      message: '登录后即可播放在线音乐',
      className: 'playback-login-toast',
      duration: 5200,
      onClick: loginSelectedMusicProvider
    });
  }

  async function logoutSelectedMusicProvider() {
    if (!window.musicAPI || typeof window.musicAPI.logout !== 'function') {
      toast('退出音乐账号需要在桌面版里使用');
      return;
    }
    const sourceName = PlaybackUtils.getSourceName(playbackState.selectedSource);

    const confirmed = await window.AdminApp.utils.logoutConfirm({
      title: '退出登录',
      platform: sourceName,
      message: '退出后将无法访问该平台的会员歌曲和个人歌单。',
      icon: '→',
      confirmLabel: '确认退出'
    });
    if (!confirmed) return;

    try {
      const platform = playbackState.selectedSource;
      await window.musicAPI.logout(playbackState.selectedSource);
      playbackAuthState = null;
      clearPlaybackPlatformAfterLogout(platform);
      await refreshSelectedMusicProviderState();
      toast(`${sourceName}已退出登录`);
    } catch (error) {
      showError(error);
      await refreshSelectedMusicProviderState().catch(() => {});
    }
  }

  function clearPlaybackPlatformAfterLogout(platform) {
    const source = platform === 'netease' ? 'netease' : 'qq';
    const clearTrack = (track) => {
      if (!track || track.source !== source) return;
      delete track.playUrl;
      delete track.playUrlExpireAt;
    };
    [
      playbackState.current,
      ...playbackState.requestedQueue,
      ...playbackState.normalQueue,
      ...playbackState.normalQueueTracks,
      ...playbackState.radioQueue,
      ...playbackState.history
    ].forEach(clearTrack);

    if (playbackState.current && playbackState.current.source === source) {
      const audio = getPlaybackAudio();
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      playbackState.current = null;
      playbackState.currentOrigin = '';
      playbackState.restoredTime = 0;
      toast('当前播放歌曲所属账号已退出，请重新选择音源');
    }
    savePlaybackState();
  }

  // === 缓存管理 ===
  async function refreshPlaybackMusicCacheStats() {
    const status = document.getElementById('playbackCacheStatus');
    if (!status) return;
    try {
      const response = await fetch('/api/music/cache');
      const payload = await readJsonResponse(response, '读取音乐缓存失败');
      if (!payload.ok) throw new Error(payload.error || '读取音乐缓存失败');
      status.textContent = `缓存大小：${formatBytes(payload.data.totalBytes || 0)} · ${payload.data.totalFiles || 0} 个文件`;
    } catch (error) {
      status.textContent = error.message || String(error);
    }
  }

  async function clearPlaybackMusicCache() {
    const button = document.getElementById('playbackClearCacheBtn');
    if (button) button.disabled = true;
    try {
      const response = await fetch('/api/music/cache/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true })
      });
      const payload = await readJsonResponse(response, '清理音乐缓存失败');
      if (!payload.ok) throw new Error(payload.error || '清理音乐缓存失败');
      toast(`已清理 ${formatBytes(payload.data.clearedBytes || 0)} 音乐缓存`);
      await refreshPlaybackMusicCacheStats();
    } catch (error) {
      showError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  // === Home/Drawer 内容管理 ===
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
      <div class="queue-row playback-home-row">
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

  async function loadPlaybackHomeContent(action) {
    if (!playbackAuthState || !playbackAuthState.loggedIn) {
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

  // === Home 交互类 ===
  function handlePlaybackHomeBulkAction(action) {
    const homeState = homeService.getHomeState();
    if (homeState.itemType !== 'track' || !homeState.items.length) return;

    let tracks = homeState.items.map(PlaybackUtils.normalizeOnlineTrack);
    if (action === 'shuffle-all') {
      tracks = PlaybackUtils.shuffleTracks(tracks);
      playbackState.mode = 'shuffle';
    }

    if (action === 'play-all' || action === 'shuffle-all') {
      const queueType = homeState.action === 'radio' ? 'radio' : 'playlist';
      startPlaybackCollection(tracks, 0, queueType);
      toast(queueType === 'radio'
        ? `开始播放电台，共载入 ${tracks.length} 首`
        : `开始播放歌单，共 ${tracks.length} 首`);
    } else {
      appendPlaybackTracks(tracks);
      rebuildPlaybackShuffleOrder();
      savePlaybackState();
      renderPlayback();
      toast(`已加入 ${tracks.length} 首到当前队列`);
    }
  }

  function handlePlaybackDrawerHeaderPlayAll() {
    const homeState = homeService.getHomeState();
    if (homeState.itemType !== 'track' || !homeState.items.length) return;

    const tracks = homeState.items.map(PlaybackUtils.normalizeOnlineTrack);
    let startIndex = 0;
    const queueType = homeState.action === 'radio' ? 'radio' : 'playlist';

    if (playbackState.mode === 'shuffle') {
      startIndex = Math.floor(Math.random() * tracks.length);
    }

    startPlaybackCollection(tracks, startIndex, queueType);
    const label = queueType === 'radio' ? '电台' : '歌单';
    toast(playbackState.mode === 'shuffle'
      ? `随机播放${label}，共 ${tracks.length} 首`
      : `播放全部${label}，共 ${tracks.length} 首`);
  }

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

  function showConfirmDialog(title, message, trackName, confirmText = '确认', cancelText = '取消') {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'confirm-dialog-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');

      backdrop.innerHTML = `
        <div class="confirm-dialog">
          <div class="confirm-dialog-header">
            <h3>${escapeHtml(title)}</h3>
          </div>
          <div class="confirm-dialog-body">
            ${escapeHtml(message)}
            ${trackName ? `<div class="confirm-dialog-track">${escapeHtml(trackName)}</div>` : ''}
          </div>
          <div class="confirm-dialog-footer">
            <button type="button" class="confirm-cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="confirm-delete">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      let settled = false;
      const close = (confirmed = false) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', handleKeydown);
        backdrop.remove();
        resolve(confirmed);
      };

      const handleKeydown = (event) => {
        if (event.key === 'Escape') close(false);
        if (event.key === 'Enter') close(true);
      };

      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
          close(false);
          return;
        }
        if (event.target.closest('.confirm-cancel')) {
          close(false);
          return;
        }
        if (event.target.closest('.confirm-delete')) {
          close(true);
        }
      });

      document.addEventListener('keydown', handleKeydown);
      document.body.appendChild(backdrop);
      backdrop.querySelector('.confirm-delete')?.focus();
    });
  }

  async function removeTrackFromPlaylist(track, action) {
    if (!track) return;

    const homeState = homeService.getHomeState();
    const platform = playbackState.selectedSource;
    const platformLabel = platform === 'netease' ? '网易云音乐' : 'QQ 音乐';

    if (action === 'liked') {
      const confirmed = await showConfirmDialog(
        '从我喜欢中删除',
        '确认要删除这首歌曲吗？',
        track.title || '当前歌曲',
        '删除',
        '取消'
      );
      if (!confirmed) return;

      try {
        toast('正在从我喜欢中删除…');
        const response = await fetch('/api/music/playlists/tracks/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform,
            playlist: { id: 'liked' },
            tracks: [track]
          })
        });
        const payload = await readJsonResponse(response, `从我喜欢删除失败`);
        if (!response.ok || !payload.ok) throw new Error(payload.error || `从我喜欢删除失败`);

        toast('已从我喜欢中删除');
        await homeService.refreshContent();
        renderPlaybackHomeResults(homeState.action);
      } catch (error) {
        showError(error);
      }
      return;
    }

    if (action === 'playlist-tracks') {
      const currentPlaylist = homeService.getCurrentPlaylist();
      if (!currentPlaylist) return;

      const confirmed = await showConfirmDialog(
        `从歌单中删除`,
        `确认从「${currentPlaylist.title || '歌单'}」中删除这首歌曲吗？`,
        track.title || '当前歌曲',
        '删除',
        '取消'
      );
      if (!confirmed) return;

      try {
        toast('正在从歌单中删除…');
        const response = await fetch('/api/music/playlists/tracks/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform,
            playlist: currentPlaylist,
            tracks: [track]
          })
        });
        const payload = await readJsonResponse(response, `从${platformLabel}歌单删除失败`);
        if (!response.ok || !payload.ok) throw new Error(payload.error || `从${platformLabel}歌单删除失败`);

        toast(`已从「${currentPlaylist.title || '歌单'}」中删除`);
        await homeService.refreshContent();
        renderPlaybackHomeResults(homeState.action);
      } catch (error) {
        showError(error);
      }
    }
  }

  function handlePlaybackHomeTrackAction(action, index) {
    const track = homeService.getItemByIndex(index);
    if (!track) return;

    if (action === 'remove') {
      const homeState = homeService.getHomeState();
      void removeTrackFromPlaylist(track, homeState.action);
      return;
    }

    if (action === 'add-to-playlist') {
      void addTrackToPlaylist(track);
      return;
    }

    const homeState = homeService.getHomeState();

    if (action === 'play' && homeState.action !== 'recent') {
      const selectedTrack = PlaybackUtils.normalizeOnlineTrack(track);
      if (
        (playbackState.queueType === 'playlist' || playbackState.queueType === 'radio')
        && playbackState.current
      ) {
        insertAndPlayPlaybackTrack(selectedTrack);
        return;
      }
      const tracks = homeState.items.map(PlaybackUtils.normalizeOnlineTrack);
      const queueType = homeState.action === 'radio' ? 'radio' : 'playlist';
      startPlaybackCollection(tracks, index, queueType);
      return;
    }

    queuePlaybackTrack(PlaybackUtils.normalizeOnlineTrack(track), action, {
      requestedBy: '音乐首页'
    });
  }

  function canAddTrackToPlaylist(track) {
    if (!track) return false;
    if (track.source === 'qq') return Number(track.sourceSongId) > 0;
    if (track.source === 'netease') return /^\d+$/.test(String(track.sourceTrackId || '').replace(/^netease:/, ''));
    return false;
  }

  async function addTrackToPlaylist(track) {
    if (!canAddTrackToPlaylist(track)) {
      toast('这首歌曲缺少平台歌曲 ID，暂时无法添加到歌单');
      return;
    }
    const platform = track.source;
    const platformLabel = platform === 'netease' ? '网易云音乐' : 'QQ 音乐';
    try {
      toast('正在检查歌单中的歌曲…');
      const listResponse = await fetch('/api/music/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, action: 'created-playlists', limit: 500, refresh: true, track })
      });
      const listPayload = await readJsonResponse(listResponse, `加载${platformLabel}歌单失败`);
      if (!listResponse.ok || !listPayload.ok) throw new Error(listPayload.error || `加载${platformLabel}歌单失败`);
      const playlists = Array.isArray(listPayload.data && listPayload.data.playlists)
        ? listPayload.data.playlists.filter((item) => item && (
          platform === 'qq'
            ? item.dirId && (item.tid || item.id)
            : item.id
        ))
        : [];
      if (playlists.length === 0) throw new Error(`没有找到可写入的${platformLabel}歌单`);
      const playlist = await choosePlaylistForTrack(platformLabel, playlists, track);
      if (!playlist) return;
      const confirmed = await PlaybackComponents.showConfirmDialog({
        title: `添加到${platformLabel}歌单`,
        message: `确认将「${track.title || '当前歌曲'}」添加到「${playlist.title || playlist.id}」？`,
        confirmText: '确定',
        cancelText: '取消'
      });
      if (!confirmed) return;

      const writeResponse = await fetch('/api/music/playlists/tracks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, playlist, tracks: [track] })
      });
      const writePayload = await readJsonResponse(writeResponse, `添加到${platformLabel}歌单失败`);
      if (!writeResponse.ok || !writePayload.ok) throw new Error(writePayload.error || `添加到${platformLabel}歌单失败`);
      const song = writePayload.data && writePayload.data.result
        && Array.isArray(writePayload.data.result.songlist)
        ? writePayload.data.result.songlist[0]
        : null;
      toast(song && Number(song.existed) === 1
        ? `歌曲已在「${playlist.title}」中`
        : `已添加到「${playlist.title}」`);
    } catch (error) {
      showError(error);
    }
  }

  function choosePlaylistForTrack(platformLabel, playlists, track) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'playlist-picker-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      const availableCount = playlists.filter((item) => item.containsTrack === false).length;
      backdrop.innerHTML = `
        <div class="playlist-picker-dialog">
          <div class="playlist-picker-header">
            <div>
              <h3>添加到${escapeHtml(platformLabel)}歌单</h3>
              <p>${escapeHtml(track.title || '当前歌曲')} · ${availableCount} 个歌单可添加</p>
            </div>
            <button type="button" class="playlist-picker-close" aria-label="关闭">×</button>
          </div>
          <div class="playlist-picker-list">
            ${playlists.map((item, index) => {
              const isAdded = item.containsTrack === true;
              const checkFailed = item.containsTrack == null;
              const status = isAdded ? '已添加' : (checkFailed ? '检查失败' : '可添加');
              return `
                <button type="button" class="playlist-picker-item${isAdded ? ' is-added' : ''}" data-playlist-picker-index="${index}" ${isAdded || checkFailed ? 'disabled' : ''}>
                  ${PlaybackUtils.renderArtwork(item, { fallback: '单' })}
                  <span class="playlist-picker-name">${escapeHtml(item.title || item.id)}</span>
                  <span class="playlist-picker-status">${status}</span>
                </button>
              `;
            }).join('')}
          </div>
          <div class="playlist-picker-footer">
            <span>已添加的歌单不可重复选择</span>
            <button type="button" class="playlist-picker-cancel">取消</button>
          </div>
        </div>
      `;

      let settled = false;
      const close = (playlist = null) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', handleKeydown);
        backdrop.remove();
        resolve(playlist);
      };
      const handleKeydown = (event) => {
        if (event.key === 'Escape') close();
      };
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop || event.target.closest('.playlist-picker-close, .playlist-picker-cancel')) {
          close();
          return;
        }
        const button = event.target.closest('[data-playlist-picker-index]');
        if (!button || button.disabled) return;
        close(playlists[Number(button.dataset.playlistPickerIndex)] || null);
      });
      document.addEventListener('keydown', handleKeydown);
      document.body.appendChild(backdrop);
      backdrop.querySelector('.playlist-picker-item:not(:disabled), .playlist-picker-close')?.focus();
    });
  }

  async function addCurrentTrackToPlaylist() {
    const track = playbackState.current;
    if (!track) {
      toast('当前没有播放歌曲');
      return;
    }
    await addTrackToPlaylist(track);
  }

  // === 队列操作类 ===
  function queuePlaybackTrack(track, action, options = {}) {
    if (!track) return;
    if (action === 'play') {
      insertAndPlayPlaybackTrack(track);
      return;
    }
    if (action === 'requested') {
      insertPlaybackTracksNext([{
        ...track,
        requestedBy: options.requestedBy || '手动添加'
      }]);
      toast('已插入当前歌曲之后');
    } else if (action === 'radio') {
      startPlaybackCollection([track], 0, 'radio');
      toast('已切换到电台队列');
      return;
    } else {
      appendPlaybackTracks([track]);
      rebuildPlaybackShuffleOrder();
      toast('已加入当前队列');
    }
    savePlaybackState();
    renderPlayback();
  }

  function startPlaybackCollection(tracks, selectedIndex, queueType, queueTitle = '') {
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;
    const index = Math.max(0, Math.min(items.length - 1, Number(selectedIndex) || 0));
    const type = queueType === 'radio' ? 'radio' : 'playlist';
    const audio = getPlaybackAudio();
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    playbackState.current = null;
    playbackState.currentOrigin = '';
    playbackState.requestedQueue = [];
    playbackState.normalQueue = [];
    playbackState.normalQueueTracks = [];
    playbackState.radioQueue = [];
    playbackState.queueType = type;
    playbackState.queueTitle = queueTitle || (type === 'radio' ? '电台队列' : '歌单队列');
    playbackState.playlistIndex = type === 'playlist' ? index : -1;
    playbackState.pendingRequests = [];
    playbackState.shuffleOrder = [];
    playbackState.shuffleCursor = 0;
    playbackState.restoredTime = 0;

    if (type === 'playlist') {
      playbackState.normalQueueTracks = items.map((track) => ({ ...track }));
      playbackState.normalQueue = items.slice(index + 1).map((track) => ({ ...track }));
    } else {
      playbackState.radioQueue = items.slice(index + 1).map((track) => ({ ...track }));
    }

    rebuildPlaybackShuffleOrder();
    savePlaybackState();
    playPlaybackTrack(items[index], { origin: type === 'radio' ? 'radio' : 'normal' });
    if (type === 'radio') ensurePlaybackRadioQueueFilled();
  }

  function appendPlaybackTracks(tracks) {
    const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (!items.length) return;
    playbackState.requestedQueue = [];
    if (playbackState.queueType === 'radio') {
      playbackState.radioQueue.push(...items);
      return;
    }

    if (playbackState.queueType !== 'playlist') {
      playbackState.queueType = 'queue';
      playbackState.queueTitle = '播放队列';
      playbackState.normalQueueTracks = [];
      playbackState.playlistIndex = -1;
    } else {
      playbackState.normalQueueTracks.push(...items.map((track) => ({ ...track })));
    }
    playbackState.radioQueue = [];
    playbackState.normalQueue.push(...items);
  }

  function insertPlaybackTracksNext(tracks) {
    queueManager.insertTracksNext(tracks);
    rebuildPlaybackShuffleOrder();
  }

  function insertAndPlayPlaybackTrack(track) {
    if (!track) return;
    playbackState.requestedQueue = [];
    const origin = 'normal';
    if (playbackState.queueType === 'playlist' && playbackState.current) {
      const insertAt = Math.max(0, Math.min(
        playbackState.normalQueueTracks.length,
        playbackState.playlistIndex + 1
      ));
      playbackState.normalQueueTracks.splice(insertAt, 0, { ...track });
      playbackState.playlistIndex = insertAt;
      playbackState.radioQueue = [];
    } else if (playbackState.queueType === 'radio') {
      const historyTracks = [
        track,
        ...playbackState.displayHistory.filter((item) => item.id !== track.id)
      ];
      startPlaybackCollection(historyTracks, 0, 'playlist', '历史播放');
      return;
    } else {
      playbackState.queueType = 'queue';
      playbackState.queueTitle = '播放队列';
      playbackState.normalQueueTracks = [];
      playbackState.radioQueue = [];
      playbackState.playlistIndex = -1;
    }
    rebuildPlaybackShuffleOrder();
    savePlaybackState();
    playPlaybackTrack(track, { origin });
  }

  function activePlaybackQueue() {
    return queueManager.getActiveQueue();
  }

  function activePlaybackOrigin() {
    return queueManager.getActiveOrigin();
  }

  function clearPlaybackQueue() {
    const audio = getPlaybackAudio();
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    playbackState.current = null;
    playbackState.currentOrigin = '';
    playbackState.pendingRequests = [];
    playbackState.history = [];
    playbackState.restoredTime = 0;
    queueManager.clearQueue();
    savePlaybackState();
    renderPlayback();
    syncPlaybackLyricWindow();
  }

  function takePlaybackQueueTrack(origin, index) {
    const queueName = String(origin || '');
    const activeOrigin = activePlaybackOrigin();
    const queue = queueName === activeOrigin ? activePlaybackQueue() : null;
    if (!queue || !Number.isInteger(index) || index < 0 || index >= queue.length) return null;
    const track = queue.splice(index, 1)[0];
    if (playbackState.queueType === 'playlist') {
      const sourceIndex = playbackState.normalQueueTracks.findIndex(
        (item, itemIndex) => itemIndex > playbackState.playlistIndex && item.id === track.id
      );
      if (sourceIndex >= 0) playbackState.normalQueueTracks.splice(sourceIndex, 1);
      const insertAt = playbackState.playlistIndex + 1;
      playbackState.normalQueueTracks.splice(insertAt, 0, { ...track });
      playbackState.playlistIndex = insertAt;
    }
    return {
      origin: activeOrigin,
      track
    };
  }

  function rebuildPlaybackShuffleOrder() {
    const ids = playbackState.normalQueue.map((track) => track.id);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    playbackState.shuffleOrder = ids;
    playbackState.shuffleCursor = 0;
  }

  function takeNextShuffleNormalTrack() {
    if (!playbackState.shuffleOrder.length) {
      rebuildPlaybackShuffleOrder();
    }
    while (playbackState.shuffleCursor < playbackState.shuffleOrder.length) {
      const nextId = playbackState.shuffleOrder[playbackState.shuffleCursor];
      playbackState.shuffleCursor += 1;
      const index = playbackState.normalQueue.findIndex((track) => track.id === nextId);
      if (index >= 0) {
        return playbackState.normalQueue.splice(index, 1)[0];
      }
    }
    return playbackState.normalQueue.shift() || null;
  }

  function takeNextPlaybackTrack() {
    if (playbackState.queueType !== 'radio' && playbackState.normalQueue.length > 0) {
      let track;
      if (playbackState.mode === 'shuffle') {
        track = takeNextShuffleNormalTrack();
      } else {
        track = playbackState.normalQueue.shift();
      }
      if (track && playbackState.queueType === 'playlist') {
        if (playbackState.mode === 'sequence') {
          playbackState.playlistIndex = Math.min(
            playbackState.normalQueueTracks.length - 1,
            playbackState.playlistIndex + 1
          );
        } else {
          playbackState.playlistIndex = playbackState.normalQueueTracks.findIndex((item) => item.id === track.id);
        }
      }
      if (track) return { origin: 'normal', track };
    }

    if (playbackState.queueType === 'radio' && playbackState.radioQueue.length > 0) {
      const track = playbackState.radioQueue.shift();
      ensurePlaybackRadioQueueFilled();
      return { origin: 'radio', track };
    }

    return null;
  }

  function jumpToPlaylistTrack(index) {
    const tracks = playbackState.normalQueueTracks;
    if (!tracks || index < 0 || index >= tracks.length) return;
    const track = tracks[index];
    playbackState.playlistIndex = index;
    playbackState.normalQueue = tracks.slice(index + 1).map((t) => ({ ...t }));
    playbackState.radioQueue = [];
    rebuildPlaybackShuffleOrder();
    savePlaybackState();
    playPlaybackTrack(track, { origin: 'normal' });
  }

  function playbackQueueTotalCount() {
    return queueManager.getTotalCount();
  }

  // === 搜索功能类 ===
  async function runPlaybackSearch() {
    const keyword = value('playbackSearchKeyword');
    const resultNode = document.getElementById('playbackSearchResults');

    if (resultNode) resultNode.textContent = '正在搜索...';
    try {
      const limit = Number(value('playbackSearchLimit') || 9);
      await searchService.search(keyword, limit);
      renderPlaybackSearchResults();
    } catch (error) {
      if (resultNode) resultNode.textContent = error.message || String(error);
    }
  }

  function clearPlaybackSearch() {
    const keywordInput = document.getElementById('playbackSearchKeyword');
    if (keywordInput) keywordInput.value = '';
    searchService.clearResults();
    renderPlaybackSearchResults();
  }

  function handlePlaybackSearchAction(action, index) {
    const track = searchService.getResultByIndex(index);
    if (!track) return;
    if (action === 'add-to-playlist') {
      void addTrackToPlaylist(track);
      return;
    }
    const queuedTrack = PlaybackUtils.normalizeOnlineTrack(track);

    if (action === 'play') {
      insertAndPlayPlaybackTrack(queuedTrack);
      return;
    }

    if (action === 'requested') {
      insertPlaybackTracksNext([{
        ...queuedTrack,
        requestedBy: '手动搜索'
      }]);
      toast('已插入当前歌曲之后');
    } else {
      appendPlaybackTracks([queuedTrack]);
      rebuildPlaybackShuffleOrder();
      toast('已加入当前队列');
    }

    savePlaybackState();
    renderPlayback();
  }

  // === 导入功能类 ===
  async function importSongQueueToPlayback() {
    const button = document.getElementById('playbackImportSongQueue');
    if (button) button.disabled = true;

    try {
      const currentSource = playbackState.current && playbackState.current.source;
      const platforms = PlaybackUtils.preferredPlatforms(currentSource, playbackState.selectedSource);
      const result = await importService.importFromSongQueue({
        maxItems: 30,
        platforms: platforms
      });

      if (result.tracks.length > 0) {
        insertPlaybackTracksNext(result.tracks);
        savePlaybackState();
        renderPlayback();
      }

      toast(`已导入 ${result.imported} 首，待确认 ${result.pending} 首，跳过 ${result.skipped} 首`);
    } catch (error) {
      showError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  // === 匹配测试类 ===
  async function runPlaybackMatchTest() {
    const resultNode = document.getElementById('playbackMatchResults');
    const songName = value('playbackMatchSong');

    if (resultNode) resultNode.textContent = '正在匹配...';

    try {
      const artist = value('playbackMatchArtist');
      const durationMs = Number(value('playbackMatchDuration') || 0);
      const data = await matchService.testMatch(songName, artist, durationMs);
      renderPlaybackMatchResults(data);
    } catch (error) {
      if (resultNode) resultNode.textContent = error.message || String(error);
      showError(error);
    }
  }

  function renderPlaybackMatchResults(data) {
    const resultNode = document.getElementById('playbackMatchResults');
    if (!resultNode) return;
    const results = data && Array.isArray(data.results) ? data.results.slice(0, 5) : [];
    if (!results.length) {
      resultNode.innerHTML = '没有找到候选歌曲。';
      return;
    }
    resultNode.innerHTML = results.map((item) => {
      const track = item.track || {};
      const reasons = Array.isArray(item.reasons) ? item.reasons.join('；') : '';
      return `
        <div class="match-result-row${item.autoAccept ? ' accepted' : ''}">
          <strong>${escapeHtml(track.title || '')}</strong>
          <span>${escapeHtml((track.artists || []).join(' / ') || '未知歌手')} · ${Number(item.score || 0)} 分 · ${item.autoAccept ? '可自动匹配' : '待确认'}</span>
          <small>${escapeHtml(reasons || '无命中原因')}</small>
        </div>
      `;
    }).join('');
  }

  // === PLACEHOLDER_FOR_MORE_FUNCTIONS_4 ===

  return {
    init: async () => {},
    updateContext: () => {}
  };
}
