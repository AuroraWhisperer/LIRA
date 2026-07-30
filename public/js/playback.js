// 编写人：Aurora
// 播放助手模块。挂载到 window.AdminApp.playback
'use strict';

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

      const playbackStorageKey = 'songAssistantPlaybackState:v1'; // 仅用于旧数据一次性迁移
      const playbackClientId = 'default';
      const playbackStateSaveDebounceMs = 1500;
      let playbackStateSaveTimer = null;
      let playbackStateSavePending = null;
      const playbackStreamRefreshMarginMs = 30 * 1000;
      const playbackStreamMaxRetries = 1;
      const playbackRadioRefillThreshold = 3;
      const playbackRadioRefillBatchSize = 10;
      const playbackState = {
        current: null,
        currentOrigin: '',
        requestedQueue: [],
        normalQueue: [],
        normalQueueTracks: [],  // 完整歌单备份，用于循环重播
        radioQueue: [],
        queueType: 'queue',
        queueTitle: '播放队列',
        playlistIndex: -1,
        pendingRequests: [],
        history: [],
        displayHistory: [],
        mode: 'sequence',
        volume: 0.75,
        selectedSource: 'qq',
        shuffleOrder: [],
        shuffleCursor: 0,
        restoredTime: 0
      };
      let playbackStreamRetryCount = 0;
      let playbackAuthState = null;
      let playbackProviderHealth = null;
      let playbackSearchResults = [];
      let playbackHomeItems = [];
      let playbackHomeItemType = '';
      let playbackHomeAction = '';
      let playbackHomePage = 1;
      let playbackLyricWindowOpen = false;
      let playbackLyricWindowLocked = false;
      let playbackRadioRefillRunning = false;
      let playbackInitialized = false;
      let playbackDrawerHistory = [];
      let queuePopupOpen = false;
      async function init(options = {}) {
        updateContext(options);
        if (playbackInitialized) return;
        playbackInitialized = true;
        const audio = getPlaybackAudio();
        if (!audio) {
          playbackInitialized = false;
          return;
        }

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

        // 抽屉底部按钮 - 事件委托
        document.getElementById('playbackDrawerActions')?.addEventListener('click', (event) => {
          const target = event.target;
          if (target.id === 'playbackDrawerPlayAll') handlePlaybackHomeBulkAction('play-all');
          else if (target.id === 'playbackDrawerShuffleAll') handlePlaybackHomeBulkAction('shuffle-all');
          else if (target.id === 'playbackDrawerRefresh') refreshPlaybackHomeContent();
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
            playbackSearchResults = [];
            playbackHomeItems = [];
            playbackHomeItemType = '';
            playbackHomeAction = '';
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
          const modes = ['sequence', 'shuffle', 'repeat-one'];
          const idx = modes.indexOf(playbackState.mode);
          playbackState.mode = modes[(idx + 1) % modes.length];
          rebuildPlaybackShuffleOrder();
          savePlaybackState();
          renderPlayback();
        });

        document.getElementById('playbackVolume')?.addEventListener('input', (event) => {
          playbackState.volume = Math.max(0, Math.min(1, Number(event.target.value)));
          audio.volume = playbackState.volume;
          updatePlaybackVolumeUI();
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
          updatePlaybackVolumeUI();
          savePlaybackState();
        });

        document.getElementById('playbackSeek')?.addEventListener('input', (event) => {
          if (!Number.isFinite(audio.duration)) return;
          audio.currentTime = Math.max(0, Math.min(audio.duration, Number(event.target.value)));
          const pct = audio.duration > 0 ? Math.round((audio.currentTime / audio.duration) * 1000) / 10 : 0;
          event.target.style.setProperty('--seek-pos', pct + '%');
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
          refreshSelectedMusicAuthState(),
          checkSelectedMusicProviderHealth({ silent: true })
        ]);
        renderPlayback();
      }

      async function refreshSelectedMusicAuthState() {
        if (!window.musicAPI || typeof window.musicAPI.getAuthState !== 'function') {
          playbackAuthState = {
            platform: playbackState.selectedSource,
            loggedIn: false,
            cookieCount: 0,
            keyCookieNames: [],
            encryptedSnapshotExists: false,
            desktopUnavailable: true
          };
          return playbackAuthState;
        }

        try {
          playbackAuthState = await window.musicAPI.getAuthState(playbackState.selectedSource);
        } catch (error) {
          playbackAuthState = {
            platform: playbackState.selectedSource,
            loggedIn: false,
            cookieCount: 0,
            keyCookieNames: [],
            encryptedSnapshotExists: false,
            error: error.message || String(error)
          };
        }
        return playbackAuthState;
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
        const sourceName = selectedPlaybackSourceName();
        if (!confirm(`确认退出${sourceName}登录？`)) return;

        try {
          const platform = playbackState.selectedSource;
          playbackAuthState = await window.musicAPI.logout(playbackState.selectedSource);
          clearPlaybackPlatformAfterLogout(platform);
          await checkSelectedMusicProviderHealth({ silent: true });
          toast(`${sourceName}已退出登录`);
        } catch (error) {
          showError(error);
        }
        renderPlayback();
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

      function selectedPlaybackSourceName() {
        return playbackState.selectedSource === 'netease' ? '网易云音乐' : 'QQ音乐';
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
        const tracks = playbackState.displayHistory;
        playbackHomeItems = tracks.slice();
        playbackHomeItemType = 'track';
        playbackHomeAction = 'recent';
        openPlaybackDrawer('播放历史', `${tracks.length} 首`, false);
        const body = document.getElementById('playbackDrawerBody');
        if (!body) return;
        if (!tracks.length) {
          body.innerHTML = '<p class="hint" style="text-align:center;padding:40px 0;">暂无播放记录</p>';
          updateDrawerActions(false);
          return;
        }
        body.innerHTML = tracks.map((track, index) => `
          <div class="queue-row playback-home-row">
            <div class="playback-row-main">
              ${renderPlaybackArtwork(track)}
              <div>
                <div class="song">${escapeHtml(track.title || '')}</div>
                <div class="meta">${escapeHtml(formatPlaybackTrackMeta(track))}</div>
              </div>
            </div>
            <div class="queue-actions">
              <button type="button" data-playback-home-track-action="normal" data-playback-home-track-index="${index}">入队</button>
              <button type="button" data-playback-home-track-action="requested" data-playback-home-track-index="${index}">插队</button>
              <button type="button" data-playback-home-track-action="radio" data-playback-home-track-index="${index}">电台</button>
              <button type="button" data-playback-home-track-action="play" data-playback-home-track-index="${index}">播放</button>
            </div>
          </div>
        `).join('');
        updateDrawerActions(true);
      }

      async function loadPlaybackHomeContent(action) {
        if (action === 'recent') {
          loadPlaybackLocalRecentHistory();
          return;
        }
        const actionNames = {
          personalized: '为你推荐', daily: '每日推荐', radio: '心动 / 电台',
          liked: '我喜欢', 'created-playlists': '我的歌单',
          'collected-playlists': '收藏歌单', recent: '最近播放'
        };
        playbackHomePage = 1;
        openPlaybackDrawer(actionNames[action] || '浏览内容', '正在加载...', true);
        // 高亮对应卡片
        document.querySelectorAll('[data-playback-home-action]').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.playbackHomeAction === action);
        });
        try {
          const response = await fetch('/api/music/home', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: playbackState.selectedSource,
              action,
              limit: action === 'personalized' ? 12 : 30,
              page: 1
            })
          });
          const payload = await readJsonResponse(response, '加载音乐内容失败');
          if (!response.ok || !payload.ok) throw new Error(payload.error || '加载音乐内容失败');
          const data = payload.data || {};
          playbackHomeItems = Array.isArray(data.playlists)
            ? data.playlists
            : (Array.isArray(data.tracks) ? data.tracks : []);
          playbackHomeItemType = Array.isArray(data.playlists) ? 'playlist' : 'track';
          playbackHomeAction = data.action || action;
          renderPlaybackHomeResults(playbackHomeAction);
        } catch (error) {
          playbackHomeItems = [];
          playbackHomeItemType = '';
          playbackHomeAction = '';
          playbackHomePage = 1;
          setPlaybackDrawerError(error.message || String(error));
          showError(error);
        }
      }

      async function loadPlaybackPlaylistTracks(index) {
        const playlist = playbackHomeItems[index];
        if (!playlist) return;
        // 保存当前状态用于返回
        playbackDrawerHistory.push({
          items: playbackHomeItems,
          itemType: playbackHomeItemType,
          action: playbackHomeAction,
          page: playbackHomePage,
          title: document.getElementById('playbackDrawerTitle')?.textContent || ''
        });
        setPlaybackDrawerLoading(`正在打开歌单：${playlist.title || playlist.id}`);
        try {
          const response = await fetch('/api/music/home', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: playbackState.selectedSource,
              action: 'playlist-tracks',
              playlistId: playlist.id,
              limit: 1000
            })
          });
          const payload = await readJsonResponse(response, '打开歌单失败');
          if (!response.ok || !payload.ok) throw new Error(payload.error || '打开歌单失败');
          playbackHomeItems = Array.isArray(payload.data && payload.data.tracks)
            ? payload.data.tracks
            : [];
          playbackHomeItemType = 'track';
          playbackHomeAction = 'playlist-tracks';
          renderPlaybackHomeResults('playlist-tracks', playlist.title || '');
        } catch (error) {
          setPlaybackDrawerError(error.message || String(error));
          showError(error);
        }
      }

      async function refreshPlaybackHomeContent() {
        const action = playbackHomeAction;
        if (!action || !['personalized', 'daily', 'radio'].includes(action)) return;
        playbackHomePage += 1;
        setPlaybackDrawerLoading('正在刷新...');
        try {
          const response = await fetch('/api/music/home', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: playbackState.selectedSource,
              action,
              limit: action === 'personalized' ? 12 : 30,
              page: playbackHomePage,
              refresh: true
            })
          });
          const payload = await readJsonResponse(response, '刷新内容失败');
          if (!response.ok || !payload.ok) throw new Error(payload.error || '刷新内容失败');
          const data = payload.data || {};
          const items = Array.isArray(data.playlists)
            ? data.playlists
            : (Array.isArray(data.tracks) ? data.tracks : []);
          if (items.length === 0) {
            // 没有更多了：保留当前列表，别把界面刷成空的。
            playbackHomePage = Math.max(1, playbackHomePage - 1);
            renderPlaybackHomeResults(action);
            showError(new Error('没有更多内容了'));
            return;
          }
          playbackHomeItems = items;
          playbackHomeItemType = Array.isArray(data.playlists) ? 'playlist' : 'track';
          renderPlaybackHomeResults(action);
        } catch (error) {
          playbackHomePage = Math.max(1, playbackHomePage - 1);
          setPlaybackDrawerError(error.message || String(error));
          showError(error);
        }
      }

      function renderPlaybackHomeResults(action = '', title = '') {
        const body = document.getElementById('playbackDrawerBody');
        if (!body) return;
        if (!playbackHomeItems.length) {
          body.innerHTML = '<p class="hint" style="text-align:center;padding:40px 0;">暂无内容</p>';
          updateDrawerActions(false);
          return;
        }

        const heading = title || playbackHomeActionTitle(action);
        document.getElementById('playbackDrawerTitle').textContent = heading;
        const subtitle = document.getElementById('playbackDrawerSubtitle');
        if (subtitle) subtitle.textContent = playbackHomeItemType === 'playlist'
          ? `${playbackHomeItems.length} 个歌单`
          : `${playbackHomeItems.length} 首`;

        if (playbackHomeItemType === 'playlist') {
          body.innerHTML = playbackHomeItems.map((playlist, index) => `
            <div class="playback-drawer-playlist-card" data-playback-playlist-index="${index}">
              ${renderPlaybackArtwork(playlist, { fallback: '单' })}
              <div style="flex:1 1 auto;min-width:0;">
                <div class="song" style="font-size:14px;font-weight:700;">${escapeHtml(playlist.title || '')}</div>
                <div class="meta">${escapeHtml(formatPlaybackPlaylistMeta(playlist))}</div>
              </div>
              <span class="playlist-card-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:block;"><polyline points="9 18 15 12 9 6"/></svg></span>
            </div>
          `).join('');
          updateDrawerActions(false, action);
          return;
        }

        body.innerHTML = playbackHomeItems.map((track, index) => `
          <div class="queue-row playback-home-row">
            <div class="playback-row-main">
              ${renderPlaybackArtwork(track)}
              <div>
                <div class="song">${escapeHtml(track.title || '')}</div>
                <div class="meta">${escapeHtml(formatPlaybackTrackMeta(track))}</div>
              </div>
            </div>
            <div class="queue-actions">
              <button type="button" data-playback-home-track-action="normal" data-playback-home-track-index="${index}">入队</button>
              <button type="button" data-playback-home-track-action="requested" data-playback-home-track-index="${index}">插队</button>
              <button type="button" data-playback-home-track-action="radio" data-playback-home-track-index="${index}">电台</button>
              <button type="button" data-playback-home-track-action="play" data-playback-home-track-index="${index}">播放</button>
            </div>
          </div>
        `).join('');
        updateDrawerActions(true, action);
      }

      function updateDrawerActions(showPlayAll, action = '') {
        const actions = document.getElementById('playbackDrawerActions');
        if (!actions) return;
        const canRefresh = ['personalized', 'daily', 'radio'].includes(action);
        actions.innerHTML = '';
        if (showPlayAll) {
          actions.innerHTML += '<button id="playbackDrawerPlayAll" type="button">播放全部</button>';
          actions.innerHTML += '<button id="playbackDrawerShuffleAll" type="button">随机播放</button>';
        }
        if (canRefresh) {
          actions.innerHTML += '<button id="playbackDrawerRefresh" type="button">换一批</button>';
        }
        actions.hidden = !showPlayAll && !canRefresh;
      }

      function setPlaybackDrawerLoading(message) {
        const body = document.getElementById('playbackDrawerBody');
        if (body) body.innerHTML = `<div class="playback-drawer-loading"><span>${escapeHtml(message)}</span></div>`;
        updateDrawerActions(false);
      }

      function setPlaybackDrawerError(message) {
        const body = document.getElementById('playbackDrawerBody');
        if (body) body.innerHTML = `<p class="hint" style="text-align:center;padding:40px 0;color:var(--danger);">${escapeHtml(message)}</p>`;
        updateDrawerActions(false);
      }

      // ===== 队列弹窗 =====
      function openQueuePopup() {
        queuePopupOpen = true;
        document.getElementById('queuePopup')?.classList.add('open');
        document.getElementById('queuePopupBackdrop')?.classList.add('open');
        document.getElementById('playbackQueueBtn')?.classList.add('active');
        renderPlaybackQueue();
        if (playbackState.queueType === 'playlist') {
          scrollQueueToCurrentTrack();
        }
      }
      function closeQueuePopup() {
        queuePopupOpen = false;
        document.getElementById('queuePopup')?.classList.remove('open');
        document.getElementById('queuePopupBackdrop')?.classList.remove('open');
        document.getElementById('playbackQueueBtn')?.classList.remove('active');
      }
      function toggleQueuePopup() {
        if (queuePopupOpen) closeQueuePopup(); else openQueuePopup();
      }

      function openPlaybackDrawer(title, subtitle, loading) {
        const drawer = document.getElementById('playbackDrawer');
        const backdrop = document.getElementById('playbackDrawerBackdrop');
        const titleEl = document.getElementById('playbackDrawerTitle');
        const subtitleEl = document.getElementById('playbackDrawerSubtitle');
        if (drawer) drawer.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
        if (titleEl) titleEl.textContent = title || '浏览内容';
        if (subtitleEl) subtitleEl.textContent = subtitle || '';
        const backBtn = document.getElementById('playbackDrawerBack');
        if (backBtn) backBtn.style.display = playbackDrawerHistory.length > 0 ? '' : 'none';
        if (loading) setPlaybackDrawerLoading('正在加载...');
      }

      function closePlaybackDrawer() {
        const drawer = document.getElementById('playbackDrawer');
        const backdrop = document.getElementById('playbackDrawerBackdrop');
        if (drawer) drawer.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        playbackDrawerHistory = [];
        playbackHomeItems = [];
        playbackHomeItemType = '';
        playbackHomeAction = '';
        // 取消卡片高亮
        document.querySelectorAll('[data-playback-home-action]').forEach((btn) => btn.classList.remove('active'));
      }

      function playbackDrawerGoBack() {
        if (!playbackDrawerHistory.length) {
          closePlaybackDrawer();
          return;
        }
        const prev = playbackDrawerHistory.pop();
        playbackHomeItems = prev.items;
        playbackHomeItemType = prev.itemType;
        playbackHomeAction = prev.action || '';
        playbackHomePage = prev.page || 1;
        renderPlaybackHomeResults('', prev.title);
        const backBtn = document.getElementById('playbackDrawerBack');
        if (backBtn) backBtn.style.display = playbackDrawerHistory.length > 0 ? '' : 'none';
      }

      function handlePlaybackHomeBulkAction(action) {
        if (playbackHomeItemType !== 'track' || !playbackHomeItems.length) return;
        let tracks = playbackHomeItems.map(normalizePlaybackOnlineTrack);
        if (action === 'shuffle-all') {
          tracks = shufflePlaybackTracks(tracks);
          playbackState.mode = 'shuffle';
        }
        if (action === 'play-all' || action === 'shuffle-all') {
          const queueType = playbackHomeAction === 'radio' ? 'radio' : 'playlist';
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
        const track = playbackHomeItems[index];
        if (!track) return;
        if (action === 'play' && playbackHomeAction !== 'recent') {
          const selectedTrack = normalizePlaybackOnlineTrack(track);
          if (
            (playbackState.queueType === 'playlist' || playbackState.queueType === 'radio')
            && playbackState.current
          ) {
            insertAndPlayPlaybackTrack(selectedTrack);
            return;
          }
          const tracks = playbackHomeItems.map(normalizePlaybackOnlineTrack);
          const queueType = playbackHomeAction === 'radio' ? 'radio' : 'playlist';
          startPlaybackCollection(tracks, index, queueType);
          return;
        }
        queuePlaybackTrack(normalizePlaybackOnlineTrack(track), action, {
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

      function playbackHomeActionTitle(action) {
        return {
          personalized: '推荐歌单',
          daily: '每日推荐',
          radio: '心动 / 电台',
          liked: '我喜欢',
          'created-playlists': '我的歌单',
          'collected-playlists': '收藏歌单',
          recent: '最近播放',
          'playlist-tracks': '歌单歌曲'
        }[action] || '音乐内容';
      }

      function shufflePlaybackTracks(tracks) {
        const items = tracks.slice();
        for (let i = items.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
      }

      function formatPlaybackPlaylistMeta(playlist) {
        const parts = [];
        if (playlist.trackCount) parts.push(`${playlist.trackCount} 首`);
        if (playlist.playCount) parts.push(`${formatCompactNumber(playlist.playCount)} 次播放`);
        if (playlist.description) parts.push(playlist.description);
        return parts.join(' · ') || '歌单';
      }

      async function runPlaybackSearch() {
        const keyword = value('playbackSearchKeyword');
        const resultNode = document.getElementById('playbackSearchResults');
        if (!keyword) {
          toast('请输入要搜索的歌名或歌手');
          return;
        }

        if (resultNode) resultNode.textContent = '正在搜索...';
        try {
          const response = await fetch('/api/music/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: playbackState.selectedSource,
              keyword,
              limit: Number(value('playbackSearchLimit') || 12)
            })
          });
          const payload = await readJsonResponse(response, '在线搜索失败');
          if (!response.ok || !payload.ok) throw new Error(payload.error || '在线搜索失败');
          playbackSearchResults = Array.isArray(payload.data && payload.data.tracks)
            ? payload.data.tracks
            : [];
          renderPlaybackSearchResults();
        } catch (error) {
          playbackSearchResults = [];
          if (resultNode) resultNode.textContent = error.message || String(error);
          showError(error);
        }
      }

      function renderPlaybackSearchResults() {
        const resultNode = document.getElementById('playbackSearchResults');
        if (!resultNode) return;
        if (!playbackSearchResults.length) {
          resultNode.innerHTML = playbackState.selectedSource === 'netease'
            ? '输入关键词后可搜索网易云音乐。'
            : 'QQ 音乐 Provider 尚未接入，当前只保留登录验证。';
          return;
        }

        resultNode.innerHTML = playbackSearchResults.map((track, index) => `
          <div class="queue-row playback-search-row">
            <div class="playback-row-main">
              ${renderPlaybackArtwork(track)}
              <div>
                <div class="song">${escapeHtml(track.title || '')}</div>
                <div class="meta">${escapeHtml(formatPlaybackTrackMeta(track))}</div>
              </div>
            </div>
            <div class="queue-actions">
              <button type="button" data-playback-search-action="normal" data-playback-search-index="${index}">入队</button>
              <button type="button" data-playback-search-action="requested" data-playback-search-index="${index}">插队</button>
              <button type="button" data-playback-search-action="play" data-playback-search-index="${index}">播放</button>
            </div>
          </div>
        `).join('');
      }

      function handlePlaybackSearchAction(action, index) {
        const track = playbackSearchResults[index];
        if (!track) return;
        const queuedTrack = normalizePlaybackOnlineTrack(track);

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
          const response = await fetch('/api/state');
          const payload = await readJsonResponse(response, '读取点歌队列失败');
          if (!payload.ok) throw new Error(payload.error || '读取点歌队列失败');
          const queue = payload.data && payload.data.queue ? payload.data.queue : {};
          const items = [queue.current].concat(Array.isArray(queue.waiting) ? queue.waiting : []).filter(Boolean);
          if (!items.length) {
            toast('点歌队列为空');
            return;
          }

          let imported = 0;
          let skipped = 0;
          let pending = 0;
          const importedTracks = [];
          for (const item of items.slice(0, 30)) {
            const matched = await resolvePlaybackTrackForQueueItem(item);
            if (matched && matched.autoAccept) {
              importedTracks.push({
                ...matched.track,
                requestedBy: item.requester_name || item.requesterName || '观众'
              });
              imported += 1;
            } else if (matched && matched.track) {
              playbackState.pendingRequests.push({
                id: `pending:${item.id || Date.now()}:${matched.track.id}`,
                songName: item.song_name || item.songName || '',
                artist: item.artist || '',
                requesterName: item.requester_name || item.requesterName || '观众',
                score: matched.score,
                reasons: matched.reasons,
                track: matched.track
              });
              pending += 1;
            } else {
              skipped += 1;
            }
          }

          insertPlaybackTracksNext(importedTracks);
          savePlaybackState();
          renderPlayback();
          toast(`已导入 ${imported} 首，待确认 ${pending} 首，跳过 ${skipped} 首`);
        } catch (error) {
          showError(error);
        } finally {
          if (button) button.disabled = false;
        }
      }

      async function resolvePlaybackTrackForQueueItem(item) {
        const songName = item.song_name || item.songName || '';
        const artist = item.artist || '';
        if (!songName) return null;
        const platforms = preferredPlaybackSearchPlatforms();
        let fallbackMatch = null;
        for (const platform of platforms) {
          try {
            const matched = await resolvePlaybackTrackForQueueItemOnPlatform(item, platform);
            if (!matched) continue;
            if (matched.autoAccept) return matched;
            if (!fallbackMatch || matched.score > fallbackMatch.score) fallbackMatch = matched;
          } catch (error) {
            console.warn('[playback] request match failed:', platform, error.message || error);
          }
        }
        return fallbackMatch;
      }

      async function resolvePlaybackTrackForQueueItemOnPlatform(item, platform) {
        const songName = item.song_name || item.songName || '';
        const artist = item.artist || '';
        const searchResponse = await fetch('/api/music/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform,
            keyword: artist ? `${songName} ${artist}` : songName,
            limit: 10
          })
        });
        const searchPayload = await readJsonResponse(searchResponse, '搜索点歌候选失败');
        if (!searchResponse.ok || !searchPayload.ok) return null;
        const candidates = Array.isArray(searchPayload.data && searchPayload.data.tracks)
          ? searchPayload.data.tracks
          : [];
        if (!candidates.length) return null;

        const matchResponse = await fetch('/api/music/match-track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songName, artist, candidates })
        });
        const matchPayload = await readJsonResponse(matchResponse, '点歌匹配失败');
        if (!matchResponse.ok || !matchPayload.ok) return null;
        const best = matchPayload.data && Array.isArray(matchPayload.data.results)
          ? matchPayload.data.results[0]
          : null;
        if (!best || !best.track) return null;
        return {
          autoAccept: Boolean(best.autoAccept),
          score: Number(best.score || 0),
          reasons: Array.isArray(best.reasons) ? best.reasons : [],
          track: normalizePlaybackOnlineTrack(best.track)
        };
      }

      function preferredPlaybackSearchPlatforms() {
        const currentSource = playbackState.current && playbackState.current.source;
        const preferred = currentSource === 'qq' || currentSource === 'netease'
          ? currentSource
          : playbackState.selectedSource;
        return preferred === 'qq' ? ['qq', 'netease'] : ['netease', 'qq'];
      }

      function normalizePlaybackOnlineTrack(track) {
        const source = track.source === 'netease' ? 'netease' : 'qq';
        const sourceTrackId = String(track.sourceTrackId || track.id || '').replace(`${source}:`, '');
        return {
          id: track.id || `${source}:${sourceTrackId}`,
          source,
          title: track.title || track.name || '未知歌曲',
          artists: Array.isArray(track.artists) ? track.artists : [],
          album: track.album || '',
          durationMs: Math.max(0, Number(track.durationMs) || 0),
          coverUrl: track.coverUrl || '',
          sourceTrackId,
          sourceAlbumId: track.sourceAlbumId || '',
          playable: track.playable !== false,
          vip: track.vip === true
        };
      }

      function formatPlaybackTrackMeta(track) {
        const artists = Array.isArray(track.artists) && track.artists.length
          ? track.artists.join(' / ')
          : '未知歌手';
        const parts = [
          artists,
          track.album || '',
          formatPlaybackTime((track.durationMs || 0) / 1000)
        ].filter(Boolean);
        if (track.vip) parts.push('VIP');
        if (track.playable === false) parts.push('可能不可播');
        return parts.join(' · ');
      }

      function renderPlaybackArtwork(item, options = {}) {
        const coverUrl = String(item && item.coverUrl || '').trim();
        const fallback = options.fallback || '音';
        return `
          <div class="playback-artwork${coverUrl ? ' has-image' : ''}" aria-hidden="true">
            ${coverUrl ? `<img src="${escapeAttr(coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove('has-image');this.remove();">` : ''}
            <span>${escapeHtml(fallback)}</span>
          </div>
        `;
      }

      async function runPlaybackMatchTest() {
        const resultNode = document.getElementById('playbackMatchResults');
        const songName = value('playbackMatchSong');
        if (!songName) {
          toast('请输入要测试的歌名');
          return;
        }

        if (resultNode) resultNode.textContent = '正在匹配...';
        try {
          const response = await fetch('/api/music/match-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              songName,
              artist: value('playbackMatchArtist'),
              durationMs: Number(value('playbackMatchDuration') || 0)
            })
          });
          const payload = await readJsonResponse(response, '点歌匹配测试失败');
          if (!payload.ok) throw new Error(payload.error || '点歌匹配测试失败');
          renderPlaybackMatchResults(payload.data);
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
        if (!window.musicAPI || typeof window.musicAPI.openLyricWindow !== 'function') {
          toast('桌面歌词需要在桌面版里使用');
          return;
        }

        try {
          if (playbackLyricWindowOpen) {
            await window.musicAPI.closeLyricWindow();
            playbackLyricWindowOpen = false;
          } else {
            await window.musicAPI.openLyricWindow();
            playbackLyricWindowOpen = true;
            await syncPlaybackLyricWindow(true);
          }
        } catch (error) {
          showError(error);
        }
        renderPlayback();
      }

      async function togglePlaybackLyricLock() {
        if (!window.musicAPI || typeof window.musicAPI.setLyricWindowLocked !== 'function') return;
        playbackLyricWindowLocked = !playbackLyricWindowLocked;
        try {
          const result = await window.musicAPI.setLyricWindowLocked(playbackLyricWindowLocked);
          playbackLyricWindowLocked = Boolean(result && result.locked);
        } catch (error) {
          showError(error);
        }
        renderPlayback();
      }

      async function syncPlaybackLyricWindow(force = false) {
        if (!playbackLyricWindowOpen && !force) return;
        if (!window.musicAPI || typeof window.musicAPI.updateLyricWindow !== 'function') return;
        const wasOpen = playbackLyricWindowOpen;
        const audio = getPlaybackAudio();
        const track = playbackState.current || null;
        const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
        const currentTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const progress = duration > 0 ? currentTime / duration : 0;
        const lyricLine = findPlaybackLyricLine(track, currentTime * 1000);

        try {
          const result = await window.musicAPI.updateLyricWindow({
            trackTitle: track ? track.title : '',
            artists: track && Array.isArray(track.artists) ? track.artists : [],
            lineText: lyricLine ? lyricLine.text : '',
            translation: lyricLine ? lyricLine.translation : '',
            words: lyricLine && Array.isArray(lyricLine.words) ? lyricLine.words : [],
            currentMs: Math.round(currentTime * 1000),
            progress,
            playing: audio ? !audio.paused : false,
            locked: playbackLyricWindowLocked
          });
          playbackLyricWindowOpen = Boolean(result && result.open);
        } catch (_) {
          playbackLyricWindowOpen = false;
        }
        if (wasOpen !== playbackLyricWindowOpen) renderPlayback();
      }

      function findPlaybackLyricLine(track, currentMs) {
        const lines = track && track.lyrics && Array.isArray(track.lyrics.lines)
          ? track.lyrics.lines
          : [];
        if (!lines.length) return null;

        let low = 0;
        let high = lines.length - 1;
        let result = null;
        const target = Math.max(0, Number(currentMs) || 0);
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const line = lines[mid];
          if (Number(line.startMs) <= target) {
            result = line;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        return result;
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
        const items = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
        if (!items.length) return;
        playbackState.requestedQueue = [];
        if (playbackState.queueType === 'radio') {
          playbackState.radioQueue.unshift(...items);
        } else {
          playbackState.radioQueue = [];
          playbackState.normalQueue.unshift(...items);
          if (playbackState.queueType === 'playlist') {
            const insertAt = Math.max(0, Math.min(
              playbackState.normalQueueTracks.length,
              playbackState.playlistIndex + 1
            ));
            playbackState.normalQueueTracks.splice(
              insertAt,
              0,
              ...items.map((track) => ({ ...track }))
            );
          } else {
            playbackState.queueType = 'queue';
            playbackState.queueTitle = '播放队列';
            playbackState.normalQueueTracks = [];
            playbackState.playlistIndex = -1;
          }
        }
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
        return playbackState.queueType === 'radio'
          ? playbackState.radioQueue
          : playbackState.normalQueue;
      }

      function activePlaybackOrigin() {
        return playbackState.queueType === 'radio' ? 'radio' : 'normal';
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
          const normalizeSavedTrack = (track) => ({
            ...track,
            objectUrl: ''
          });
          playbackState.current = saved.current ? normalizeSavedTrack(saved.current) : null;
          playbackState.currentOrigin = ['requested', 'normal', 'radio', 'history'].includes(saved.currentOrigin) ? saved.currentOrigin : '';
          playbackState.requestedQueue = Array.isArray(saved.requestedQueue)
            ? saved.requestedQueue.map(normalizeSavedTrack)
            : [];
          playbackState.normalQueue = Array.isArray(saved.normalQueue)
            ? saved.normalQueue.map(normalizeSavedTrack)
            : (Array.isArray(saved.tracks) ? saved.tracks.map(normalizeSavedTrack) : []);
          playbackState.normalQueueTracks = Array.isArray(saved.normalQueueTracks)
            ? saved.normalQueueTracks.map(normalizeSavedTrack)
            : [];
          playbackState.radioQueue = Array.isArray(saved.radioQueue)
            ? saved.radioQueue.map(normalizeSavedTrack)
            : [];
          playbackState.pendingRequests = Array.isArray(saved.pendingRequests)
            ? saved.pendingRequests.map(normalizeSavedPendingRequest).filter(Boolean)
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
          playbackState.history = Array.isArray(saved.history) ? saved.history.map(normalizeSavedTrack) : [];
          playbackState.displayHistory = Array.isArray(saved.displayHistory) ? saved.displayHistory.map(normalizeSavedTrack) : [];
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

      function normalizeSavedPendingRequest(item) {
        if (!item || !item.track) return null;
        return {
          id: item.id || `pending:${Date.now()}:${Math.random()}`,
          songName: item.songName || '',
          artist: item.artist || '',
          requesterName: item.requesterName || '观众',
          score: Math.max(0, Number(item.score) || 0),
          reasons: Array.isArray(item.reasons) ? item.reasons : [],
          track: {
            ...item.track,
            objectUrl: ''
          }
        };
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
        playbackState.requestedQueue = [];
        playbackState.normalQueue = [];
        playbackState.normalQueueTracks = [];
        playbackState.radioQueue = [];
        playbackState.queueType = 'queue';
        playbackState.queueTitle = '播放队列';
        playbackState.playlistIndex = -1;
        playbackState.pendingRequests = [];
        playbackState.history = [];
        playbackState.shuffleOrder = [];
        playbackState.shuffleCursor = 0;
        playbackState.restoredTime = 0;
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

        if (!options.isRetry) playbackStreamRetryCount = 0;
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
        if (!track || isPlaybackLocalTrack(track) || (track.lyrics && Array.isArray(track.lyrics.lines))) return;
        try {
          const response = await fetch('/api/music/lyrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track: serializeTrackForProvider(track) })
          });
          const payload = await readJsonResponse(response, '获取歌词失败');
          if (!response.ok || !payload.ok) throw new Error(payload.error || '获取歌词失败');
          if (playbackState.current && playbackState.current.id === track.id) {
            playbackState.current.lyrics = payload.data;
            syncPlaybackLyricWindow(true);
          }
        } catch (error) {
          console.warn('[playback] load lyrics failed:', error.message || error);
        }
      }

      async function getPlaybackTrackUrl(track, options = {}) {
        if (isPlaybackLocalTrack(track)) {
          if (!track.objectUrl) {
            toast('本地音频需要重新选择文件后才能播放');
            return '';
          }
          return track.objectUrl;
        }

        if (!options.forceRefresh && hasUsablePlaybackUrl(track)) {
          return track.playUrl;
        }

        const stream = await resolvePlaybackStream(track, {
          forceRefresh: options.forceRefresh === true
        });
        if (!stream || !stream.url) {
          toast('当前账号无法播放该歌曲');
          return '';
        }

        track.playUrl = stream.url;
        track.playUrlExpireAt = Number(stream.expireAt || stream.playUrlExpireAt || 0);
        return track.playUrl;
      }

      function isPlaybackLocalTrack(track) {
        return !track || track.source === 'local';
      }

      function hasUsablePlaybackUrl(track) {
        if (!track || !track.playUrl) return false;
        const expireAt = Number(track.playUrlExpireAt || 0);
        return !expireAt || expireAt - Date.now() > playbackStreamRefreshMarginMs;
      }

      async function resolvePlaybackStream(track, options = {}) {
        const payloadTrack = serializeTrackForProvider(track);
        const response = await fetch('/api/music/resolve-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            track: payloadTrack,
            forceRefresh: options.forceRefresh === true
          })
        });
        const payload = await readJsonResponse(response, '解析播放地址失败');
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `解析播放地址失败（HTTP ${response.status}）`);
        }
        return payload.data;
      }

      function serializeTrackForProvider(track) {
        return {
          id: track.id,
          source: track.source,
          title: track.title,
          artists: Array.isArray(track.artists) ? track.artists : [],
          album: track.album || '',
          durationMs: track.durationMs || 0,
          coverUrl: track.coverUrl || '',
          sourceTrackId: track.sourceTrackId || track.id,
          sourceAlbumId: track.sourceAlbumId || '',
          playable: track.playable !== false,
          vip: track.vip === true
        };
      }

      async function handlePlaybackError() {
        const track = playbackState.current;
        if (!track) return;

        if (isPlaybackLocalTrack(track)) {
          toast('当前音频播放失败，请重新选择文件或切换下一首');
          renderPlayback();
          return;
        }

        if (playbackStreamRetryCount >= playbackStreamMaxRetries) {
          toast('播放地址刷新后仍失败，已跳过当前歌曲');
          playbackNext(false);
          return;
        }

        playbackStreamRetryCount += 1;
        const audio = getPlaybackAudio();
        const resumeAt = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        try {
          await playPlaybackTrack(track, {
            origin: playbackState.currentOrigin,
            forceRefresh: true,
            isRetry: true,
            startAt: resumeAt
          });
          toast('播放地址已刷新');
        } catch (error) {
          showError(error);
          playbackNext(false);
        }
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
            ? shufflePlaybackTracks(playbackState.normalQueueTracks)
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
            ? payload.data.tracks.map(normalizePlaybackOnlineTrack)
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
        const track = playbackState.current || null;
        const sourceName = selectedPlaybackSourceName();
        const loggedIn = Boolean(playbackAuthState && playbackAuthState.loggedIn);

        document.querySelectorAll('.source-tab').forEach((button) => {
          button.classList.toggle('active', button.dataset.source === playbackState.selectedSource);
        });
        const sourceStatus = document.getElementById('playbackSourceStatus');
        if (sourceStatus) {
          sourceStatus.textContent = loggedIn ? `${sourceName}已检测到登录` : `${sourceName}待登录`;
          sourceStatus.classList.toggle('good', loggedIn);
          sourceStatus.classList.toggle('warn', !loggedIn);
        }
        const loginBtn = document.getElementById('playbackLoginBtn');
        if (loginBtn) loginBtn.textContent = `登录${sourceName}`;
        const userName = document.getElementById('playbackUserName');
        if (userName) {
          userName.textContent = loggedIn ? `${sourceName} Cookie 已就绪` : '未连接音乐账户';
        }
        const vipState = document.getElementById('playbackVipState');
        if (vipState) {
          if (playbackAuthState && playbackAuthState.desktopUnavailable) {
            vipState.textContent = '扫码登录验证需要在桌面版里使用';
          } else if (playbackAuthState && playbackAuthState.error) {
            vipState.textContent = playbackAuthState.error;
          } else if (loggedIn) {
            const keys = Array.isArray(playbackAuthState.keyCookieNames) ? playbackAuthState.keyCookieNames.join('、') : '';
            vipState.textContent = `Cookie ${playbackAuthState.cookieCount || 0} 个，关键字段：${keys || '待确认'}，加密快照：${playbackAuthState.encryptedSnapshotExists ? '已保存' : '未保存'}`;
          } else {
            vipState.textContent = '账号歌单和推荐将在 Provider 接入后显示';
          }
        }
        const providerHealth = document.getElementById('playbackProviderHealth');
        if (providerHealth) {
          providerHealth.textContent = playbackProviderHealth
            ? playbackProviderHealth.message || `Provider 状态：${playbackProviderHealth.status || '未知'}`
            : '等待检查音乐 Provider 状态';
        }
        const searchSource = document.getElementById('playbackSearchSource');
        if (searchSource) searchSource.value = sourceName;

        const title = document.getElementById('playbackTrackTitle');
        if (title) title.textContent = track ? track.title : '未选择歌曲';
        const artist = document.getElementById('playbackTrackArtist');
        if (artist) {
          artist.textContent = track
            ? `${(track.artists || []).join(' / ') || '未知歌手'}${isPlaybackLocalTrack(track) && !track.objectUrl ? ' · 需重新选择文件' : ''}`
            : '从本地测试音频开始';
        }
        const cover = document.getElementById('playbackCover');
        if (cover) renderPlaybackCurrentCover(cover, track);
        const playBtn = document.getElementById('playbackPlayPause');
        if (playBtn) {
          playBtn.classList.toggle('playing', audio && !audio.paused);
          playBtn.title = audio && !audio.paused ? '暂停' : '播放';
        }
        const lyricBtn = document.getElementById('playbackLyricBtn');
        if (lyricBtn) {
          lyricBtn.classList.toggle('active', playbackLyricWindowOpen);
          lyricBtn.disabled = !(window.musicAPI && typeof window.musicAPI.openLyricWindow === 'function');
        }
        const lyricLockBtn = document.getElementById('playbackLyricLockBtn');
        if (lyricLockBtn) {
          lyricLockBtn.classList.toggle('locked', playbackLyricWindowLocked);
          lyricLockBtn.disabled = !playbackLyricWindowOpen;
        }
        const volume = document.getElementById('playbackVolume');
        if (volume) volume.value = String(playbackState.volume);
        updatePlaybackVolumeUI();
        const modeLabel = document.getElementById('playbackModeLabel');
        const modeBtn = document.getElementById('playbackModeBtn');
        if (modeLabel) {
          const modeLabels = { 'sequence': '顺序', 'shuffle': '随机', 'repeat-one': '单曲' };
          modeLabel.textContent = modeLabels[playbackState.mode] || '顺序';
        }
        if (modeBtn) {
          modeBtn.dataset.mode = playbackState.mode;
          modeBtn.title = { 'sequence': '顺序播放', 'shuffle': '随机播放', 'repeat-one': '单曲循环' }[playbackState.mode] || '播放模式';
        }
        const queueSize = document.getElementById('queuePopupSize');
        if (queueSize) queueSize.textContent = `${playbackQueueTotalCount()} 首`;
        const queueTitle = document.getElementById('queuePopupTitle');
        if (queueTitle) {
          queueTitle.textContent = playbackState.queueTitle;
        }

        renderPlaybackQueue();
        renderPlaybackSearchResults();
        renderPlaybackProgress();
        renderPendingConfirmPopup();
        renderFullscreenPlayer();
      }

      function renderPlaybackQueue() {
        const container = document.getElementById('playbackQueueList');
        if (!container) return;
        if (playbackQueueTotalCount() === 0 && !playbackState.current) {
          container.innerHTML = '<div class="empty">播放队列为空</div>';
          return;
        }
        const sections = [];
        sections.push(renderPlaybackPendingSection());
        if (playbackState.queueType === 'playlist' && playbackState.normalQueueTracks.length > 0) {
          sections.push(renderPlaybackFullPlaylistSection());
        } else {
          const queue = activePlaybackQueue();
          const origin = activePlaybackOrigin();
          sections.push(renderPlaybackQueueSection(
            playbackState.queueTitle,
            queue.map((track, index) => ({ track, origin, index }))
          ));
        }
        const html = sections.filter(Boolean).join('');
        container.innerHTML = html || '<div class="empty">播放队列为空</div>';
      }

      function renderPlaybackFullPlaylistSection() {
        const tracks = playbackState.normalQueueTracks;
        if (!tracks.length) return '';
        const currentIndex = playbackState.playlistIndex;
        const rows = tracks.map((track, index) => {
          const isCurrent = index === currentIndex;
          const isPast = index < currentIndex;
          return renderPlaybackPlaylistRow(track, index, isCurrent, isPast);
        }).join('');
        return `
          <section class="playback-queue-section">
            <h3>${escapeHtml(playbackState.queueTitle)} <span>${tracks.length}</span></h3>
            ${rows}
          </section>
        `;
      }

      function renderPlaybackPlaylistRow(track, index, isCurrent, isPast) {
        const meta = `${formatPlaybackTrackMeta(track)}${isPlaybackLocalTrack(track) && !track.objectUrl ? ' · 需重新选择文件' : ''}`;
        const stateClass = isCurrent ? ' playlist-current' : (isPast ? ' playlist-past' : '');
        const btnLabel = isCurrent ? '重播' : '播放';
        return `
          <div class="queue-row playback-queue-row${stateClass}">
            <div class="playback-row-main">
              ${renderPlaybackArtwork(track)}
              <div>
                <div class="song">${isCurrent ? '<span class="playlist-now-icon" aria-hidden="true">▶</span> ' : ''}${escapeHtml(track.title)}</div>
                <div class="meta">${escapeHtml(meta)}</div>
              </div>
            </div>
            <div class="queue-actions">
              <button type="button" data-playback-playlist-jump="${index}">${btnLabel}</button>
            </div>
          </div>
        `;
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

      function scrollQueueToCurrentTrack() {
        const container = document.getElementById('playbackQueueList');
        if (!container) return;
        requestAnimationFrame(() => {
          const currentRow = container.querySelector('.playback-queue-row.playlist-current');
          if (currentRow) {
            currentRow.scrollIntoView({ block: 'center', behavior: 'instant' });
          }
        });
      }

      function renderPlaybackDisplayHistorySection() {
        const tracks = playbackState.displayHistory;
        if (!tracks.length) return '';
        const clearBtn = `<button type="button" class="link-btn" data-playback-clear-display-history style="font-size:11px;color:var(--text-muted);">清空</button>`;
        const rows = tracks.map((track) => renderPlaybackQueueRow(track, 'history', -1, true)).join('');
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
            ${playbackState.pendingRequests.map((item, index) => renderPlaybackPendingRow(item, index)).join('')}
          </section>
        `;
      }

      function renderPlaybackPendingRow(item, index) {
        const track = item.track || {};
        const reasons = Array.isArray(item.reasons) ? item.reasons.join('；') : '';
        return `
          <div class="queue-row playback-queue-row pending">
            <div>
              <div class="song">${escapeHtml(item.songName || track.title || '')}</div>
              <div class="meta">${escapeHtml(`候选：${track.title || ''} · ${formatPlaybackTrackMeta(track)} · ${item.score || 0} 分 · ${reasons || '无命中原因'}`)}</div>
            </div>
            <div class="queue-actions">
              <button type="button" data-playback-pending-action="confirm" data-playback-pending-index="${index}">确认</button>
              <button type="button" data-playback-pending-action="ignore" data-playback-pending-index="${index}">忽略</button>
            </div>
          </div>
        `;
      }

      function renderPendingConfirmPopup() {
        const popup = document.getElementById('pendingConfirmPopup');
        if (!popup) return;
        const items = playbackState.pendingRequests;
        if (!items.length) {
          popup.classList.remove('visible');
          return;
        }
        const item = items[0];
        const track = item.track || {};
        const songNameEl = document.getElementById('pendingConfirmSongName');
        const matchInfoEl = document.getElementById('pendingConfirmMatchInfo');
        const requesterEl = document.getElementById('pendingConfirmRequester');
        const countEl = document.getElementById('pendingConfirmCount');
        if (songNameEl) songNameEl.textContent = item.songName || track.title || '未知歌曲';
        if (matchInfoEl) {
          const meta = formatPlaybackTrackMeta(track);
          const scoreStr = item.score ? `  匹配度 ${item.score} 分` : '';
          matchInfoEl.textContent = `候选：${track.title || ''}  ${meta}${scoreStr}`;
        }
        if (requesterEl) requesterEl.textContent = `来自：${item.requesterName || '观众'}`;
        if (countEl) countEl.textContent = items.length > 1 ? `${items.length} 条待确认` : '';
        popup.classList.add('visible');
      }

      function handlePlaybackPendingAction(action, index) {
        if (!Number.isInteger(index) || index < 0 || index >= playbackState.pendingRequests.length) return;
        const [item] = playbackState.pendingRequests.splice(index, 1);
        if (action === 'confirm' && item && item.track) {
          insertPlaybackTracksNext([{
            ...item.track,
            requestedBy: item.requesterName || '观众'
          }]);
          toast('已确认并插入当前歌曲之后');
        } else {
          toast('已忽略待确认点歌');
        }
        savePlaybackState();
        renderPlayback();
      }

      function renderPlaybackQueueSection(title, rows, readonly = false) {
        if (!rows.length) return '';
        return `
          <section class="playback-queue-section">
            <h3>${escapeHtml(title)} <span>${rows.length}</span></h3>
            ${rows.map(({ track, origin, index }) => renderPlaybackQueueRow(track, origin, index, readonly)).join('')}
          </section>
        `;
      }

      function renderPlaybackQueueRow(track, origin, index, readonly) {
        const meta = `${formatPlaybackTrackMeta(track)}${isPlaybackLocalTrack(track) && !track.objectUrl ? ' · 需重新选择文件' : ''}`;
        return `
          <div class="queue-row playback-queue-row${origin === playbackState.currentOrigin && playbackState.current && track.id === playbackState.current.id ? ' active' : ''}">
            <div class="playback-row-main">
              ${renderPlaybackArtwork(track)}
              <div>
                <div class="song">${escapeHtml(track.title)}</div>
                <div class="meta">${escapeHtml(meta)}</div>
              </div>
            </div>
            ${readonly ? '' : `
              <div class="queue-actions">
                <button type="button" data-playback-queue="${escapeAttr(origin)}" data-playback-index="${index}">播放</button>
              </div>
            `}
          </div>
        `;
      }

      function renderPlaybackCurrentCover(cover, track) {
        const coverUrl = String(track && track.coverUrl || '').trim();
        cover.classList.toggle('has-image', Boolean(coverUrl));
        if (coverUrl) {
          cover.innerHTML = `<img src="${escapeAttr(coverUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove('has-image');this.remove();">`;
        } else {
          cover.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
        }
      }

      function playbackQueueTotalCount() {
        if (playbackState.queueType === 'playlist') {
          return playbackState.normalQueueTracks.length;
        }
        return activePlaybackQueue().length;
      }

      function renderPlaybackProgress() {
        const audio = getPlaybackAudio();
        const currentTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : playbackState.restoredTime;
        const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
        const seek = document.getElementById('playbackSeek');
        if (seek) {
          seek.max = String(Math.max(0, duration));
          seek.value = String(Math.max(0, Math.min(currentTime, duration || currentTime)));
          const pct = duration > 0 ? Math.round((currentTime / duration) * 1000) / 10 : 0;
          seek.style.setProperty('--seek-pos', pct + '%');
        }
        const current = document.getElementById('playbackCurrentTime');
        if (current) current.textContent = formatPlaybackTime(currentTime);
        const total = document.getElementById('playbackDuration');
        if (total) total.textContent = formatPlaybackTime(duration);
        updatePlaybackMediaSessionPosition();
        renderFullscreenPlayer();
      }

      function updatePlaybackVolumeUI() {
        const volSlider = document.getElementById('playbackVolume');
        const volWrap = document.querySelector('.playback-volume-wrap');
        if (volWrap) {
          volWrap.classList.toggle('muted', playbackState.volume === 0);
        }
        if (volSlider) {
          volSlider.style.setProperty('--vol-pos', Math.round(playbackState.volume * 100) + '%');
        }
      }

      function updatePlaybackMediaSession() {
        if (!('mediaSession' in navigator)) return;
        const track = playbackState.current;
        if (!track) {
          navigator.mediaSession.metadata = null;
          return;
        }
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || '',
            artist: Array.isArray(track.artists) ? track.artists.join(' / ') : '',
            album: track.album || '',
            artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '300x300', type: 'image/jpeg' }] : []
          });
          navigator.mediaSession.playbackState = getPlaybackAudio()?.paused ? 'paused' : 'playing';
          navigator.mediaSession.setActionHandler('play', () => togglePlayback());
          navigator.mediaSession.setActionHandler('pause', () => togglePlayback());
          navigator.mediaSession.setActionHandler('previoustrack', () => playbackPrevious());
          navigator.mediaSession.setActionHandler('nexttrack', () => playbackNext(false));
          navigator.mediaSession.setActionHandler('seekto', (details) => {
            const audio = getPlaybackAudio();
            if (!audio || !Number.isFinite(details.seekTime)) return;
            audio.currentTime = Math.max(0, Math.min(audio.duration || details.seekTime, details.seekTime));
          });
          updatePlaybackMediaSessionPosition();
        } catch (_) {
          // Media Session is best-effort and should never block playback.
        }
      }

      function updatePlaybackMediaSessionPosition() {
        if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
        const audio = getPlaybackAudio();
        if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.max(0, Math.min(audio.currentTime || 0, audio.duration))
          });
        } catch (_) {
          // Ignore invalid transient duration/position values.
        }
      }

      function formatPlaybackTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const minutes = Math.floor(total / 60);
        const rest = total % 60;
        return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
      }

      const FULLSCREEN_BG_THEME_COUNT = 30;

      function pickFullscreenBgTheme(track) {
        const seed = track
          ? String(track.id || `${track.title || ''}|${(track.artists || []).join(',')}`)
          : '';
        if (!seed) return 1;
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
          hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
        }
        return (hash % FULLSCREEN_BG_THEME_COUNT) + 1;
      }

      function applyFullscreenBgTheme(bgEl, track) {
        if (!bgEl) return;
        const theme = `theme-${pickFullscreenBgTheme(track)}`;
        if (bgEl.dataset.bgTheme === theme) return;
        if (bgEl.dataset.bgTheme) bgEl.classList.remove(bgEl.dataset.bgTheme);
        bgEl.classList.add(theme);
        bgEl.dataset.bgTheme = theme;
      }

      function renderFullscreenPlayer() {
        const fsEl = document.getElementById('playerFullscreen');
        if (!fsEl || !fsEl.classList.contains('open')) return;

        const track = playbackState.current;
        const audio = getPlaybackAudio();
        const isPlaying = audio && !audio.paused;

        // 更新标题和歌手
        const titleEl = document.getElementById('playerFsTitle');
        const artistEl = document.getElementById('playerFsArtist');
        if (titleEl) titleEl.textContent = track ? track.title : '未选择歌曲';
        if (artistEl) {
          artistEl.textContent = track
            ? (track.artists || []).join(' / ') || '未知歌手'
            : '—';
        }

        // 更新封面艺术
        const artEl = document.getElementById('playerFsArt');
        const bgEl = document.getElementById('playerFsBg');
        const vinylDiscEl = document.getElementById('playerFsVinylDisc');
        const coverUrl = track && track.coverUrl ? track.coverUrl : '';

        if (artEl) {
          artEl.classList.toggle('has-image', Boolean(coverUrl));
          if (coverUrl) {
            const existing = artEl.querySelector('img');
            if (!existing || existing.src !== coverUrl) {
              artEl.innerHTML = `<img src="${escapeAttr(coverUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove('has-image');this.remove();">`;
            }
          } else {
            artEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
          }
        }

        // 更新背景色板
        applyFullscreenBgTheme(bgEl, track);

        // 唱片旋转动画
        if (vinylDiscEl) {
          vinylDiscEl.classList.toggle('spinning', isPlaying);
        }

        // 渲染歌词
        renderFullscreenLyrics(track, audio);
      }

      let fullscreenLyricsInitialized = false;

      function renderFullscreenLyrics(track, audio) {
        const container = document.getElementById('playerFsLyrics');
        if (!container) return;

        const lines = track && track.lyrics && Array.isArray(track.lyrics.lines)
          ? track.lyrics.lines
          : [];

        if (!lines.length) {
          container.innerHTML = '<div class="player-fs-lyrics-empty">暂无歌词</div>';
          return;
        }

        const currentMs = audio && Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;

        // 找到当前行索引
        let currentIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].startMs <= currentMs) {
            currentIndex = i;
            break;
          }
        }

        // 重新渲染（仅在歌词变化时）
        const existingCount = container.querySelectorAll('.player-fs-lyric-line').length;
        if (existingCount !== lines.length) {
          container.innerHTML = lines.map((line, i) => `
            <div class="player-fs-lyric-line" data-lyric-index="${i}" data-lyric-start-ms="${line.startMs || 0}">
              <button class="lyric-seek-btn" type="button" aria-label="从此处播放" title="从此处播放">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </button>
              <div class="lyric-content">
                <span class="lyric-text">${escapeHtml(line.text || '')}</span>
                ${line.translation ? `<span class="lyric-trans">${escapeHtml(line.translation)}</span>` : ''}
              </div>
            </div>
          `).join('');

          // 绑定点击事件
          if (!fullscreenLyricsInitialized) {
            container.addEventListener('click', handleFullscreenLyricClick);
            fullscreenLyricsInitialized = true;
          }
        }

        // 更新当前行高亮
        container.querySelectorAll('.player-fs-lyric-line').forEach((el, i) => {
          el.classList.toggle('active', i === currentIndex);
        });

        // 自动滚动到当前行（居中）
        const activeLine = container.querySelector('.player-fs-lyric-line.active');
        if (activeLine) {
          const wrap = document.getElementById('playerFsLyricsWrap');
          if (wrap) {
            const lineTop = activeLine.offsetTop;
            const wrapHeight = wrap.clientHeight;
            const targetScroll = lineTop - wrapHeight / 2 + activeLine.clientHeight / 2;
            wrap.scrollTo({
              top: Math.max(0, targetScroll),
              behavior: 'smooth'
            });
          }
        }
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
})();
