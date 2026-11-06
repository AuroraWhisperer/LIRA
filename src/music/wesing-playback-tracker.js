'use strict';

const PAUSED_AFTER_MS = 1500;
const AUDIO_PEAK_THRESHOLD = 0.001;
const PROGRESS_COMPENSATION_MS = 130;

function isWeSingAudioAudible(sample) {
  return sample.audioActive === true && Number(sample.audioPeak) > AUDIO_PEAK_THRESHOLD;
}

function createWeSingPlaybackTracker(getDurationMs) {
  let baseMs = 0;
  let startedAt = 0;
  let running = false;
  let lastProgressMs = -1;
  let lastProgressChangeAt = 0;
  let lastAudibleAt = -Infinity;
  let extrapolatingStaleProgress = false;
  let hasStartedCurrentTrack = false;
  let waitingForPlayback = true;

  function read(timestamp) {
    const elapsed = running ? Math.max(0, timestamp - startedAt) : 0;
    const currentMs = Math.max(0, baseMs + elapsed);
    const durationMs = Number(getDurationMs()) || 0;
    return durationMs > 0 ? Math.min(durationMs, currentMs) : currentMs;
  }

  function set(currentMs, timestamp) {
    baseMs = Math.max(0, Number(currentMs) || 0);
    startedAt = timestamp;
  }

  function start(timestamp) {
    if (running) return;
    startedAt = timestamp;
    running = true;
  }

  function pause(timestamp) {
    if (!running) return;
    baseMs = read(timestamp);
    startedAt = timestamp;
    running = false;
  }

  function reset(timestamp) {
    baseMs = 0;
    startedAt = timestamp;
    running = false;
    lastProgressMs = -1;
    lastProgressChangeAt = timestamp;
    lastAudibleAt = -Infinity;
    extrapolatingStaleProgress = false;
    hasStartedCurrentTrack = false;
    waitingForPlayback = true;
  }

  function sample(input, timestamp) {
    const currentSec = Number(input.currentSec);
    const hasSampledProgress = Number.isFinite(currentSec) && currentSec >= 0;
    const currentMs = hasSampledProgress ? currentSec * 1000 : null;
    const audioActive = input.audioActive === true ? true : input.audioActive === false ? false : null;
    let progressEvent = '';

    if (audioActive === false) {
      pause(timestamp);
      lastAudibleAt = -Infinity;
      // A frozen UI value must not rewind the clock after audio kept it moving.
      if (hasSampledProgress && (!extrapolatingStaleProgress || currentMs !== lastProgressMs)) {
        lastProgressMs = currentMs;
        lastProgressChangeAt = timestamp;
        extrapolatingStaleProgress = false;
        set(currentMs + PROGRESS_COMPENSATION_MS, timestamp);
      }
      waitingForPlayback = !hasStartedCurrentTrack;
      return snapshot(timestamp, progressEvent);
    }

    const hasAudibleAudio = isWeSingAudioAudible(input);
    if (hasAudibleAudio) lastAudibleAt = timestamp;
    if (hasSampledProgress) {
      const progressChanged = lastProgressMs >= 0 && currentMs !== lastProgressMs;
      const isFirstProgress = lastProgressMs < 0;
      const replayedFromStart = lastProgressMs > 3000 && currentMs <= 2000 && currentMs < lastProgressMs - 2000;
      if (progressChanged || isFirstProgress) extrapolatingStaleProgress = false;

      if (replayedFromStart) {
        pause(timestamp);
        lastProgressMs = currentMs;
        lastProgressChangeAt = timestamp;
        set(currentMs + PROGRESS_COMPENSATION_MS, timestamp);
        hasStartedCurrentTrack = currentMs > 0 || hasAudibleAudio;
        waitingForPlayback = !hasStartedCurrentTrack;
        if (hasStartedCurrentTrack) start(timestamp);
        progressEvent = 'replay';
      } else if (progressChanged) {
        lastProgressMs = currentMs;
        lastProgressChangeAt = timestamp;
        set(currentMs + PROGRESS_COMPENSATION_MS, timestamp);
        start(timestamp);
        hasStartedCurrentTrack = true;
        waitingForPlayback = false;
        progressEvent = 'advance';
      } else if (isFirstProgress) {
        lastProgressMs = currentMs;
        lastProgressChangeAt = timestamp;
        set(currentMs + PROGRESS_COMPENSATION_MS, timestamp);
        if (currentMs > 0 || hasAudibleAudio) {
          start(timestamp);
          hasStartedCurrentTrack = true;
          waitingForPlayback = false;
        } else {
          pause(timestamp);
          waitingForPlayback = true;
        }
      } else if (hasAudibleAudio ||
        (running && audioActive === true && timestamp - lastAudibleAt <= PAUSED_AFTER_MS)) {
        if (timestamp - lastProgressChangeAt > PAUSED_AFTER_MS) extrapolatingStaleProgress = true;
        start(timestamp);
        hasStartedCurrentTrack = true;
        waitingForPlayback = false;
      } else if (timestamp - lastProgressChangeAt > PAUSED_AFTER_MS) {
        pause(timestamp);
      }
    } else if (audioActive === true) {
      start(timestamp);
      hasStartedCurrentTrack = true;
      waitingForPlayback = false;
      progressEvent = 'audio';
    } else {
      pause(timestamp);
      waitingForPlayback = !hasStartedCurrentTrack;
    }
    return snapshot(timestamp, progressEvent);
  }

  function snapshot(timestamp, progressEvent) {
    return { currentMs: read(timestamp), playing: running, waitingForPlayback, progressEvent };
  }

  return { read, pause, reset, sample };
}

module.exports = { createWeSingPlaybackTracker, isWeSingAudioAudible };
