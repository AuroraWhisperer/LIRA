// 编写人：Aurora
// 事件处理模块
'use strict';

import * as PlaybackUtils from '../utils.js';
import * as PlaybackComponents from '../ui/components.js';

export function createEventHandlers(deps) {
  const {
    playbackState,
    getPlaybackAudio,
    uiRenderer,
    homeService,
    searchService,
    matchService,
    providerManager,
    savePlaybackState,
    renderPlayback,
    renderPlaybackSearchResults,
    renderPlaybackHomeResults,
    renderPlaybackMatchResults,
    renderFullscreenPlayer,
    syncPlaybackLyricWindow,
    clearPlaybackQueue,
    importSongQueueToPlayback,
    playbackPrevious,
    playbackNext,
    togglePlayback,
    addCurrentTrackToPlaylist,
    loginSelectedMusicProvider,
    logoutSelectedMusicProvider,
    checkSelectedMusicProviderHealth,
    clearPlaybackMusicCache,
    runPlaybackMatchTest,
    runPlaybackSearch,
    clearPlaybackSearch,
    handlePlaybackPendingAction,
    loadPlaybackHomeContent,
    toggleQueuePopup,
    closeQueuePopup,
    closePlaybackDrawer,
    playbackDrawerGoBack,
    refreshPlaybackHomeContent,
    handlePlaybackDrawerHeaderPlayAll,
    handlePlaybackHomeBulkAction,
    loadPlaybackPlaylistTracks,
    toggleTrackMenu,
    handlePlaybackHomeTrackAction,
    handlePlaybackSearchAction,
    takePlaybackQueueTrack,
    jumpToPlaylistTrack,
    playPlaybackTrack,
    rebuildPlaybackShuffleOrder,
    refreshSelectedMusicProviderState,
    escapeHtml,
    value
  } = deps;

  function setupEventHandlers() {
    setupPlaybackControlButtons();
    setupProviderButtons();
    setupPendingConfirmButtons();
    setupHomeButtons();
    setupQueuePopupButtons();
    setupDrawerButtons();
    setupSourceTabs();
    setupSearchButtons();
    setupQueueListEvents();
    setupModeButton();
    setupVolumeControls();
    setupSeekControl();
  }

  function setupPlaybackControlButtons() {
    document.getElementById('playbackClearQueue')?.addEventListener('click', clearPlaybackQueue);
    document.getElementById('playbackImportSongQueue')?.addEventListener('click', importSongQueueToPlayback);
    document.getElementById('playbackPrev')?.addEventListener('click', playbackPrevious);
    document.getElementById('playbackNext')?.addEventListener('click', () => playbackNext(false));
    document.getElementById('playbackPlayPause')?.addEventListener('click', togglePlayback);
    document.getElementById('playbackAddToPlaylistBtn')?.addEventListener('click', addCurrentTrackToPlaylist);
  }

  function setupProviderButtons() {
    document.getElementById('playbackLoginBtn')?.addEventListener('click', loginSelectedMusicProvider);
    document.getElementById('playbackLogoutBtn')?.addEventListener('click', logoutSelectedMusicProvider);
    document.getElementById('playbackHealthBtn')?.addEventListener('click', checkSelectedMusicProviderHealth);
    document.getElementById('playbackClearCacheBtn')?.addEventListener('click', clearPlaybackMusicCache);
    document.getElementById('playbackMatchBtn')?.addEventListener('click', runPlaybackMatchTest);
  }

  function setupPendingConfirmButtons() {
    document.getElementById('pendingConfirmAcceptBtn')?.addEventListener('click', () => handlePlaybackPendingAction('confirm', 0));
    document.getElementById('pendingConfirmRejectBtn')?.addEventListener('click', () => handlePlaybackPendingAction('ignore', 0));
  }

  function setupHomeButtons() {
    document.querySelectorAll('[data-playback-home-action]').forEach((button) => {
      button.addEventListener('click', () => {
        loadPlaybackHomeContent(button.dataset.playbackHomeAction || 'personalized');
      });
    });
  }

  function setupQueuePopupButtons() {
    document.getElementById('playbackQueueBtn')?.addEventListener('click', toggleQueuePopup);
    document.getElementById('queuePopupClose')?.addEventListener('click', closeQueuePopup);
    document.getElementById('queuePopupBackdrop')?.addEventListener('click', closeQueuePopup);
  }

  function setupDrawerButtons() {
    document.getElementById('playbackDrawerBackdrop')?.addEventListener('click', closePlaybackDrawer);
    document.getElementById('playbackDrawerClose')?.addEventListener('click', closePlaybackDrawer);
    document.getElementById('playbackDrawerBack')?.addEventListener('click', playbackDrawerGoBack);
    document.getElementById('playbackDrawerRefresh')?.addEventListener('click', refreshPlaybackHomeContent);
    document.getElementById('playbackDrawerPlayAllHeader')?.addEventListener('click', handlePlaybackDrawerHeaderPlayAll);

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

      const menuBtn = event.target.closest('[data-playback-home-track-menu-index]');
      if (menuBtn) {
        toggleTrackMenu(menuBtn.dataset.playbackHomeTrackMenuIndex);
        return;
      }

      const trackButton = event.target.closest('[data-playback-home-track-action][data-playback-home-track-index]');
      if (!trackButton) return;
      handlePlaybackHomeTrackAction(
        trackButton.dataset.playbackHomeTrackAction,
        Number(trackButton.dataset.playbackHomeTrackIndex)
      );
    });
  }

  function setupSourceTabs() {
    document.querySelectorAll('.source-tab').forEach((button) => {
      button.addEventListener('click', () => {
        const newSource = button.dataset.source;
        console.log('[Playback] Tab clicked:', newSource, 'Current:', playbackState.selectedSource);
        if (!newSource || newSource === playbackState.selectedSource) return;

        playbackState.selectedSource = newSource;
        deps.playbackAuthState = providerManager.getAuthState(newSource);
        deps.playbackProviderHealth = providerManager.getProviderHealth(newSource);
        searchService.clearResults();
        homeService.clearHomeState();
        savePlaybackState();
        renderPlayback();
        renderPlaybackSearchResults();
        closePlaybackDrawer();
        void refreshSelectedMusicProviderState();

        console.log('[Playback] After click, selectedSource:', playbackState.selectedSource);
      });
    });
  }

  function setupSearchButtons() {
    document.getElementById('playbackSearchBtn')?.addEventListener('click', runPlaybackSearch);
    document.getElementById('playbackSearchClearBtn')?.addEventListener('click', clearPlaybackSearch);
    document.getElementById('playbackSearchKeyword')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runPlaybackSearch();
    });

    document.getElementById('playbackSearchResults')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-playback-search-action][data-playback-search-index]');
      if (!button) return;
      await handlePlaybackSearchAction(
        button.dataset.playbackSearchAction,
        Number(button.dataset.playbackSearchIndex)
      );
    });
  }

  function setupQueueListEvents() {
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
  }

  function setupModeButton() {
    document.getElementById('playbackModeBtn')?.addEventListener('click', () => {
      playbackState.mode = PlaybackUtils.getNextMode(playbackState.mode);
      rebuildPlaybackShuffleOrder();
      savePlaybackState();
      renderPlayback();
    });
  }

  function setupVolumeControls() {
    const audio = getPlaybackAudio();
    const volumeWrap = document.querySelector('.playback-volume-wrap');
    const volumePanel = document.getElementById('playbackVolumePanel');
    const volumeIcon = document.getElementById('playbackVolumeIcon');

    const setVolumePanelOpen = (open) => {
      if (!volumeWrap) return;
      volumeWrap.classList.toggle('open', open);
      volumePanel?.setAttribute('aria-hidden', String(!open));
      volumeIcon?.setAttribute('aria-expanded', String(open));
    };

    document.getElementById('playbackVolume')?.addEventListener('input', (event) => {
      playbackState.volume = Math.max(0, Math.min(1, Number(event.target.value)));
      audio.volume = playbackState.volume;
      PlaybackComponents.updateVolumeUI(playbackState.volume);
      savePlaybackState();
    });

    volumeIcon?.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldOpen = !volumeWrap?.classList.contains('open');
      setVolumePanelOpen(shouldOpen);
      if (shouldOpen) {
        document.getElementById('playbackVolume')?.focus({ preventScroll: true });
      }
    });

    volumePanel?.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    if (typeof document.addEventListener === 'function') {
      document.addEventListener('click', (event) => {
        if (!event.target?.closest?.('.playback-volume-wrap')) {
          setVolumePanelOpen(false);
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          setVolumePanelOpen(false);
        }
      });
    }
  }

  function setupSeekControl() {
    const audio = getPlaybackAudio();
    document.getElementById('playbackSeek')?.addEventListener('input', (event) => {
      if (!Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(audio.duration, Number(event.target.value)));
      const pct = audio.duration > 0 ? Math.round((audio.currentTime / audio.duration) * 1000) / 10 : 0;
      event.target.style.setProperty('--seek-pos', pct + '%');
      renderFullscreenPlayer();
      syncPlaybackLyricWindow();
      savePlaybackState();
    });
  }

  return {
    setupEventHandlers
  };
}
