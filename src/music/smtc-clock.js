'use strict';

function smtcPositionAt(clock, time) {
  const elapsed = clock.playing ? Math.max(0, time - clock.anchorAt) * clock.rate : 0;
  return Math.min(clock.duration, clock.anchorMs + elapsed);
}

function readSmtcClock(sample, time, previous) {
  const { positionMs: position, durationMs: duration, timelineUpdatedAt: stamp } = sample;
  const playing = sample.playbackStatus === 'Playing';
  const rate = Number.isFinite(sample.playbackRate) && sample.playbackRate > 0 ? sample.playbackRate : 1;
  const clock = { clockSource: 'smtc', position, duration, stamp, playing, rate, receivedAt: time, anchorMs: position, anchorAt: stamp };
  if (previous?.clockSource !== 'smtc') return clock;

  const transition = previous.playing !== playing || previous.rate !== rate;
  const sameReading = previous.stamp === stamp && previous.position === position;
  // A paused seek may be stamped before the poll that first observed the pause.
  if (!playing && !sameReading) return clock;
  if (sameReading || stamp < previous.anchorAt) {
    // Repeated readings and readings from before the last transition share the effective clock.
    clock.anchorMs = transition ? smtcPositionAt(previous, time) : previous.anchorMs;
    clock.anchorAt = transition ? time : previous.anchorAt;
  } else if (transition && stamp > previous.stamp && stamp <= previous.receivedAt) {
    // The position was recorded while the previous playback state was still observed.
    clock.anchorMs = smtcPositionAt({ ...clock, playing: previous.playing, rate: previous.rate }, time);
    clock.anchorAt = time;
  }
  return clock;
}

function hasTrackClockReset(previous, sample) {
  if (!previous) return false;
  if (sample.timelineUpdatedAt === previous.stamp && sample.positionMs === previous.position) return false;
  if (sample.durationMs !== previous.duration || sample.positionMs + 1000 < previous.position) return true;
  const stamp = sample.timelineUpdatedAt;
  // An advancing raw position can still be the old song, even when it lags the prediction.
  return sample.positionMs <= previous.position && previous.clockSource === 'smtc' &&
    stamp > previous.stamp && stamp >= previous.anchorAt &&
    sample.positionMs + 1000 < smtcPositionAt(previous, stamp);
}

module.exports = { hasTrackClockReset, readSmtcClock, smtcPositionAt };
