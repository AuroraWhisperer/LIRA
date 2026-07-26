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

      const playbackStorageKey = 'songAssistantPlaybackState:v1';
      const playbackStreamRefreshMarginMs = 30 * 1000;
      const playbackStreamMaxRetries = 1;
      const playbackRadioRefillThreshold = 3;
      const playbackRadioRefillBatchSize = 10;
      const playbackState = {
        current: null,
        currentOrigin: '',
        requestedQueue: [],
        normalQueue: [],
        radioQueue: [],
        pendingRequests: [],
        history: [],
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
      let playbackLyricWindowOpen = false;
      let playbackLyricWindowLocked = false;
      let playbackRadioRefillRunning = false;
      let playbackInitialized = false;
      function init(options = {}) {
        updateContext(options);
        if (playbackInitialized) return;
        playbackInitialized = true;
        const audio = getPlaybackAudio();
        if (!audio) {
          playbackInitialized = false;
          return;
        }

        restorePlaybackState();
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
        document.querySelectorAll('[data-playback-home-action]').forEach((button) => {
          button.addEventListener('click', () => {
            loadPlaybackHomeContent(button.dataset.playbackHomeAction || 'personalized');
          });
        });

        document.querySelectorAll('.source-tab').forEach((button) => {
          button.addEventListener('click', () => {
            playbackState.selectedSource = button.dataset.source === 'netease' ? 'netease' : 'qq';
            playbackAuthState = null;
            playbackProviderHealth = null;
            playbackSearchResults = [];
            playbackHomeItems = [];
            playbackHomeItemType = '';
            savePlaybackState();
            renderPlayback();
            renderPlaybackSearchResults();
            renderPlaybackHomeResults();
            refreshSelectedMusicProviderState();
          });
        });

        document.getElementById('playbackHomeResults')?.addEventListener('click', (event) => {
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

        document.getElementById('playbackSearchResults')?.addEventListener('click', (event) => {
          const button = event.target.closest('[data-playback-search-action][data-playback-search-index]');
          if (!button) return;
          handlePlaybackSearchAction(
            button.dataset.playbackSearchAction,
            Number(button.dataset.playbackSearchIndex)
          );
        });

        document.getElementById('playbackQueueList')?.addEventListener('click', (event) => {
          const pendingButton = event.target.closest('[data-playback-pending-action][data-playback-pending-index]');
          if (pendingButton) {
            handlePlaybackPendingAction(
              pendingButton.dataset.playbackPendingAction,
              Number(pendingButton.dataset.playbackPendingIndex)
            );
            return;
          }

          const button = event.target.closest('[data-playback-queue][data-playback-index]');
          if (!button) return;
          if (button.dataset.playbackAction === 'request') {
            movePlaybackTrackToRequested(button.dataset.playbackQueue, Number(button.dataset.playbackIndex));
            return;
          }
          const picked = takePlaybackQueueTrack(button.dataset.playbackQueue, Number(button.dataset.playbackIndex));
          if (picked) {
            playPlaybackTrack(picked.track, { origin: picked.origin });
          }
        });

        document.getElementById('playbackMode')?.addEventListener('change', (event) => {
          playbackState.mode = event.target.value;
          rebuildPlaybackShuffleOrder();
          savePlaybackState();
        });

        document.getElementById('playbackVolume')?.addEventListener('input', (event) => {
          playbackState.volume = Math.max(0, Math.min(1, Number(event.target.value)));
          audio.volume = playbackState.volume;
          savePlaybackState();
        });

        document.getElementById('playbackSeek')?.addEventListener('input', (event) => {
          if (!Number.isFinite(audio.duration)) return;
          audio.currentTime = Math.max(0, Math.min(audio.duration, Number(event.target.value)));
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
        window.addEventListener('pagehide', savePlaybackState);

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

      async function loadPlaybackHomeContent(action) {
        const resultNode = document.getElementById('playbackHomeResults');
        if (resultNode) resultNode.textContent = '正在加载...';
        try {
          const response = await fetch('/api/music/home', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: playbackState.selectedSource,
              action,
              limit: action === 'personalized' ? 12 : 30
            })
          });
          const payload = await readJsonResponse(response, '加载音乐内容失败');
          if (!response.ok || !payload.ok) throw new Error(payload.error || '加载音乐内容失败');
          const data = payload.data || {};
          playbackHomeItems = Array.isArray(data.playlists)
            ? data.playlists
            : (Array.isArray(data.tracks) ? data.tracks : []);
          playbackHomeItemType = Array.isArray(data.playlists) ? 'playlist' : 'track';
          renderPlaybackHomeResults(data.action || action);
        } catch (error) {
          playbackHomeItems = [];
          playbackHomeItemType = '';
          if (resultNode) resultNode.textContent = error.message || String(error);
          showError(error);
        }
      }

      async function loadPlaybackPlaylistTracks(index) {
        const playlist = playbackHomeItems[index];
        if (!playlist) return;
        const resultNode = document.getElementById('playbackHomeResults');
        if (resultNode) resultNode.textContent = `正在打开歌单：${playlist.title || playlist.id}`;
        try {
          const response = await fetch('/api/music/home', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: playbackState.selectedSource,
              action: 'playlist-tracks',
              playlistId: playlist.id,
              limit: 50
            })
          });
          const payload = await readJsonResponse(response, '打开歌单失败');
          if (!response.ok || !payload.ok) throw new Error(payload.error || '打开歌单失败');
          playbackHomeItems = Array.isArray(payload.data && payload.data.tracks)
            ? payload.data.tracks
            : [];
          playbackHomeItemType = 'track';
          renderPlaybackHomeResults('playlist-tracks', playlist.title || '');
        } catch (error) {
          if (resultNode) resultNode.textContent = error.message || String(error);
          showError(error);
        }
      }

      function renderPlaybackHomeResults(action = '', title = '') {
        const resultNode = document.getElementById('playbackHomeResults');
        if (!resultNode) return;
        if (!playbackHomeItems.length) {
          resultNode.textContent = '选择入口后会在这里显示歌单或歌曲。';
          return;
        }

        if (playbackHomeItemType === 'playlist') {
          resultNode.innerHTML = playbackHomeItems.map((playlist, index) => `
            <div class="queue-row playback-home-row">
              <div class="playback-row-main">
                ${renderPlaybackArtwork(playlist, { fallback: '单' })}
                <div>
                  <div class="song">${escapeHtml(playlist.title || '')}</div>
                  <div class="meta">${escapeHtml(formatPlaybackPlaylistMeta(playlist))}</div>
                </div>
              </div>
              <div class="queue-actions">
                <button type="button" data-playback-playlist-index="${index}">打开</button>
              </div>
            </div>
          `).join('');
          return;
        }

        const heading = title || playbackHomeActionTitle(action);
        resultNode.innerHTML = `
          <div class="playback-home-result-title">
            <span>${escapeHtml(heading)} · ${playbackHomeItems.length} 首</span>
            <span class="actions">
              <button type="button" data-playback-home-bulk="play-all">播放全部</button>
              <button type="button" data-playback-home-bulk="shuffle-all">随机播放</button>
            </span>
          </div>
          ${playbackHomeItems.map((track, index) => `
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
          `).join('')}
        `;
      }

      function handlePlaybackHomeBulkAction(action) {
        if (playbackHomeItemType !== 'track' || !playbackHomeItems.length) return;
        let tracks = playbackHomeItems.map(normalizePlaybackOnlineTrack);
        if (action === 'shuffle-all') {
          tracks = shufflePlaybackTracks(tracks);
          playbackState.mode = 'shuffle';
        }
        playbackState.normalQueue.push(...tracks);
        rebuildPlaybackShuffleOrder();
        savePlaybackState();
        renderPlayback();
        toast(`已加入 ${tracks.length} 首到普通队列`);
      }

      function handlePlaybackHomeTrackAction(action, index) {
        const track = playbackHomeItems[index];
        if (!track) return;
        queuePlaybackTrack(normalizePlaybackOnlineTrack(track), action, {
          requestedBy: '音乐首页'
        });
      }

      function queuePlaybackTrack(track, action, options = {}) {
        if (!track) return;
        if (action === 'play') {
          playPlaybackTrack(track, { origin: 'normal' });
          return;
        }
        if (action === 'requested') {
          playbackState.requestedQueue.push({
            ...track,
            requestedBy: options.requestedBy || '手动添加'
          });
          toast('已加入点歌优先队列');
        } else if (action === 'radio') {
          playbackState.radioQueue.push(track);
          ensurePlaybackRadioQueueFilled();
          toast('已加入电台队列');
        } else {
          playbackState.normalQueue.push(track);
          rebuildPlaybackShuffleOrder();
          toast('已加入普通队列');
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
          playPlaybackTrack(queuedTrack, { origin: 'normal' });
          return;
        }

        if (action === 'requested') {
          playbackState.requestedQueue.push({
            ...queuedTrack,
            requestedBy: '手动搜索'
          });
          toast('已加入点歌优先队列');
        } else {
          playbackState.normalQueue.push(queuedTrack);
          rebuildPlaybackShuffleOrder();
          toast('已加入普通队列');
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
          for (const item of items.slice(0, 30)) {
            const matched = await resolvePlaybackTrackForQueueItem(item);
            if (matched && matched.autoAccept) {
              playbackState.requestedQueue.push({
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

      function restorePlaybackState() {
        try {
          const raw = localStorage.getItem(playbackStorageKey);
          if (!raw) return;
          const saved = JSON.parse(raw);
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
          playbackState.history = Array.isArray(saved.history) ? saved.history.map(normalizeSavedTrack) : [];
          playbackState.mode = ['sequence', 'shuffle', 'repeat-one'].includes(saved.mode) ? saved.mode : 'sequence';
          playbackState.volume = Math.max(0, Math.min(1, Number(saved.volume ?? 0.75)));
          playbackState.selectedSource = saved.selectedSource === 'netease' ? 'netease' : 'qq';
          playbackState.restoredTime = Math.max(0, Number(saved.currentTime || 0));
        } catch (_) {
          playbackState.current = null;
          playbackState.requestedQueue = [];
          playbackState.normalQueue = [];
          playbackState.radioQueue = [];
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
          durationMs: track.durationMs,
          fileName: track.fileName,
          sourceTrackId: track.sourceTrackId,
          sourceAlbumId: track.sourceAlbumId,
          playable: track.playable,
          vip: track.vip,
          unavailable: track.source === 'local' && !track.objectUrl
        }) : null;
        const payload = {
          current: serialize(playbackState.current),
          currentOrigin: playbackState.currentOrigin,
          requestedQueue: playbackState.requestedQueue.map(serialize).filter(Boolean),
          normalQueue: playbackState.normalQueue.map(serialize).filter(Boolean),
          radioQueue: playbackState.radioQueue.map(serialize).filter(Boolean),
          pendingRequests: playbackState.pendingRequests.map((item) => ({
            ...item,
            track: serialize(item.track)
          })).filter((item) => item.track),
          currentTime: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : playbackState.restoredTime,
          volume: playbackState.volume,
          mode: playbackState.mode,
          selectedSource: playbackState.selectedSource,
          history: playbackState.history.slice(-50).map(serialize).filter(Boolean)
        };
        try {
          localStorage.setItem(playbackStorageKey, JSON.stringify(payload));
        } catch (_) {
          // Playback state is helpful but not critical.
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
        playbackState.radioQueue = [];
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
          ensurePlaybackRadioQueueFilled();
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
        ensurePlaybackRadioQueueFilled();
      }

      function takeNextPlaybackTrack() {
        if (playbackState.requestedQueue.length > 0) {
          return { origin: 'requested', track: playbackState.requestedQueue.shift() };
        }

        if (playbackState.normalQueue.length > 0) {
          if (playbackState.mode === 'shuffle') {
            const track = takeNextShuffleNormalTrack();
            if (track) return { origin: 'normal', track };
          }
          return { origin: 'normal', track: playbackState.normalQueue.shift() };
        }

        if (playbackState.radioQueue.length > 0) {
          const track = playbackState.radioQueue.shift();
          ensurePlaybackRadioQueueFilled();
          return { origin: 'radio', track };
        }

        return null;
      }

      async function ensurePlaybackRadioQueueFilled() {
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
        const queue = {
          requested: playbackState.requestedQueue,
          normal: playbackState.normalQueue,
          radio: playbackState.radioQueue
        }[queueName];
        if (!queue || !Number.isInteger(index) || index < 0 || index >= queue.length) return null;
        return {
          origin: queueName,
          track: queue.splice(index, 1)[0]
        };
      }

      function movePlaybackTrackToRequested(origin, index) {
        const picked = takePlaybackQueueTrack(origin, index);
        if (!picked) return;
        playbackState.requestedQueue.push({
          ...picked.track,
          requestedBy: '测试点歌'
        });
        rebuildPlaybackShuffleOrder();
        savePlaybackState();
        renderPlayback();
        toast('已加入点歌优先队列');
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
        if (cover) cover.textContent = track ? '♪' : '音';
        const playBtn = document.getElementById('playbackPlayPause');
        if (cover) renderPlaybackCurrentCover(cover, track);
        if (playBtn) playBtn.textContent = audio && !audio.paused ? '暂停' : '播放';
        const lyricBtn = document.getElementById('playbackLyricBtn');
        if (lyricBtn) {
          lyricBtn.textContent = playbackLyricWindowOpen ? '关闭歌词' : '桌面歌词';
          lyricBtn.disabled = !(window.musicAPI && typeof window.musicAPI.openLyricWindow === 'function');
        }
        const lyricLockBtn = document.getElementById('playbackLyricLockBtn');
        if (lyricLockBtn) {
          lyricLockBtn.textContent = playbackLyricWindowLocked ? '解锁' : '锁定';
          lyricLockBtn.disabled = !playbackLyricWindowOpen;
        }
        const volume = document.getElementById('playbackVolume');
        if (volume) volume.value = String(playbackState.volume);
        const mode = document.getElementById('playbackMode');
        if (mode) mode.value = playbackState.mode;
        const queueSize = document.getElementById('playbackQueueSize');
        if (queueSize) queueSize.textContent = `${playbackQueueTotalCount()} 首`;

        renderPlaybackQueue();
        renderPlaybackSearchResults();
        renderPlaybackProgress();
      }

      function renderPlaybackQueue() {
        const container = document.getElementById('playbackQueueList');
        if (!container) return;
        if (!playbackState.current && playbackQueueTotalCount() === 0) {
          container.innerHTML = '<div class="empty">播放队列为空</div>';
          return;
        }
        const sections = [];
        if (playbackState.current) {
          sections.push(renderPlaybackQueueSection('当前播放', [{ track: playbackState.current, origin: playbackState.currentOrigin || 'normal', index: -1 }], true));
        }
        sections.push(renderPlaybackQueueSection('点歌优先', playbackState.requestedQueue.map((track, index) => ({ track, origin: 'requested', index }))));
        sections.push(renderPlaybackPendingSection());
        sections.push(renderPlaybackQueueSection('普通队列', playbackState.normalQueue.map((track, index) => ({ track, origin: 'normal', index }))));
        sections.push(renderPlaybackQueueSection('电台队列', playbackState.radioQueue.map((track, index) => ({ track, origin: 'radio', index }))));
        sections.push(renderPlaybackQueueSection('播放历史', playbackState.history.slice(-8).reverse().map((track) => ({ track, origin: 'history', index: -1 })), true));
        container.innerHTML = sections.filter(Boolean).join('');
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

      function handlePlaybackPendingAction(action, index) {
        if (!Number.isInteger(index) || index < 0 || index >= playbackState.pendingRequests.length) return;
        const [item] = playbackState.pendingRequests.splice(index, 1);
        if (action === 'confirm' && item && item.track) {
          playbackState.requestedQueue.push({
            ...item.track,
            requestedBy: item.requesterName || '观众'
          });
          toast('已确认并加入点歌优先队列');
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
        const canRequest = !readonly && (origin === 'normal' || origin === 'radio');
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
                ${canRequest ? `<button type="button" data-playback-action="request" data-playback-queue="${escapeAttr(origin)}" data-playback-index="${index}">插队</button>` : ''}
                <button type="button" data-playback-queue="${escapeAttr(origin)}" data-playback-index="${index}">播放</button>
              </div>
            `}
          </div>
        `;
      }

      function renderPlaybackCurrentCover(cover, track) {
        const coverUrl = String(track && track.coverUrl || '').trim();
        cover.classList.toggle('has-image', Boolean(coverUrl));
        cover.innerHTML = `
          ${coverUrl ? `<img src="${escapeAttr(coverUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove('has-image');this.remove();">` : ''}
          <span>${track ? '♪' : '音'}</span>
        `;
      }

      function playbackQueueTotalCount() {
        return playbackState.requestedQueue.length + playbackState.normalQueue.length + playbackState.radioQueue.length;
      }

      function renderPlaybackProgress() {
        const audio = getPlaybackAudio();
        const currentTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : playbackState.restoredTime;
        const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
        const seek = document.getElementById('playbackSeek');
        if (seek) {
          seek.max = String(Math.max(0, duration));
          seek.value = String(Math.max(0, Math.min(currentTime, duration || currentTime)));
        }
        const current = document.getElementById('playbackCurrentTime');
        if (current) current.textContent = formatPlaybackTime(currentTime);
        const total = document.getElementById('playbackDuration');
        if (total) total.textContent = formatPlaybackTime(duration);
        updatePlaybackMediaSessionPosition();
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
