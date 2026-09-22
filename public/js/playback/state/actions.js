'use strict';

import { PlaybackConfig } from '../config.js';

// One owner for current track, history, preferences and pending requests.
// QueueManager owns queue transitions. Readers keep the same state identity.
export function createPlaybackStateActions(state, { save = () => {}, render = () => {} } = {}) {
  return {
    restore(snapshot) {
      Object.assign(state, snapshot);
    },
    selectSource(source) {
      state.selectedSource = source;
    },
    setMode(mode) {
      state.mode = mode;
    },
    setVolume(volume) {
      state.volume = volume;
    },
    setQuality(source, quality) {
      state.qualityPreferences[source] = quality;
    },
    clearDisplayHistory() {
      state.displayHistory = [];
    },
    clearHistory() {
      state.history = [];
    },
    clearPending() {
      state.pendingRequests = [];
    },
    addPending(request) {
      state.pendingRequests.push(request);
    },
    removePending(index) {
      return state.pendingRequests.splice(index, 1)[0];
    },
    takePrevious() {
      return state.history.pop();
    },
    selectTrack(track, origin) {
      state.current = track;
      state.currentOrigin = origin;
    },
    beginTrack(track, options = {}) {
      if (state.current && state.current.id !== track.id && !options.fromHistory) {
        state.history = [...state.history, state.current].slice(-PlaybackConfig.HISTORY_MAX_SIZE);
      }
      if (!options.fromHistory) {
        state.displayHistory = [
          { ...track, playedAt: Date.now() },
          ...state.displayHistory.filter((item) => item.id !== track.id),
        ].slice(0, PlaybackConfig.DISPLAY_HISTORY_MAX_SIZE);
      }
      state.current = track;
      state.currentOrigin = options.origin || state.currentOrigin || 'normal';
    },
    finishTrackStart() {
      state.restoredTime = 0;
    },
    clearCurrent() {
      state.current = null;
      state.currentOrigin = '';
      state.restoredTime = 0;
    },
    setLyrics(trackId, lyrics) {
      if (state.current?.id !== trackId) return false;
      state.current.lyrics = lyrics || { lines: [] };
      return true;
    },
    forgetProviderStreams(source) {
      [
        state.current,
        ...state.requestedQueue,
        ...state.normalQueue,
        ...state.normalQueueTracks,
        ...state.radioQueue,
        ...state.history,
      ].forEach((track) => {
        if (track?.source !== source) return;
        delete track.playUrl;
        delete track.playUrlExpireAt;
      });
    },
    commit() {
      save();
      render();
    },
  };
}
