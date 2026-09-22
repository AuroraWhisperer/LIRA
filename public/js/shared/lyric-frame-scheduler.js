'use strict';

const DEFAULT_TARGET_FPS = 30;

export class LyricFrameScheduler {
  constructor(options = {}) {
    this.targetFps = Number.isFinite(options.targetFps) ? options.targetFps : DEFAULT_TARGET_FPS;
    this.callback = null;
    this.frame = 0;
    this.lastUpdateAt = 0;
    this.running = false;
    this.boundFrame = (now) => this.onFrame(now);
  }

  start(callback) {
    this.callback = callback || this.callback;
    if (this.running || typeof this.callback !== 'function') return;
    this.running = true;
    this.lastUpdateAt = 0;
    this.request();
  }

  stop() {
    this.running = false;
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  setTargetFps(fps) {
    if (Number.isFinite(fps) && fps > 0) this.targetFps = fps;
  }

  onFrame(now) {
    this.frame = 0;
    if (!this.running) return;
    if (!isDocumentVisible()) {
      this.stop();
      return;
    }
    const interval = 1000 / this.targetFps;
    const elapsed = this.lastUpdateAt > 0 ? now - this.lastUpdateAt : interval;
    if (elapsed >= interval) {
      this.lastUpdateAt = now;
      this.callback(now, elapsed);
    }
    this.request();
  }

  request() {
    if (this.running && typeof requestAnimationFrame === 'function') {
      this.frame = requestAnimationFrame(this.boundFrame);
    }
  }
}

export function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}
