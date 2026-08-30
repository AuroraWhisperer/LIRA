'use strict';

import { LyricClock } from './lyric-clock.js';
import {
  LyricFrameScheduler,
  isDocumentVisible,
} from './lyric-frame-scheduler.js';

// The scheduler owns requestAnimationFrame and applies the 30fps time gate.

const EMPTY_STATE = {
  lineText: '',
  words: [],
  currentMs: 0,
  durationMs: 0,
  progress: 0,
  playing: false,
  status: 'idle',
};

export class LyricWordRenderer {
  constructor(options = {}) {
    this.lineElement = options.lineElement || null;
    this.progressElement = options.progressElement || null;
    this.wordClass = options.wordClass || 'lyric-word';
    this.progressProperty = options.progressProperty || '--word-progress';
    this.fallbackText = options.fallbackText || (() => '等待歌词');
    this.onFrame = options.onFrame || (() => {});
    this.onFrameBudget = options.onFrameBudget || (() => {});
    this.renderWords = options.renderWords !== false;
    this.state = { ...EMPTY_STATE };
    this.clock = options.clock || new LyricClock();
    this.scheduler =
      options.scheduler || new LyricFrameScheduler({ targetFps: 30 });
    this.signature = '';
    this.renderedWords = [];
    this.wordElements = [];
    this.visibilityHandler = () => {
      if (isDocumentVisible() && this.state.playing && !isReducedMotion()) {
        this.scheduler.start(this.renderFrame);
      } else if (!isDocumentVisible()) {
        this.scheduler.stop();
      }
    };
    if (typeof document !== 'undefined')
      document.addEventListener?.('visibilitychange', this.visibilityHandler);
  }

  setState(nextState = {}) {
    const previousPlaying = this.state.playing === true;
    this.state = { ...this.state, ...nextState };
    this.clock.setState(this.state, {
      force: true,
      discontinuity: this.state.discontinuity === true,
    });
    this.renderContent();
    if (this.state.playing && !isReducedMotion() && isDocumentVisible()) {
      this.scheduler.start(this.renderFrame);
    } else {
      this.scheduler.stop();
    }
    if (previousPlaying && !this.state.playing) this.clock.pause();
  }

  renderContent() {
    if (!this.lineElement) return;
    const words = Array.isArray(this.state.words) ? this.state.words : [];
    const fallback = this.fallbackText(this.state);
    const signature = JSON.stringify([
      this.state.lineText || fallback,
      words,
      this.renderWords,
    ]);
    if (signature === this.signature) {
      this.renderFrame(clockNow());
      return;
    }
    clearElement(this.lineElement);
    this.renderedWords = this.renderWords ? words : [];
    this.wordElements =
      this.renderWords && words.length > 0
        ? words.map((word) => {
            const element = document.createElement('span');
            element.className = this.wordClass;
            element.textContent = word.text || '';
            this.lineElement.appendChild(element);
            return element;
          })
        : [];
    if (!this.wordElements.length)
      this.lineElement.textContent = this.state.lineText || fallback;
    this.signature = signature;
    this.renderFrame(clockNow());
  }

  renderFrame = (now, elapsed = 0) => {
    this.onFrameBudget(elapsed);
    const position = this.clock.getPosition(now);
    if (this.progressElement)
      this.progressElement.style.transform = `scaleX(${position.progress})`;
    this.onFrame(position);

    this.wordElements.forEach((element, index) => {
      const word = this.renderedWords[index] || {};
      const startMs = numberValue(word.startMs, 0);
      const endMs = Math.max(startMs, numberValue(word.endMs, startMs));
      const progress =
        endMs > startMs
          ? clamp((position.currentMs - startMs) / (endMs - startMs), 0, 1)
          : position.currentMs >= endMs
            ? 1
            : 0;
      element.style.setProperty(this.progressProperty, `${progress * 100}%`);
    });
  };

  getPosition(now) {
    return this.clock.getPosition(now);
  }

  dispose() {
    this.scheduler.stop();
    this.clock.dispose();
    if (typeof document !== 'undefined')
      document.removeEventListener?.(
        'visibilitychange',
        this.visibilityHandler,
      );
  }
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clockNow() {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function clearElement(element) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else element.textContent = '';
}
