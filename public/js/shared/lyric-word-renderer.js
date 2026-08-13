'use strict';

const EMPTY_STATE = {
  lineText: '', words: [], currentMs: 0, durationMs: 0,
  progress: 0, playing: false, status: 'idle'
};

/**
 * Provider-independent word-level lyric renderer.
 *
 * The caller supplies DOM elements and CSS names, so the WeSing playback page
 * and the desktop-lyric preview can share timing behavior without sharing UI.
 */
export class LyricWordRenderer {
  constructor(options = {}) {
    this.lineElement = options.lineElement || null;
    this.progressElement = options.progressElement || null;
    this.wordClass = options.wordClass || 'lyric-word';
    this.progressProperty = options.progressProperty || '--word-progress';
    this.fallbackText = options.fallbackText || (() => '等待歌词');
    this.onFrame = options.onFrame || (() => {});
    this.state = { ...EMPTY_STATE };
    this.anchor = {
      currentMs: 0,
      durationMs: 0,
      progress: 0,
      updatedAt: clockNow()
    };
    this.signature = '';
    this.renderedWords = [];
    this.wordElements = [];
    this.animationFrame = 0;
  }

  setState(nextState = {}) {
    const now = clockNow();
    const estimated = this.getPosition(now);
    const playing = nextState.playing === true;
    const incomingCurrentMs = numberValue(nextState.currentMs, estimated.currentMs);
    this.state = { ...this.state, ...nextState };
    this.anchor = {
      currentMs: incomingCurrentMs,
      durationMs: numberValue(nextState.durationMs, this.anchor.durationMs),
      progress: numberValue(nextState.progress, estimated.progress),
      updatedAt: now
    };
    this.renderContent();
  }

  renderContent() {
    if (!this.lineElement) return;
    const words = Array.isArray(this.state.words) ? this.state.words : [];
    const fallback = this.fallbackText(this.state);
    const signature = JSON.stringify([this.state.lineText || fallback, words]);
    if (signature !== this.signature) {
      clearElement(this.lineElement);
      if (words.length > 0) {
        this.renderedWords = words;
        this.wordElements = words.map((word) => {
          const element = document.createElement('span');
          element.className = this.wordClass;
          element.textContent = word.text || '';
          this.lineElement.appendChild(element);
          return element;
        });
      } else {
        this.renderedWords = [];
        this.wordElements = [];
        this.lineElement.textContent = this.state.lineText || fallback;
      }
      this.signature = signature;
    }
    cancelFrame(this.animationFrame);
    this.renderFrame(clockNow());
  }

  renderFrame = (now) => {
    this.animationFrame = 0;
    const position = this.getPosition(now);
    if (this.progressElement) this.progressElement.style.transform = `scaleX(${position.progress})`;
    this.onFrame(position);

    this.wordElements.forEach((element, index) => {
      const word = this.renderedWords[index] || {};
      const startMs = numberValue(word.startMs, 0);
      const endMs = Math.max(startMs, numberValue(word.endMs, startMs));
      const progress = endMs > startMs
        ? clamp((position.currentMs - startMs) / (endMs - startMs), 0, 1)
        : position.currentMs >= endMs ? 1 : 0;
      element.style.setProperty(this.progressProperty, `${progress * 100}%`);
    });

    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.state.playing && !reducedMotion) {
      this.animationFrame = requestFrame(this.renderFrame);
    }
  };

  getPosition(now) {
    const elapsed = this.state.playing ? Math.max(0, now - this.anchor.updatedAt) : 0;
    const durationMs = Math.max(0, this.anchor.durationMs);
    const currentMs = durationMs > 0
      ? Math.min(durationMs, this.anchor.currentMs + elapsed)
      : Math.max(0, this.anchor.currentMs + elapsed);
    const progress = durationMs > 0 ? currentMs / durationMs : this.anchor.progress;
    return { currentMs, progress: clamp(progress, 0, 1) };
  }

  dispose() {
    cancelFrame(this.animationFrame);
    this.animationFrame = 0;
  }
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

// Tests and non-browser consumers may not provide the high-resolution browser clock.
function clockNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

// Electron always supplies animation frames; returning zero keeps static renderers usable elsewhere.
function requestFrame(callback) {
  return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : 0;
}

function cancelFrame(frame) {
  if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
}

function clearElement(element) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else element.textContent = '';
}
