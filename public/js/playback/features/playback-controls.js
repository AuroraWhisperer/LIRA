// 编写人：Aurora
// 播放控制模块
'use strict';

import { createPlaybackStateActions } from '../state/actions.js';
import { PlaybackConfig } from '../config.js';

import * as PlaybackUtils from '../utils.js';
import { QueueManager } from '../queue/manager.js';
import { samePlaylistEntry } from '../queue/playlist-entries.js';
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
    renderPlaybackProgress,
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
  let lyricRequestGeneration = 0;
  let audioRequestGeneration = 0;
  let pendingQualityRequest = null;
  let playRequestSource = null;
  let playRequested = false;
  let waitingForRadio = false;
  let playlistAttempts = null;

  function invalidatePlaybackRequests(source, { keepLyrics = false } = {}) {
    if (source && source !== playRequestSource) return playRequestGeneration;
    playRequestGeneration += 1;
    pendingQualityRequest = null;
    if (!keepLyrics) lyricRequestGeneration += 1;
    waitingForRadio = false;
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
    return ({ requirePlayIntent = false } = {}) =>
      isCurrentPlaybackRequest(requestGeneration, track) && (!requirePlayIntent || playRequested);
  }

  function notePlaybackProgress(audio) {
    if (!playlistAttempts || !playbackState.current || !isCurrentPlaybackRequest(audioRequestGeneration, playbackState.current)) return;
    // Seeking or restoring a position alone does not add a played interval.
    const played = audio.played;
    for (let i = 0; i < (played?.length || 0); i++) {
      if (played.end(i) - played.start(i) >= 1) {
        playlistAttempts = null;
        break;
      }
    }
  }

  async function resumePlayback(audio, track) {
    const requestGeneration = playRequestGeneration;
    const isCurrent = () => isCurrentPlaybackRequest(requestGeneration, track);
    const source = audio.src;
    if (!isCurrent()) return;
    playRequested = true;
    try {
      await preparePlaybackOutput(audio);
      if (!isCurrent() || audio.src !== source || !audio.paused) return;
      await audio.play();
    } catch (error) {
      if (isCurrent() && !isInterruptedMediaPlayError(error)) showError(error);
    }
  }

  async function seekPlayback(time) {
    const audio = getPlaybackAudio();
    const track = playbackState.current;
    if (!audio?.src || !track || audio.dataset.trackId !== track.id || playbackState.selectedSource === 'wesing') return false;
    audio.currentTime = time;
    renderPlaybackProgress();
    syncPlaybackLyricWindow(true);
    savePlaybackState();
    if (audio.paused) await resumePlayback(audio, track);
    return true;
  }

  function applyRestoredTime() {
    const audio = getPlaybackAudio();
    const track = playbackState.current;
    if (!track || !audio.src || !playbackState.restoredTime ||
        !isCurrentPlaybackRequest(audioRequestGeneration, track) ||
        audio.readyState === 0 || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.min(playbackState.restoredTime, Math.max(0, audio.duration - 1));
    if (audio.dataset.trackId === track.id) stateActions.setRestoredTime(0);
  }

  function replacementStartTime(audio, current, replacement) {
    const hasCurrentAudio = audio.src && audio.dataset.trackId === current.id;
    // Legacy snapshots only saved excerpt seconds, without the original song offset.
    if (!hasCurrentAudio && !Object.hasOwn(current, 'playbackTrial')) return playbackState.restoredTime;
    const position = hasCurrentAudio && audio.readyState !== 0 && Number.isFinite(audio.currentTime)
      ? audio.currentTime : playbackState.restoredTime;
    const offsetChange = PlaybackUtils.getPlaybackLyricOffsetMs(current) - PlaybackUtils.getPlaybackLyricOffsetMs(replacement);
    return Math.max(0, position + offsetChange / 1000);
  }

  async function ensureLocalTrackPlayable(track) {
    if (!PlaybackUtils.isLocalTrack(track)) return true;
    if (track.objectUrl) {
      track.fileMissing = false;
      return true;
    }
    const generation = playRequestGeneration;
    const sourceEntry = playbackState.queueType === 'playlist'
      ? playbackState.normalQueueTracks[playbackState.playlistIndex] : null;

    // Try IPC restore from saved filePath
    let restored;
    if (track.filePath && window.musicAPI && typeof window.musicAPI.resolveLocalMediaUrls === 'function') {
      try {
        const res = await window.musicAPI.resolveLocalMediaUrls([track.filePath]);
        restored = res?.results?.[track.filePath];
      } catch (_) {}
    }
    if (generation !== playRequestGeneration) return false;
    if (restored?.ok) {
      track.objectUrl = restored.url;
      track.fileMissing = false;
      savePlaybackState();
      return true;
    }

    // File missing: prompt re-selection
    toast('文件已移动或删除，请重新选择本地文件');
    let updated;
    try { updated = await localFileManager.reselectLocalFile(track); } catch (_) {}
    if (generation !== playRequestGeneration) return false;
    if (updated?.objectUrl) {
      Object.assign(track, updated);
      track.fileMissing = false;
      if (sourceEntry?.source === 'local' && sourceEntry !== track && samePlaylistEntry(sourceEntry, track) &&
          playbackState.normalQueueTracks.includes(sourceEntry)) {
        Object.assign(sourceEntry, {
          filePath: updated.filePath, fileName: updated.fileName, objectUrl: updated.objectUrl, fileMissing: false,
        });
      }
      stateActions.commit();
      return true;
    }

    track.fileMissing = true;
    renderPlayback();
    return false;
  }

  async function playPlaybackTrack(track, options = {}) {
    const audio = getPlaybackAudio();
    if (!audio || !track) return;
    // Queue insertions can move this entry while its stream resolves.
    const playlistEntry = Number.isInteger(options.playlistIndex)
      ? playbackState.normalQueueTracks[options.playlistIndex] : null;
    const requestGeneration = invalidatePlaybackRequests(undefined, { keepLyrics: true });
    playRequestSource = track.source;
    if (!options.isRetry) playRequested = true;

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
    const resumeAt = options.resumeRestored || options.isRetry
      ? replacementStartTime(audio, playbackState.current, streamTrack) : 0;
    Object.assign(track, streamTrack);
    if (options.commitQueueTrack && !options.commitQueueTrack()) return false;
    if (options.commitCollection) track = options.commitCollection();

    if (!options.isRetry) {
      streamService.resetRetryCount();
      playlistAttempts = options.playlistAttempts || null;
    }
    if (playlistEntry) {
      const playlistIndex = playbackState.normalQueueTracks.indexOf(playlistEntry);
      if (!queueManager.jumpToPlaylistTrack(playlistIndex, options.dailySourceKey)) return false;
    }
    if (options.consumeHistory) stateActions.takePrevious();
    stateActions.setRestoredTime(resumeAt);
    lyricRequestGeneration += 1;
    stateActions.beginTrack(track, options);
    audioRequestGeneration = requestGeneration;
    audio.dataset.trackId = track.id;
    audio.src = streamUrl;
    audio.load();

    try {
      await preparePlaybackOutput(audio);
      if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
      if (playRequested) await audio.play();
      if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
      applyRestoredTime();
    } catch (error) {
      if (requestGeneration === playRequestGeneration && !isInterruptedMediaPlayError(error)) {
        showError(error);
      }
    }

    if (!isCurrentPlaybackRequest(requestGeneration, track)) return;

    loadPlaybackLyrics(track);
    stateActions.commit();
    updatePlaybackMediaSession();
    return true;
  }

  async function loadPlaybackLyrics(track) {
    if (!track) return;
    const request = ++lyricRequestGeneration;
    const lyrics = await lyricService.loadLyrics(track);
    if (request !== lyricRequestGeneration || playbackState.current?.id !== track.id ||
        playbackState.selectedSource === 'wesing') return;
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
      return;
    }

    const previousQuality = PlaybackUtils.normalizeQuality(
      source, track.playbackQuality || playbackState.qualityPreferences?.[source],
    );
    const requestGeneration = invalidatePlaybackRequests(undefined, { keepLyrics: true });
    pendingQualityRequest = { generation: requestGeneration, track };
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
      // A lyric refresh may have completed while the stream snapshot was resolving.
      delete streamTrack.lyrics;
      const resumeAt = replacementStartTime(audio, track, streamTrack);
      Object.assign(track, streamTrack);

      const shouldResume = !audio.paused;
      stateActions.setRestoredTime(resumeAt);
      audio.src = streamUrl;
      audio.load();
      if (shouldResume) {
        await preparePlaybackOutput(audio);
        if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
        await audio.play();
      }
    } catch (error) {
      if (!isCurrentPlaybackRequest(requestGeneration, track)) return;
      audioRequestGeneration = requestGeneration;
      showError(error);
    } finally {
      if (pendingQualityRequest?.generation === requestGeneration) pendingQualityRequest = null;
      if (isCurrentPlaybackRequest(requestGeneration, track)) {
        stateActions.setQuality(source, PlaybackUtils.normalizeQuality(source, track.playbackQuality || previousQuality));
        stateActions.commit();
      }
    }
  }

  async function togglePlayback(takeNextPlaybackTrack, showPlaybackLoginPrompt) {
    const audio = getPlaybackAudio();
    if (!audio) return;
    if (waitingForRadio) {
      audioRequestGeneration = invalidatePlaybackRequests();
      playRequested = false;
      audio.pause();
      savePlaybackState();
      renderPlayback();
      return;
    }

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
            className: 'toast-with-icon playback-empty-queue-toast',
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
        resumeRestored: true,
      });
      return;
    }

    if (audio.paused) {
      await resumePlayback(audio, track);
    } else {
      // Keep the selected track; only cancel its pending automatic start.
      playRequested = false;
      audio.pause();
      savePlaybackState();
    }
    renderPlayback();
  }

  async function playbackPrevious() {
    const audio = getPlaybackAudio();
    if (!audio) return;
    if (waitingForRadio) audioRequestGeneration = invalidatePlaybackRequests();
    const useHistory = playbackState.queueType !== 'playlist' || playbackState.mode === 'shuffle';
    const historyTrack = useHistory ? playbackState.history.at(-1) : null;
    const playlistIndex = queueManager.getPreviousPlaylistIndex(historyTrack);
    const previousTrack = playbackState.normalQueueTracks[playlistIndex] || historyTrack;
    if (previousTrack) {
      await playPlaybackTrack(previousTrack, {
        fromHistory: Boolean(historyTrack),
        consumeHistory: Boolean(historyTrack),
        playlistIndex,
        origin: playlistIndex >= 0 ? 'normal' : 'history',
      });
    } else if (playbackState.current) {
      stateActions.setRestoredTime(0);
      audio.currentTime = 0;
      renderPlaybackProgress();
      syncPlaybackLyricWindow(true);
      savePlaybackState();
    }
  }

  function playbackNext(fromEnded, takeNextPlaybackTrack, ensurePlaybackRadioQueueFilled, options = {}) {
    const audio = getPlaybackAudio();
    if (!audio) return;
    if (fromEnded) {
      const currentTrack = playbackState.current;
      const qualityPending = pendingQualityRequest && audio.dataset.trackId === pendingQualityRequest.track.id &&
        isCurrentPlaybackRequest(pendingQualityRequest.generation, pendingQualityRequest.track);
      if (!currentTrack || (!qualityPending && !isCurrentPlaybackRequest(audioRequestGeneration, currentTrack))) return;
      // Natural completion wins over a same-track quality replacement, even with no next track.
      if (qualityPending) invalidatePlaybackRequests();
    }
    if (waitingForRadio) audioRequestGeneration = invalidatePlaybackRequests();
    const automatic = fromEnded || options.skipUnavailable === true;

    let repeat = fromEnded && playbackState.mode === 'repeat-one' && playbackState.current
      ? { track: playbackState.current, origin: playbackState.currentOrigin }
      : null;
    // 最多遍历当前队列和一轮歌单或一批电台补歌，避免全部不可播时无限推进。
    const remainingCount = queueManager.getActiveQueue().length;
    const playlistCount = playbackState.queueType === 'playlist' ? playbackState.normalQueueTracks.length : 0;
    const refillCount = playbackState.queueType === 'radio' ? PlaybackConfig.RADIO_REFILL_BATCH_SIZE : 0;
    const limit = automatic ? remainingCount + playlistCount + refillCount + (repeat ? 1 : 0) : 1;
    const recoveringPlaylist = options.skipUnavailable && playlistCount > 0;
    const attempted = recoveringPlaylist && playlistAttempts ? playlistAttempts : new Set();
    if (recoveringPlaylist) attempted.add(PlaybackUtils.getQueueTrackKey(playbackState.current));
    let restarted = false;
    let waitedForRadio = false;

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
        if (!next && automatic && !waitedForRadio && playbackState.queueType === 'radio') {
          waitedForRadio = true;
          const queue = playbackState.radioQueue;
          const requestGeneration = playRequestGeneration;
          waitingForRadio = true;
          await ensurePlaybackRadioQueueFilled();
          if (requestGeneration !== playRequestGeneration) return;
          waitingForRadio = false;
          if (playbackState.queueType !== 'radio' || playbackState.radioQueue !== queue ||
              playbackState.selectedSource === 'wesing') return;
          next = takeNextPlaybackTrack();
        }
        if (!next) break;
        if (playbackState.queueType !== 'queue') {
          const key = PlaybackUtils.getQueueTrackKey(next.track);
          if (attempted.has(key)) continue;
          attempted.add(key);
        }

        const playing = playPlaybackTrack(next.track, {
          origin: next.origin,
          playlistAttempts: automatic && playlistCount ? attempted : null,
        });
        const requestGeneration = playRequestGeneration;
        if (playbackState.queueType === 'radio') ensurePlaybackRadioQueueFilled();
        if (!automatic) return;
        const played = await playing;
        if (requestGeneration !== playRequestGeneration || !playRequested || played !== false) return;
      }

      if (automatic) {
        playRequested = false;
        playlistAttempts = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      renderPlayback();
      savePlaybackState();
      syncPlaybackLyricWindow();
      if (playbackState.queueType === 'radio' && !waitedForRadio) ensurePlaybackRadioQueueFilled();
    }

    void advance();
  }

  return {
    playPlaybackTrack,
    changePlaybackQuality,
    togglePlayback,
    seekPlayback,
    applyRestoredTime,
    notePlaybackProgress,
    playbackPrevious,
    playbackNext,
    loadPlaybackLyrics,
    ensureLocalTrackPlayable,
    invalidatePlaybackRequests,
    suspendPlaybackForExternalSource,
    createPlaybackRequestGuard,
  };
}
