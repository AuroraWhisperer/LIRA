// 编写人：Aurora
// 播放控制模块
'use strict';

import { createPlaybackStateActions } from '../state/actions.js';
import { PlaybackConfig } from '../config.js';

import * as PlaybackUtils from '../utils.js';
import { QueueManager } from '../queue/manager.js';
import { isInterruptedMediaPlayError } from '../../shared/media-playback-feedback.js';
import { preparePlaybackOutput } from './output-device.js';

export function createPlaybackControls(deps) {
  const {
    playbackState,
    getPlaybackAudio,
    showError,
    toast,
    lyricService,
    localFileManager,
    streamService,
    savePlaybackState,
    renderPlayback,
    updatePlaybackMediaSession,
    syncPlaybackLyricWindow,
    getPlaybackAuthState,
    rebuildPlaybackShuffleOrder,
    U: utils,
  } = deps;
  const stateActions =
    deps.stateActions ||
    createPlaybackStateActions(playbackState, {
      save: savePlaybackState,
      render: renderPlayback,
    });
  const queueManager = deps.queueManager || new QueueManager({ state: playbackState });
  let playRequestGeneration = 0;
  let audioRequestGeneration = 0;
  let playRequestSource = null;

  function invalidatePlaybackRequests(source) {
    if (source && source !== playRequestSource) return playRequestGeneration;
    playRequestGeneration += 1;
    if (source) {
      // Cancelling a pending provider leaves another provider's audio usable.
      audioRequestGeneration = playRequestGeneration;
      playRequestSource = playbackState.current?.source || null;
    }
    return playRequestGeneration;
  }

  function isCurrentPlaybackRequest(requestGeneration, track) {
    return requestGeneration === playRequestGeneration && playbackState.current?.id === track.id &&
      playbackState.selectedSource !== 'wesing';
  }

  function suspendPlaybackForExternalSource() {
    audioRequestGeneration = invalidatePlaybackRequests();
    playRequestSource = playbackState.current?.source || null;
    lyricService.suspendWindow();
    getPlaybackAudio()?.pause();
  }

  function createPlaybackRequestGuard(track) {
    // 错误属于当前音频；新曲尚在解析时也不能让旧音频抢回播放权。
    const requestGeneration = audioRequestGeneration;
    return () => isCurrentPlaybackRequest(requestGeneration, track);
  }

  async function ensureLocalTrackPlayable(track) {
    if (!PlaybackUtils.isLocalTrack(track)) return true;
    if (track.objectUrl) {
      track.fileMissing = false;
      return true;
    }

    // Try IPC restore from saved filePath
    if (track.filePath && window.musicAPI && typeof window.musicAPI.resolveLocalMediaUrls === 'function') {
      try {
        const res = await window.musicAPI.resolveLocalMediaUrls([track.filePath]);
        const entry = res && res.results && res.results[track.filePath];
        if (entry && entry.ok) {
          track.objectUrl = entry.url;
          track.fileMissing = false;
          savePlaybackState();
          return true;
        }
      } catch (_) {}
    }

    // File missing: prompt re-selection
    toast('文件已移动或删除，请重新选择本地文件');
    try {
      const updated = await localFileManager.reselectLocalFile(track);
      if (updated && updated.objectUrl) {
        Object.assign(track, updated);
        track.fileMissing = false;
        stateActions.commit();
        return true;
      }
    } catch (_) {}

    track.fileMissing = true;
    renderPlayback();
    return false;
  }

  async function playPlaybackTrack(track, options = {}) {
    const audio = getPlaybackAudio();
    if (!audio || !track) return;
    const requestGeneration = invalidatePlaybackRequests();
    playRequestSource = track.source;

    // For local tracks, ensure the file is accessible before trying to play
    if (PlaybackUtils.isLocalTrack(track)) {
      const ok = await ensureLocalTrackPlayable(track);
      if (!ok) {
        if (requestGeneration === playRequestGeneration) {
          audioRequestGeneration = requestGeneration;
        }
        return false;
      }
    }

    if (requestGeneration !== playRequestGeneration) return;

    let streamUrl = '';
    const streamTrack = { ...track };
    try {
      streamUrl = await streamService.getTrackUrl(streamTrack, {
        forceRefresh: options.forceRefresh === true,
        quality: PlaybackUtils.normalizeQuality(track.source, playbackState.qualityPreferences?.[track.source]),
      });
    } catch (error) {
      if (requestGeneration !== playRequestGeneration) return;
      audioRequestGeneration = requestGeneration;
      showError(error);
      renderPlayback();
      return false;
    }
    if (requestGeneration !== playRequestGeneration) return;
    if (!streamUrl) {
      audioRequestGeneration = requestGeneration;
      renderPlayback();
      return false;
    }
    Object.assign(track, streamTrack);

    if (!options.isRetry) streamService.resetRetryCount();
    if (Number.isInteger(options.playlistIndex) && options.playlistIndex >= 0) {
      queueManager.jumpToPlaylistTrack(options.playlistIndex);
    }
    if (options.consumeHistory) stateActions.takePrevious();
    stateActions.beginTrack(track, options);
    audioRequestGeneration = requestGeneration;
    audio.dataset.trackId = track.id;
    audio.src = streamUrl;
    audio.load();

    const startAt = Math.max(0, Number(options.startAt || 0));
    if (startAt > 0) {
      audio.addEventListener(
        'loadedmetadata',
        () => {
          if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 1));
          }
        },
        { once: true },
      );
    }

    try {
      await preparePlaybackOutput(audio);
      if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
      await audio.play();
      if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
      if (startAt > 0) {
        const dur = audio.duration;
        if (Number.isFinite(dur) && dur > 0) {
          audio.currentTime = Math.min(startAt, Math.max(0, dur - 1));
        }
      }
    } catch (error) {
      if (requestGeneration === playRequestGeneration && !isInterruptedMediaPlayError(error)) {
        showError(error);
      }
    }

    if (!isCurrentPlaybackRequest(requestGeneration, track)) return;

    stateActions.finishTrackStart();

    loadPlaybackLyrics(track);
    stateActions.commit();
    updatePlaybackMediaSession();
    return true;
  }

  async function loadPlaybackLyrics(track) {
    if (!track) return;
    const lyrics = await lyricService.loadLyrics(track);
    if (stateActions.setLyrics(track.id, lyrics)) {
      syncPlaybackLyricWindow(true);
    }
  }

  async function changePlaybackQuality(quality) {
    const audio = getPlaybackAudio();
    const currentSource = playbackState.current?.source;
    const source = currentSource === 'qq' || currentSource === 'netease' ? currentSource : playbackState.selectedSource;
    const normalizedQuality = PlaybackUtils.normalizeQuality(source, quality);
    if (!PlaybackUtils.getQualityOptions(source).some((item) => item.id === quality)) return;

    const track = playbackState.current;
    if (!audio || !track || track.source !== source) {
      stateActions.setQuality(source, normalizedQuality);
      stateActions.commit();
      toast(
        `${PlaybackUtils.getSourceName(source)}默认音质已设为${PlaybackUtils.getQualityLabel(source, normalizedQuality)}`,
      );
      return;
    }

    const previousQuality = PlaybackUtils.normalizeQuality(
      source, track.playbackQuality || playbackState.qualityPreferences?.[source],
    );
    const songPosition = (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) +
      PlaybackUtils.getPlaybackLyricOffsetMs(track) / 1000;
    const requestGeneration = invalidatePlaybackRequests();
    playRequestSource = track.source;
    try {
      const streamTrack = { ...track };
      const streamUrl = await streamService.getTrackUrl(streamTrack, {
        forceRefresh: true,
        quality: normalizedQuality,
      });
      if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
      audioRequestGeneration = requestGeneration;
      if (!streamUrl) return;
      if (streamTrack.playbackQuality !== normalizedQuality) {
        toast(
          `${PlaybackUtils.getQualityLabel(source, normalizedQuality)}不可用，已保留${PlaybackUtils.getQualityLabel(source, previousQuality)}音质`,
        );
        return;
      }
      Object.assign(track, streamTrack);
      const resumeAt = Math.max(0, songPosition - PlaybackUtils.getPlaybackLyricOffsetMs(track) / 1000);

      const shouldResume = !audio.paused;
      audio.src = streamUrl;
      audio.load();
      audio.addEventListener(
        'loadedmetadata',
        () => {
          if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 1));
          }
        },
        { once: true },
      );
      if (shouldResume) {
        await preparePlaybackOutput(audio);
        if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
        await audio.play();
      }

      if (!isCurrentPlaybackRequest(requestGeneration, track)) return;

      toast(`已切换到${PlaybackUtils.getQualityLabel(source, normalizedQuality)}音质`);
    } catch (error) {
      if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
      audioRequestGeneration = requestGeneration;
      showError(error);
    } finally {
      if (isCurrentPlaybackRequest(requestGeneration, track)) {
        stateActions.setQuality(source, PlaybackUtils.normalizeQuality(source, track.playbackQuality || previousQuality));
        stateActions.commit();
      }
    }
  }

  async function togglePlayback(takeNextPlaybackTrack, showPlaybackLoginPrompt) {
    const audio = getPlaybackAudio();
    if (!audio) return;

    if (!playbackState.current) {
      const next = takeNextPlaybackTrack();
      if (next) {
        stateActions.selectTrack(next.track, next.origin);
      }
    }

    const track = playbackState.current;
    if (!track) {
      const playbackAuthState = getPlaybackAuthState();
      if (!playbackAuthState || !playbackAuthState.loggedIn) {
        showPlaybackLoginPrompt();
      } else {
        if (typeof utils.showStackedToast === 'function') {
          const sourceName = PlaybackUtils.getSourceName(playbackState.selectedSource);
          utils.showStackedToast({
            key: 'playback-queue-empty',
            title: '播放队列为空',
            message: `搜索${sourceName}歌曲并添加到播放队列`,
            className: 'playback-empty-queue-toast',
            duration: 4200,
          });
        } else {
          toast('播放队列为空，请先选择歌曲');
        }
      }
      return;
    }

    if (!audio.src || audio.dataset.trackId !== track.id) {
      await playPlaybackTrack(track, {
        origin: playbackState.currentOrigin,
        startAt: playbackState.restoredTime,
      });
      return;
    }

    if (audio.paused) {
      try {
        await preparePlaybackOutput(audio);
        if (playbackState.current !== track || !audio.paused) return;
        await audio.play();
      } catch (error) {
        if (!isInterruptedMediaPlayError(error)) showError(error);
      }
    } else {
      audio.pause();
      savePlaybackState();
    }
    renderPlayback();
  }

  async function playbackPrevious() {
    const audio = getPlaybackAudio();
    if (!audio) return;
    const useHistory = playbackState.queueType !== 'playlist' || playbackState.mode === 'shuffle';
    const historyTrack = useHistory ? playbackState.history.at(-1) : null;
    const playlistIndex = queueManager.getPreviousPlaylistIndex(historyTrack);
    const previousTrack = historyTrack || playbackState.normalQueueTracks[playlistIndex];
    if (previousTrack) {
      await playPlaybackTrack(previousTrack, {
        fromHistory: true,
        consumeHistory: Boolean(historyTrack),
        playlistIndex,
        origin: playlistIndex >= 0 ? 'normal' : 'history',
      });
    } else if (playbackState.current) {
      audio.currentTime = 0;
    }
  }

  function playbackNext(fromEnded, takeNextPlaybackTrack, ensurePlaybackRadioQueueFilled, options = {}) {
    const audio = getPlaybackAudio();
    if (!audio) return;
    const automatic = fromEnded || options.skipUnavailable === true;

    let repeat = fromEnded && playbackState.mode === 'repeat-one' && playbackState.current
      ? { track: playbackState.current, origin: playbackState.currentOrigin }
      : null;
    // 最多遍历当前队列和一轮歌单或一批电台补歌，避免全部不可播时无限推进。
    const remainingCount = queueManager.getActiveQueue().length;
    const playlistCount = playbackState.queueType === 'playlist' ? playbackState.normalQueueTracks.length : 0;
    const refillCount = playbackState.queueType === 'radio' ? PlaybackConfig.RADIO_REFILL_BATCH_SIZE : 0;
    const limit = automatic ? remainingCount + playlistCount + refillCount + (repeat ? 1 : 0) : 1;
    const attempted = new Set();
    let restarted = false;

    async function advance() {
      for (let index = 0; index < limit; index += 1) {
        let next = repeat || takeNextPlaybackTrack();
        repeat = null;
        if (!next && !restarted && playbackState.queueType === 'playlist' && playbackState.normalQueueTracks.length) {
          const tracks = playbackState.mode === 'shuffle'
            ? PlaybackUtils.shuffleTracks(playbackState.normalQueueTracks)
            : playbackState.normalQueueTracks.map((track) => ({ ...track }));
          next = { track: queueManager.restartPlaylist(tracks), origin: 'normal' };
          restarted = true;
          rebuildPlaybackShuffleOrder();
          savePlaybackState();
        }
        if (!next) break;
        const key = PlaybackUtils.getQueueTrackKey(next.track);
        if (attempted.has(key)) continue;
        attempted.add(key);

        const playing = playPlaybackTrack(next.track, { origin: next.origin });
        const requestGeneration = playRequestGeneration;
        if (playbackState.queueType === 'radio') ensurePlaybackRadioQueueFilled();
        if (!automatic) return;
        const played = await playing;
        if (requestGeneration !== playRequestGeneration || played !== false) return;
      }

      if (automatic) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      renderPlayback();
      savePlaybackState();
      syncPlaybackLyricWindow();
      if (playbackState.queueType === 'radio') ensurePlaybackRadioQueueFilled();
    }

    void advance();
  }

  return {
    playPlaybackTrack,
    changePlaybackQuality,
    togglePlayback,
    playbackPrevious,
    playbackNext,
    loadPlaybackLyrics,
    ensureLocalTrackPlayable,
    invalidatePlaybackRequests,
    suspendPlaybackForExternalSource,
    createPlaybackRequestGuard,
  };
}
