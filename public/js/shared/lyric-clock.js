'use strict';

const DEFAULT_DRIFT_THRESHOLD_MS = 350;

export class LyricClock {
  constructor(options = {}) {
    this.now = options.now || clockNow;
    this.driftThresholdMs = Number.isFinite(options.driftThresholdMs)
      ? Math.max(0, options.driftThresholdMs)
      : DEFAULT_DRIFT_THRESHOLD_MS;
    this.state = { currentMs: 0, durationMs: 0, progress: 0, playing: false };
    this.anchor = { currentMs: 0, durationMs: 0, progress: 0, updatedAt: this.now() };
    this.hasState = false;
  }

  setState(nextState = {}, options = {}) {
    const now = this.now();
    const previous = this.getPosition(now);
    const incomingCurrentMs = numberValue(nextState.currentMs, previous.currentMs);
    const durationMs = Math.max(0, numberValue(nextState.durationMs, this.anchor.durationMs));
    const playing = nextState.playing === true;
    const discontinuity = options.force === true || options.discontinuity === true;
    const drift = incomingCurrentMs - previous.currentMs;
    const shouldAnchor = !this.hasState || discontinuity || !playing || Math.abs(drift) > this.driftThresholdMs;
    const currentMs = shouldAnchor ? incomingCurrentMs : previous.currentMs;

    this.state = { ...this.state, ...nextState, playing, currentMs, durationMs };
    this.anchor = {
      currentMs: clampDuration(currentMs, durationMs),
      durationMs,
      progress: clamp(numberValue(nextState.progress, durationMs > 0 ? currentMs / durationMs : 0), 0, 1),
      updatedAt: now
    };
    this.hasState = true;
    return this.getPosition(now);
  }

  getPosition(now = this.now()) {
    const timestamp = numberValue(now, this.now());
    const elapsed = this.state.playing ? Math.max(0, timestamp - this.anchor.updatedAt) : 0;
    const currentMs = clampDuration(this.anchor.currentMs + elapsed, this.anchor.durationMs);
    const progress = this.anchor.durationMs > 0
      ? currentMs / this.anchor.durationMs
      : this.anchor.progress;
    return { currentMs, progress: clamp(progress, 0, 1) };
  }

  pause() {
    const position = this.getPosition();
    this.state.playing = false;
    this.anchor.currentMs = position.currentMs;
    this.anchor.updatedAt = this.now();
    return position;
  }

  dispose() {
    this.hasState = false;
  }
}

function clockNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampDuration(value, durationMs) {
  return durationMs > 0 ? clamp(value, 0, durationMs) : Math.max(0, value);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
