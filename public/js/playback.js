// 编写人：Aurora
// 播放助手模块。挂载到 window.AdminApp.playback
'use strict';

import * as PlaybackUtils from './playback/utils.js';
import * as PlaybackComponents from './playback/ui/components.js';
import { UIRenderer } from './playback/ui/index.js';
import { StateManager } from './playback/state/manager.js';
import { StorageManager } from './playback/state/storage.js';
import { QueueManager } from './playback/queue/manager.js';
import { PlayerController } from './playback/player/controller.js';
import { ProviderManager } from './playback/provider/manager.js';
import { ContentLoader } from './playback/content/loader.js';
import { LocalFileManager } from './playback/local/manager.js';
import { APIClient } from './playback/api/client.js';
import { PlaybackConfig } from './playback/config.js';
import { SearchService } from './playback/services/search-service.js';
import { StreamService } from './playback/services/stream-service.js';
import { LyricService } from './playback/services/lyric-service.js';
import { MatchService } from './playback/services/match-service.js';
import { ImportService } from './playback/services/import-service.js';
import { HomeService } from './playback/services/home-service.js';

(function () {
  const U = window.AdminApp.utils;
  const escapeHtml = U.escapeHtml;
  const escapeAttr = U.escapeAttr;
  const value = U.value;
  const formatBytes = U.formatBytes;
  const formatCompactNumber = U.formatCompactNumber;

  let playbackController = null;

  function initPlaybackAssistant(options = {}) {
    if (!playbackController) playbackController = createPlaybackController(options);
    playbackController.init(options);
  }

  function createPlaybackController(initialOptions = {}) {
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

    // API 客户端
    const apiClient = new APIClient({
      onError: (error) => showError(error)
    });

    // 提供商管理器
    const providerManager = new ProviderManager({
      state: playbackState,
      onStateChange: () => {
        renderPlayback();
      },
      onError: (error) => showError(error)
    });
    providerManager.setJsonResponseReader((r, msg) => readJsonResponse(r, msg));

    // 内容加载器
    const contentLoader = new ContentLoader({
      state: playbackState,
      providerManager: providerManager,
      onError: (error) => showError(error),
      readJsonResponse: (r, msg) => readJsonResponse(r, msg)
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
    let playbackRadioRefillRunning = false;
    let playbackInitialized = false;

    // UI 渲染器
    const uiRenderer = new UIRenderer();
    async function init(options = {}) {
        updateContext(options);
        if (playbackInitialized) return;
        playbackInitialized = true;
        const audio = getPlaybackAudio();
        if (!audio) {
          playbackInitialized = false;
          return;
        }

        // 初始化 UI 渲染器
        uiRenderer.init();

        // 设置播放器控制器的音频元素
        playerController.setAudio(audio);

        // 设置全屏播放器 seek 回调
        uiRenderer.getFullscreenPlayer().setSeekCallback(() => {
          renderPlaybackProgress();
          savePlaybackState();
        });

        await restorePlaybackState();
        audio.volume = playbackState.volume;

        document.getElementById('playbackClearQueue')?.addEventListener('click', clearPlaybackQueue);
        document.getElementById('playbackImportSongQueue')?.addEventListener('click', importSongQueueToPlayback);
        document.getElementById('playbackPrev')?.addEventListener('click', playbackPrevious);
        document.getElementById('playbackNext')?.addEventListener('click', () => playbackNext(false));
        document.getElementById('playbackPlayPause')?.addEventListener('click', togglePlayback);
        document.getElementById('playbackLoginBtn')?.addEventListener('click', loginSelectedMusicProvider);
        document.getElementById('playbackLogoutBtn')?.addEventListener('click', logoutSelectedMusicProvider);
        document.getElementById('playbackHealthBtn')?.addEventListener('click', checkSelectedMusicProviderHealth);
        document.getElementById('playbackClearCacheBtn')?.addEventListener('click', clearPlaybackMusicCache);
        document.getElementById('playbackLyricBtn')?.addEventListener('click', togglePlaybackLyricWindow);
        document.getElementById('playbackLyricLockBtn')?.addEventListener('click', togglePlaybackLyricLock);
        document.getElementById('playbackMatchBtn')?.addEventListener('click', runPlaybackMatchTest);
        document.getElementById('playbackSearchBtn')?.addEventListener('click', runPlaybackSearch);
        document.getElementById('playbackSearchKeyword')?.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') runPlaybackSearch();
        });

        // 点歌确认悬浮通知按钮
        document.getElementById('pendingConfirmAcceptBtn')?.addEventListener('click', () => handlePlaybackPendingAction('confirm', 0));
        document.getElementById('pendingConfirmRejectBtn')?.addEventListener('click', () => handlePlaybackPendingAction('ignore', 0));
        document.querySelectorAll('[data-playback-home-action]').forEach((button) => {
          button.addEventListener('click', () => {
            loadPlaybackHomeContent(button.dataset.playbackHomeAction || 'personalized');
          });
        });

        // 队列弹窗事件
        document.getElementById('playbackQueueBtn')?.addEventListener('click', toggleQueuePopup);
        document.getElementById('queuePopupClose')?.addEventListener('click', closeQueuePopup);
        document.getElementById('queuePopupBackdrop')?.addEventListener('click', closeQueuePopup);

        // 抽屉事件
        document.getElementById('playbackDrawerBackdrop')?.addEventListener('click', closePlaybackDrawer);
        document.getElementById('playbackDrawerClose')?.addEventListener('click', closePlaybackDrawer);
        document.getElementById('playbackDrawerBack')?.addEventListener('click', playbackDrawerGoBack);
        document.getElementById('playbackDrawerRefresh')?.addEventListener('click', refreshPlaybackHomeContent);

        // 抽屉底部按钮 - 事件委托
        document.getElementById('playbackDrawerActions')?.addEventListener('click', (event) => {
          const target = event.target;
          if (target.id === 'playbackDrawerPlayAll') handlePlaybackHomeBulkAction('play-all');
          else if (target.id === 'playbackDrawerShuffleAll') handlePlaybackHomeBulkAction('shuffle-all');
        });

        // 抽屉内点击事件委托
        document.getElementById('playbackDrawerBody')?.addEventListener('click', (event) => {
          const bulkButton = event.target.closest('[data-playback-home-bulk]');
          if (bulkButton) {
            handlePlaybackHomeBulkAction(bulkButton.dataset.playbackHomeBulk);
            return;
          }

          const playlistButton = event.target.closest('[data-playback-playlist-index]');
          if (playlistButton) {
            loadPlaybackPlaylistTracks(Number(playlistButton.dataset.playbackPlaylistIndex));
            return;
          }

          const trackButton = event.target.closest('[data-playback-home-track-action][data-playback-home-track-index]');
          if (!trackButton) return;
          handlePlaybackHomeTrackAction(
            trackButton.dataset.playbackHomeTrackAction,
            Number(trackButton.dataset.playbackHomeTrackIndex)
          );
        });

        document.querySelectorAll('.source-tab').forEach((button) => {
          button.addEventListener('click', () => {
            playbackState.selectedSource = button.dataset.source === 'netease' ? 'netease' : 'qq';
            playbackAuthState = null;
            playbackProviderHealth = null;
            searchService.clearResults();
            homeService.clearHomeState();
            savePlaybackState();
            renderPlayback();
            renderPlaybackSearchResults();
            closePlaybackDrawer();
            refreshSelectedMusicProviderState();
          });
        });

        document.getElementById('playbackSearchResults')?.addEventListener('click', (event) => {
          const button = event.target.closest('[data-playback-search-action][data-playback-search-index]');
          if (!button) return;
          handlePlaybackSearchAction(
            button.dataset.playbackSearchAction,
            Number(button.dataset.playbackSearchIndex)
          );
        });

        document.getElementById('playbackQueueList')?.addEventListener('click', (event) => {
          const clearHistBtn = event.target.closest('[data-playback-clear-display-history]');
          if (clearHistBtn) {
            playbackState.displayHistory = [];
            savePlaybackState();
            renderPlayback();
            return;
          }

          const pendingButton = event.target.closest('[data-playback-pending-action][data-playback-pending-index]');
          if (pendingButton) {
            handlePlaybackPendingAction(
              pendingButton.dataset.playbackPendingAction,
              Number(pendingButton.dataset.playbackPendingIndex)
            );
            return;
          }

          const playlistJumpBtn = event.target.closest('[data-playback-playlist-jump]');
          if (playlistJumpBtn) {
            jumpToPlaylistTrack(Number(playlistJumpBtn.dataset.playbackPlaylistJump));
            return;
          }

          const button = event.target.closest('[data-playback-queue][data-playback-index]');
          if (!button) return;
          const picked = takePlaybackQueueTrack(button.dataset.playbackQueue, Number(button.dataset.playbackIndex));
          if (picked) {
            playPlaybackTrack(picked.track, { origin: picked.origin });
          }
        });

        document.getElementById('playbackModeBtn')?.addEventListener('click', () => {
          playbackState.mode = PlaybackUtils.getNextMode(playbackState.mode);
          rebuildPlaybackShuffleOrder();
          savePlaybackState();
          renderPlayback();
        });

        document.getElementById('playbackVolume')?.addEventListener('input', (event) => {
          playbackState.volume = Math.max(0, Math.min(1, Number(event.target.value)));
          audio.volume = playbackState.volume;
          PlaybackComponents.updateVolumeUI(playbackState.volume);
          savePlaybackState();
        });

        document.getElementById('playbackVolumeIcon')?.addEventListener('click', () => {
          if (playbackState.volume > 0) {
            playbackState._mutedVolume = playbackState.volume;
            playbackState.volume = 0;
          } else {
            playbackState.volume = playbackState._mutedVolume > 0 ? playbackState._mutedVolume : 0.75;
          }
          audio.volume = playbackState.volume;
          const volSlider = document.getElementById('playbackVolume');
          if (volSlider) volSlider.value = String(playbackState.volume);
          PlaybackComponents.updateVolumeUI(playbackState.volume);
          savePlaybackState();
        });

        document.getElementById('playbackSeek')?.addEventListener('input', (event) => {
          if (!Number.isFinite(audio.duration)) return;
          audio.currentTime = Math.max(0, Math.min(audio.duration, Number(event.target.value)));
          const pct = audio.duration > 0 ? Math.round((audio.currentTime / audio.duration) * 1000) / 10 : 0;
          event.target.style.setProperty('--seek-pos', pct + '%');
          renderFullscreenPlayer();
          syncPlaybackLyricWindow();
          savePlaybackState();
        });

        audio.addEventListener('loadedmetadata', () => {
          const track = playbackState.current;
          if (track && Number.isFinite(audio.duration)) {
            track.durationMs = Math.round(audio.duration * 1000);
          }
          renderPlayback();
          savePlaybackState();
          syncPlaybackLyricWindow();
        });
        audio.addEventListener('timeupdate', () => {
          renderPlaybackProgress();
          savePlaybackState();
          syncPlaybackLyricWindow();
          renderFullscreenPlayer();
        });
        audio.addEventListener('play', () => {
          renderPlayback();
          updatePlaybackMediaSession();
          syncPlaybackLyricWindow();
        });
        audio.addEventListener('pause', () => {
          renderPlayback();
          updatePlaybackMediaSession();
          syncPlaybackLyricWindow();
        });
        audio.addEventListener('ended', () => playbackNext(true));
        audio.addEventListener('error', () => handlePlaybackError());
        window.addEventListener('pagehide', flushPlaybackStateOnUnload);

        renderPlayback();
        refreshSelectedMusicProviderState();
        refreshPlaybackMusicCacheStats();
      }

      async function refreshSelectedMusicProviderState() {
        await Promise.all([
          providerManager.refreshAuthState(),
          providerManager.checkProviderHealth({ silent: true })
        ]);
        playbackAuthState = providerManager.getAuthState();
        playbackProviderHealth = providerManager.getProviderHealth();
        renderPlayback();
      }

      async function refreshSelectedMusicAuthState() {
        await providerManager.refreshAuthState();
        return providerManager.getAuthState();
      }

      async function checkSelectedMusicProviderHealth(options = {}) {
        try {
          if (window.musicAPI && typeof window.musicAPI.providerHealth === 'function') {
            playbackProviderHealth = await window.musicAPI.providerHealth(playbackState.selectedSource);
          } else {
            const response = await fetch(`/api/music/health?platform=${encodeURIComponent(playbackState.selectedSource)}`);
            const payload = await readJsonResponse(response, '检查音乐接口失败');
            if (!payload.ok) throw new Error(payload.error || '检查音乐接口失败');
            playbackProviderHealth = payload.data;
          }
          if (!options.silent) toast(playbackProviderHealth.message || '音乐接口检查完成');
        } catch (error) {
          playbackProviderHealth = {
            source: playbackState.selectedSource,
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
          toast('登录窗口已关闭，Cookie 状态已刷新');
        } catch (error) {
          showError(error);
        } finally {
          if (button) button.disabled = false;
        }
      }

      async function logoutSelectedMusicProvider() {
        if (!window.musicAPI || typeof window.musicAPI.logout !== 'function') {
          toast('退出音乐账号需要在桌面版里使用');
          return;
        }
        const sourceName = PlaybackUtils.getSourceName(playbackState.selectedSource);
        if (!confirm(`确认退出${sourceName}登录？`)) return;

        try {
          const platform = playbackState.selectedSource;
          await window.musicAPI.logout(playbackState.selectedSource);
          // 清除前端状态
          playbackAuthState = null;
          clearPlaybackPlatformAfterLogout(platform);
          // 重新从后端获取最新状态，确保前后端同步
          await refreshSelectedMusicProviderState();
          toast(`${sourceName}已退出登录`);
        } catch (error) {
          showError(error);
          // 即使出错也要尝试刷新状态
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
        // 检查是否已登录
        if (!playbackAuthState || !playbackAuthState.loggedIn) {
          toast('请先登录播放器');
          return;
        }

        if (action === 'recent') {
          loadPlaybackLocalRecentHistory();
          return;
        }

        const actionName = HomeService.getActionName(action);
        openPlaybackDrawer(actionName, '正在加载...', true);

        // 高亮对应卡片
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

      function updateDrawerActions(showPlayAll, action = '') {
        uiRenderer.getDrawer().updateActions(showPlayAll, action);
      }

      function setPlaybackDrawerLoading(message) {
        uiRenderer.getDrawer().setLoading(message);
      }

      function setPlaybackDrawerError(message) {
        uiRenderer.getDrawer().setError(message);
      }

      // ===== 队列弹窗 =====
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

      function openPlaybackDrawer(title, subtitle, loading) {
        uiRenderer.getDrawer().open(title, subtitle, loading);
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

      function handlePlaybackHomeTrackAction(action, index) {
        const track = homeService.getItemByIndex(index);
        if (!track) return;

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

      async function runPlaybackSearch() {
        const keyword = value('playbackSearchKeyword');
        const resultNode = document.getElementById('playbackSearchResults');

        if (resultNode) resultNode.textContent = '正在搜索...';
        try {
          const limit = Number(value('playbackSearchLimit') || 12);
          await searchService.search(keyword, limit);
          renderPlaybackSearchResults();
        } catch (error) {
          if (resultNode) resultNode.textContent = error.message || String(error);
        }
      }

      function renderPlaybackSearchResults() {
        const resultNode = document.getElementById('playbackSearchResults');
        if (!resultNode) return;

        const searchResults = searchService.getResults();
        if (!searchResults.length) {
          resultNode.innerHTML = playbackState.selectedSource === 'netease'
            ? '输入关键词后可搜索网易云音乐。'
            : 'QQ 音乐 Provider 尚未接入，当前只保留登录验证。';
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
            </div>
          </div>
        `).join('');
      }

      function handlePlaybackSearchAction(action, index) {
        const track = searchService.getResultByIndex(index);
        if (!track) return;
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

      async function togglePlaybackLyricWindow() {
        try {
          const newState = await lyricService.toggleWindow();
          if (newState) {
            await syncPlaybackLyricWindow(true);
          }
          renderPlayback();
        } catch (error) {
          showError(error);
        }
      }

      async function togglePlaybackLyricLock() {
        try {
          await lyricService.toggleWindowLock();
          renderPlayback();
        } catch (error) {
          showError(error);
        }
      }

      async function syncPlaybackLyricWindow(force = false) {
        const audio = getPlaybackAudio();
        const track = playbackState.current || null;
        const changed = await lyricService.syncWindow(track, audio, force);
        if (changed) renderPlayback();
      }

      function getPlaybackAudio() {
        return document.getElementById('music-player');
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

      /** 读取服务端保存的播放状态；若服务端没有数据，尝试从旧版 localStorage 迁移一次。 */
      async function loadSavedPlaybackPayload() {
        try {
          const response = await fetch(`/api/playback/queue-state?clientId=${encodeURIComponent(playbackClientId)}`);
          const payload = await readJsonResponse(response, '读取播放状态失败');
          if (payload.ok && payload.data && payload.data.payload) {
            return payload.data.payload;
          }
        } catch (_) {
          // 服务不可用时退回本地缓存，不阻塞播放器初始化
        }

        try {
          const raw = localStorage.getItem(playbackStorageKey);
          if (!raw) return null;
          const legacy = JSON.parse(raw);
          schedulePlaybackStateSave(legacy);
          localStorage.removeItem(playbackStorageKey);
          return legacy;
        } catch (_) {
          return null;
        }
      }

      async function restorePlaybackState() {
        try {
          const saved = await loadSavedPlaybackPayload();
          if (!saved) return;
          playbackState.current = saved.current ? PlaybackUtils.normalizeSavedTrack(saved.current) : null;
          playbackState.currentOrigin = ['requested', 'normal', 'radio', 'history'].includes(saved.currentOrigin) ? saved.currentOrigin : '';
          playbackState.requestedQueue = Array.isArray(saved.requestedQueue)
            ? saved.requestedQueue.map(PlaybackUtils.normalizeSavedTrack)
            : [];
          playbackState.normalQueue = Array.isArray(saved.normalQueue)
            ? saved.normalQueue.map(PlaybackUtils.normalizeSavedTrack)
            : (Array.isArray(saved.tracks) ? saved.tracks.map(PlaybackUtils.normalizeSavedTrack) : []);
          playbackState.normalQueueTracks = Array.isArray(saved.normalQueueTracks)
            ? saved.normalQueueTracks.map(PlaybackUtils.normalizeSavedTrack)
            : [];
          playbackState.radioQueue = Array.isArray(saved.radioQueue)
            ? saved.radioQueue.map(PlaybackUtils.normalizeSavedTrack)
            : [];
          playbackState.pendingRequests = Array.isArray(saved.pendingRequests)
            ? saved.pendingRequests.map(PlaybackUtils.normalizeSavedPendingRequest).filter(Boolean)
            : [];
          if (!playbackState.current && Number.isInteger(saved.currentIndex) && saved.currentIndex >= 0) {
            playbackState.current = playbackState.normalQueue[saved.currentIndex] || null;
            playbackState.currentOrigin = playbackState.current ? 'normal' : '';
          }
          const savedQueueType = ['playlist', 'radio', 'queue'].includes(saved.queueType)
            ? saved.queueType
            : '';
          playbackState.queueType = savedQueueType
            || (playbackState.normalQueueTracks.length > 0
              ? 'playlist'
              : (playbackState.currentOrigin === 'radio' && playbackState.normalQueue.length === 0
                ? 'radio'
                : 'queue'));
          if (playbackState.queueType === 'playlist' && playbackState.normalQueueTracks.length === 0) {
            playbackState.queueType = 'queue';
          }
          playbackState.queueTitle = String(saved.queueTitle || '').trim()
            || (playbackState.queueType === 'radio'
              ? '电台队列'
              : (playbackState.queueType === 'playlist' ? '歌单队列' : '播放队列'));

          const prioritizedTracks = playbackState.requestedQueue;
          playbackState.requestedQueue = [];
          if (playbackState.queueType === 'playlist') {
            const derivedIndex = playbackState.normalQueueTracks.length - playbackState.normalQueue.length - 1;
            const matchingIndex = playbackState.current
              ? playbackState.normalQueueTracks.findIndex((track) => track.id === playbackState.current.id)
              : -1;
            const restoredIndex = Number.isInteger(saved.playlistIndex)
              ? saved.playlistIndex
              : (derivedIndex >= 0 ? derivedIndex : matchingIndex);
            playbackState.playlistIndex = Math.max(0, Math.min(
              playbackState.normalQueueTracks.length - 1,
              restoredIndex
            ));
            if (prioritizedTracks.length > 0) {
              playbackState.normalQueueTracks.splice(
                playbackState.playlistIndex + 1,
                0,
                ...prioritizedTracks.map((track) => ({ ...track }))
              );
              playbackState.normalQueue.unshift(...prioritizedTracks);
            }
            playbackState.radioQueue = [];
            if (playbackState.current && playbackState.currentOrigin !== 'history') {
              playbackState.currentOrigin = 'normal';
            }
          } else if (playbackState.queueType === 'radio') {
            playbackState.radioQueue.unshift(...prioritizedTracks);
            playbackState.normalQueue = [];
            playbackState.normalQueueTracks = [];
            playbackState.playlistIndex = -1;
            if (playbackState.current && playbackState.currentOrigin !== 'history') {
              playbackState.currentOrigin = 'radio';
            }
          } else {
            playbackState.normalQueue.unshift(...prioritizedTracks);
            playbackState.normalQueueTracks = [];
            playbackState.radioQueue = [];
            playbackState.playlistIndex = -1;
            if (playbackState.current && playbackState.currentOrigin !== 'history') {
              playbackState.currentOrigin = 'normal';
            }
          }
          playbackState.history = Array.isArray(saved.history) ? saved.history.map(PlaybackUtils.normalizeSavedTrack) : [];
          playbackState.displayHistory = Array.isArray(saved.displayHistory) ? saved.displayHistory.map(PlaybackUtils.normalizeSavedTrack) : [];
          playbackState.mode = ['sequence', 'shuffle', 'repeat-one'].includes(saved.mode) ? saved.mode : 'sequence';
          playbackState.volume = Math.max(0, Math.min(1, Number(saved.volume ?? 0.75)));
          playbackState.selectedSource = saved.selectedSource === 'netease' ? 'netease' : 'qq';
          playbackState.restoredTime = Math.max(0, Number(saved.currentTime || 0));
        } catch (_) {
          playbackState.current = null;
          playbackState.requestedQueue = [];
          playbackState.normalQueue = [];
          playbackState.normalQueueTracks = [];
          playbackState.radioQueue = [];
          playbackState.queueType = 'queue';
          playbackState.queueTitle = '播放队列';
          playbackState.playlistIndex = -1;
          playbackState.pendingRequests = [];
        }
      }

      function savePlaybackState() {
        const audio = getPlaybackAudio();
        const serialize = (track) => track ? ({
          id: track.id,
          source: track.source,
          title: track.title,
          artists: track.artists,
          album: track.album,
          coverUrl: track.coverUrl || '',
          durationMs: track.durationMs,
          fileName: track.fileName,
          sourceTrackId: track.sourceTrackId,
          sourceAlbumId: track.sourceAlbumId,
          playable: track.playable,
          vip: track.vip,
          unavailable: track.source === 'local' && !track.objectUrl,
          playedAt: track.playedAt || 0
        }) : null;
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
          currentTime: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : playbackState.restoredTime,
          volume: playbackState.volume,
          mode: playbackState.mode,
          selectedSource: playbackState.selectedSource,
          history: playbackState.history.slice(-50).map(serialize).filter(Boolean),
          displayHistory: playbackState.displayHistory.slice(0, 200).map(serialize).filter(Boolean)
        };
        schedulePlaybackStateSave(payload);
      }

      /** 播放状态改为服务端持久化（/api/playback/queue-state），debounce 避免 timeupdate 高频请求打爆接口。 */
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
        }).catch(() => {
          // 播放状态保存失败不影响播放，下次保存会覆盖。
        });
      }

      /** 页面隐藏/关闭时用 sendBeacon 尽力保存最后一次状态，fetch 在此时可能被浏览器中止。 */
      function flushPlaybackStateOnUnload() {
        if (!playbackStateSavePending) return;
        const payload = playbackStateSavePending;
        playbackStateSavePending = null;
        if (playbackStateSaveTimer) {
          clearTimeout(playbackStateSaveTimer);
          playbackStateSaveTimer = null;
        }
        const body = JSON.stringify({ clientId: playbackClientId, payload });
        if (navigator.sendBeacon) {
          const blob = new Blob([body], { type: 'application/json' });
          navigator.sendBeacon('/api/playback/queue-state', blob);
        } else {
          fetch('/api/playback/queue-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true
          }).catch(() => {});
        }
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

      async function togglePlayback() {
        const audio = getPlaybackAudio();
        if (!audio) return;

        if (!playbackState.current) {
          const next = takeNextPlaybackTrack();
          if (next) {
            playbackState.current = next.track;
            playbackState.currentOrigin = next.origin;
          }
        }

        const track = playbackState.current;
        if (!track) {
          toast('请先添加本地音频');
          return;
        }

        if (!audio.src || audio.dataset.trackId !== track.id) {
          await playPlaybackTrack(track, { origin: playbackState.currentOrigin, startAt: playbackState.restoredTime });
          return;
        }

        if (audio.paused) {
          try {
            await audio.play();
          } catch (error) {
            showError(error);
          }
        } else {
          audio.pause();
        }
        renderPlayback();
      }

      async function playPlaybackTrack(track, options = {}) {
        const audio = getPlaybackAudio();
        if (!audio || !track) return;

        let streamUrl = '';
        try {
          streamUrl = await getPlaybackTrackUrl(track, {
            forceRefresh: options.forceRefresh === true
          });
        } catch (error) {
          showError(error);
          renderPlayback();
          return;
        }
        if (!streamUrl) {
          playbackState.current = track;
          playbackState.currentOrigin = options.origin || playbackState.currentOrigin || 'normal';
          renderPlayback();
          return;
        }

        if (!options.isRetry) streamService.resetRetryCount();
        if (playbackState.current && playbackState.current.id !== track.id && !options.fromHistory) {
          playbackState.history.push(playbackState.current);
          playbackState.history = playbackState.history.slice(-50);
        }
        // 更新展示用播放历史（200首，去重，最新置顶）
        if (!options.fromHistory) {
          playbackState.displayHistory = [
            { ...track, playedAt: Date.now() },
            ...playbackState.displayHistory.filter((t) => t.id !== track.id)
          ].slice(0, 200);
        }

        playbackState.current = track;
        playbackState.currentOrigin = options.origin || playbackState.currentOrigin || 'normal';
        playbackState.restoredTime = 0;
        audio.dataset.trackId = track.id;
        audio.src = streamUrl;
        audio.load();

        const startAt = Math.max(0, Number(options.startAt || 0));
        if (startAt > 0) {
          audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(audio.duration)) {
              audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 1));
            }
          }, { once: true });
        }

        try {
          await audio.play();
        } catch (error) {
          showError(error);
        }
        loadPlaybackLyrics(track);
        savePlaybackState();
        renderPlayback();
        updatePlaybackMediaSession();
      }

      async function loadPlaybackLyrics(track) {
        if (!track) return;
        const lyrics = await lyricService.loadLyrics(track);
        if (lyrics && playbackState.current && playbackState.current.id === track.id) {
          playbackState.current.lyrics = lyrics;
          syncPlaybackLyricWindow(true);
        }
      }

      async function getPlaybackTrackUrl(track, options = {}) {
        return await streamService.getTrackUrl(track, options);
      }

      async function handlePlaybackError() {
        const track = playbackState.current;
        const audio = getPlaybackAudio();

        await streamService.handlePlaybackError(
          track,
          audio,
          (track, resumeAt) => {
            // 重试成功回调
            playPlaybackTrack(track, {
              origin: playbackState.currentOrigin,
              forceRefresh: true,
              isRetry: true,
              startAt: resumeAt
            });
          },
          () => {
            // 重试失败回调
            playbackNext(false);
          }
        );
      }

      function playbackPrevious() {
        const audio = getPlaybackAudio();
        if (!audio) return;
        if (audio.currentTime > 5) {
          audio.currentTime = 0;
          return;
        }
        const previousTrack = playbackState.history.pop();
        if (previousTrack) {
          playPlaybackTrack(previousTrack, { fromHistory: true, origin: 'history' });
        }
      }

      function playbackNext(fromEnded) {
        const audio = getPlaybackAudio();
        if (!audio) return;

        if (playbackState.mode === 'repeat-one' && playbackState.current) {
          playPlaybackTrack(playbackState.current, { origin: playbackState.currentOrigin });
          return;
        }

        const next = takeNextPlaybackTrack();
        if (next) {
          playPlaybackTrack(next.track, { origin: next.origin });
          if (playbackState.queueType === 'radio') ensurePlaybackRadioQueueFilled();
          return;
        }

        // 固定歌单按当前模式循环；临时插入的歌曲也已经写入完整歌单。
        if (playbackState.queueType === 'playlist' && playbackState.normalQueueTracks.length > 0) {
          const tracks = playbackState.mode === 'shuffle'
            ? PlaybackUtils.shuffleTracks(playbackState.normalQueueTracks)
            : playbackState.normalQueueTracks.map((track) => ({ ...track }));
          const first = tracks[0];
          playbackState.normalQueue = tracks.slice(1);
          playbackState.playlistIndex = playbackState.normalQueueTracks.findIndex((track) => track.id === first.id);
          rebuildPlaybackShuffleOrder();
          savePlaybackState();
          playPlaybackTrack(first, { origin: 'normal' });
          return;
        }

        if (fromEnded) {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        }
        renderPlayback();
        savePlaybackState();
        syncPlaybackLyricWindow();
        if (playbackState.queueType === 'radio') ensurePlaybackRadioQueueFilled();
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

      async function ensurePlaybackRadioQueueFilled() {
        if (playbackState.queueType !== 'radio') return;
        if (playbackRadioRefillRunning) return;
        if (playbackState.radioQueue.length >= playbackRadioRefillThreshold) return;
        playbackRadioRefillRunning = true;
        try {
          const response = await fetch('/api/music/home', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: playbackState.selectedSource,
              action: 'radio',
              limit: playbackRadioRefillBatchSize
            })
          });
          const payload = await readJsonResponse(response, '补充电台队列失败');
          if (!response.ok || !payload.ok) throw new Error(payload.error || '补充电台队列失败');
          if (playbackState.queueType !== 'radio') return;
          const tracks = Array.isArray(payload.data && payload.data.tracks)
            ? payload.data.tracks.map(PlaybackUtils.normalizeOnlineTrack)
            : [];
          const recentIds = new Set(playbackState.history.slice(-30).map((track) => track.id));
          for (const track of tracks) {
            if (recentIds.has(track.id)) continue;
            if (playbackState.radioQueue.some((item) => item.id === track.id)) continue;
            playbackState.radioQueue.push(track);
          }
          savePlaybackState();
          renderPlayback();
        } catch (error) {
          console.warn('[playback] radio refill failed:', error.message || error);
        } finally {
          playbackRadioRefillRunning = false;
        }
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

      function renderPlayback() {
        const audio = getPlaybackAudio();

        // 获取歌词服务的窗口状态
        const lyricWindowState = lyricService.getWindowState();

        // 使用 UI 渲染器渲染所有界面
        uiRenderer.renderAll(playbackState, audio, {
          lyric: lyricWindowState
        });

        // 渲染音乐源状态
        uiRenderer.renderProviderState(
          playbackAuthState,
          playbackProviderHealth,
          playbackState.selectedSource
        );

        // 渲染搜索结果和待确认弹窗
        renderPlaybackSearchResults();
        renderPendingConfirmPopup();
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

      function renderPlaybackQueue() {
        uiRenderer.getQueuePopup().render(playbackState);
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

      function renderPlaybackDisplayHistorySection() {
        const tracks = playbackState.displayHistory;
        if (!tracks.length) return '';
        const clearBtn = `<button type="button" class="link-btn" data-playback-clear-display-history style="font-size:11px;color:var(--text-muted);">清空</button>`;
        const rows = tracks.map((track) => PlaybackComponents.renderQueueRow(track, 'history', -1, true, playbackState.current, playbackState.currentOrigin)).join('');
        return `
          <section class="playback-queue-section">
            <h3>播放历史 <span>${tracks.length}</span>${clearBtn}</h3>
            ${rows}
          </section>
        `;
      }

      function renderPlaybackPendingSection() {
        if (!playbackState.pendingRequests.length) return '';
        return `
          <section class="playback-queue-section">
            <h3>待确认点歌 <span>${playbackState.pendingRequests.length}</span></h3>
            ${playbackState.pendingRequests.map((item, index) => PlaybackComponents.renderPendingRow(item, index)).join('')}
          </section>
        `;
      }

      function handlePlaybackPendingAction(action, index) {
        if (action === 'confirm') {
          const track = matchService.confirmPendingRequest(index);
          if (track) {
            insertPlaybackTracksNext([track]);
            toast('已确认并插入当前歌曲之后');
          }
        } else {
          const success = matchService.ignorePendingRequest(index);
          if (success) {
            toast('已忽略待确认点歌');
          }
        }
        savePlaybackState();
        renderPlayback();
      }

      function playbackQueueTotalCount() {
        return queueManager.getTotalCount();
      }

      function renderPlaybackProgress() {
        const audio = getPlaybackAudio();
        uiRenderer.renderProgress(audio, playbackState.restoredTime);
        uiRenderer.updateMediaSessionPosition(audio);
      }

      function updatePlaybackMediaSession() {
        const audio = getPlaybackAudio();
        uiRenderer.updateMediaSession(playbackState.current, audio, {
          onTogglePlayback: togglePlayback,
          onPrevious: playbackPrevious,
          onNext: () => playbackNext(false)
        });
      }

      function updatePlaybackMediaSessionPosition() {
        const audio = getPlaybackAudio();
        uiRenderer.updateMediaSessionPosition(audio);
      }

      function renderFullscreenPlayer() {
        const audio = getPlaybackAudio();
        uiRenderer.getFullscreenPlayer().render(playbackState.current, audio);
      }

      function handleFullscreenLyricClick(event) {
        const lineEl = event.target.closest('.player-fs-lyric-line');
        if (!lineEl) return;

        const startMs = Number(lineEl.dataset.lyricStartMs);
        if (!Number.isFinite(startMs) || startMs < 0) return;

        const audio = getPlaybackAudio();
        if (!audio) return;

        audio.currentTime = startMs / 1000;
        if (audio.paused) {
          audio.play().catch((error) => {
            console.warn('[playback] play after seek failed:', error);
          });
        }

        renderPlaybackProgress();
        savePlaybackState();
      }

    updateContext(initialOptions);

    function updateContext(options = {}) {
      getSongs = typeof options.getSongs === 'function' ? options.getSongs : getSongs;
      reloadSongs = typeof options.reloadSongs === 'function' ? options.reloadSongs : reloadSongs;
      toast = typeof options.toast === 'function' ? options.toast : toast;
      showError = typeof options.showError === 'function' ? options.showError : showError;
      api = typeof options.api === 'function' ? options.api : api;
      readJsonResponse = typeof options.readJsonResponse === 'function' ? options.readJsonResponse : readJsonResponse;
    }

    return {
      init,
      updateContext
    };
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.playback = {
    initPlaybackAssistant
  };

  // 模块加载完成后触发自定义事件，通知 main.js 可以初始化了
  if (typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('playback-module-loaded'));
  }
})();
