'use strict';

const DRIFT_THRESHOLD_MS = 180;

export class LyricWordAnimator {
  constructor(options = {}) {
    this.wordClass = options.wordClass || 'lyric-word';
    this.highlightClass = options.highlightClass || 'lyric-word-highlight';
    this.mode = options.mode || (LyricWordAnimator.supported() ? 'waapi' : 'manual');
    this.motionEnabled = options.motionEnabled === true;
    this.animations = [];
    this.words = [];
    this.elements = [];
    this.container = null;
    this.signature = '';
    this.discreteCursor = 0;
    this.discreteLastMs = null;
  }

  mount(lineElement, words, options = {}) {
    this.clear({ commit: false });
    this.container = lineElement || null;
    this.words = Array.isArray(words) ? words : [];
    this.mode = options.mode || this.mode;
    this.signature = JSON.stringify(this.words);
    if (!this.container || !this.words.length) return;

    this.words.forEach((word) => {
      const wrapper = document.createElement('span');
      wrapper.className = this.wordClass;
      const base = document.createElement('span');
      base.className = `${this.wordClass}-base`;
      base.textContent = word.text || '';
      const highlight = document.createElement('span');
      highlight.className = this.highlightClass;
      highlight.textContent = word.text || '';
      highlight.setAttribute('aria-hidden', 'true');
      wrapper.append(base, highlight);
      this.container.appendChild(wrapper);
      const entry = { wrapper, highlight, word, state: null };
      this.elements.push(entry);
      if (this.mode === 'discrete') setDiscreteState(entry, false);
    });
  }

  sync(position = {}, options = {}) {
    const currentMs = Number(position.currentMs) || 0;
    const playing = options.playing === true;
    const force = options.force === true;
    this.syncMotion(currentMs, playing, force);
    if (this.mode === 'discrete') {
      this.syncDiscrete(currentMs);
      return;
    }
    this.elements.forEach((entry, index) => {
      const startMs = numberValue(entry.word.startMs, 0);
      const endMs = Math.max(startMs, numberValue(entry.word.endMs, startMs));
      const progress =
        endMs > startMs ? clamp((currentMs - startMs) / (endMs - startMs), 0, 1) : currentMs >= endMs ? 1 : 0;
      const animationTime = clamp(currentMs - startMs, 0, Math.max(1, endMs - startMs));
      if (this.mode === 'waapi' && typeof entry.highlight.animate === 'function'
        && currentMs >= startMs && currentMs < endMs) {
        let animation = this.animations[index];
        if (!animation) {
          animation = entry.highlight.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], {
            duration: Math.max(1, endMs - startMs),
            fill: 'both',
            easing: 'linear',
          });
          animation.pause();
          this.animations[index] = animation;
        }
        const shouldAnchor =
          force ||
          !playing ||
          animation.playState === 'paused' ||
          animation.currentTime === null ||
          Math.abs(Number(animation.currentTime) - animationTime) > DRIFT_THRESHOLD_MS;
        if (!playing && animation.playState !== 'paused') animation.pause();
        // Set the hold time after pause(), which otherwise settles on a later frame.
        if (shouldAnchor && (animation.currentTime !== animationTime || (!playing && animation.pending))) {
          animation.currentTime = animationTime;
        }
        if (playing) {
          if (animation.playState !== 'running') animation.play();
        }
      } else {
        const clipPath = `inset(0 ${this.mode === 'static' ? progress >= 1 ? 0 : 100 : 100 - progress * 100}% 0 0)`;
        if (entry.clipPath !== clipPath) {
          entry.highlight.style.clipPath = clipPath;
          entry.clipPath = clipPath;
        }
        // Upcoming/completed words keep their fill without a live animation effect.
        this.animations[index]?.cancel();
        this.animations[index] = null;
      }
    });
  }

  syncDiscrete(currentMs) {
    const targetMs = Number.isFinite(Number(currentMs)) ? Number(currentMs) : 0;
    if (this.discreteLastMs !== null && targetMs < this.discreteLastMs) {
      this.discreteCursor = 0;
      this.elements.forEach((entry) => setDiscreteState(entry, false));
    }
    while (this.discreteCursor < this.elements.length) {
      const entry = this.elements[this.discreteCursor];
      const startMs = numberValue(entry.word.startMs, 0);
      if (startMs > targetMs) break;
      setDiscreteState(entry, true);
      this.discreteCursor += 1;
    }
    this.discreteLastMs = targetMs;
  }

  syncMotion(currentMs, playing, force) {
    if (!this.motionEnabled || !['waapi', 'discrete'].includes(this.mode)) return;
    this.elements.forEach((entry) => {
      const startMs = numberValue(entry.word.startMs, 0);
      const sungMs = Math.max(180, numberValue(entry.word.endMs, startMs) - startMs);
      const duration = sungMs + 180;
      const time = currentMs - startMs;
      if (time < 0 || time >= duration) {
        entry.motion?.cancel();
        entry.motion = null;
        return;
      }
      if (typeof entry.wrapper.animate !== 'function' || !entry.word.text?.trim()) return;
      if (!entry.motion) {
        // Bound horizontal growth for multi-character timing tokens; never invent syllable times.
        const growth = 0.045 / Math.max(1, Array.from(entry.word.text).length);
        entry.motion = entry.wrapper.animate([
          { transform: 'translateY(0) scale(1)', offset: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
          { transform: `translateY(-0.09em) scale(${1 + growth})`, offset: Math.min(120, sungMs * 0.3) / duration,
            easing: 'ease-in-out' },
          { transform: `translateY(-0.065em) scale(${1 + growth * 0.6})`, offset: Math.min(260, sungMs * 0.7) / duration },
          { transform: `translateY(-0.065em) scale(${1 + growth * 0.6})`, offset: sungMs / duration,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
          { transform: 'translateY(0) scale(1)', offset: 1 },
        ], { duration, fill: 'both' });
        entry.motion.pause();
      }
      const animation = entry.motion;
      if (!playing && animation.playState !== 'paused') animation.pause();
      if ((force || !playing || animation.playState !== 'running'
        || Math.abs(Number(animation.currentTime) - time) > DRIFT_THRESHOLD_MS)
        && (animation.currentTime !== time || (!playing && animation.pending))) animation.currentTime = time;
      if (playing && animation.playState !== 'running') animation.play();
    });
  }

  setMotionEnabled(enabled) {
    this.motionEnabled = enabled === true;
    if (!this.motionEnabled) this.clearMotion();
  }

  clearMotion() {
    this.elements.forEach((entry) => {
      entry.motion?.cancel();
      entry.motion = null;
    });
  }

  clear(options = {}) {
    this.clearMotion();
    this.animations.forEach((animation) => animation?.cancel?.());
    this.animations = [];
    if (options.commit && this.container)
      this.container.textContent = this.words.map((word) => word.text || '').join('');
    else if (this.container) this.container.replaceChildren?.();
    this.container = null;
    this.elements = [];
    this.words = [];
    this.signature = '';
    this.discreteCursor = 0;
    this.discreteLastMs = null;
  }

  setMode(mode) {
    if (!['waapi', 'manual', 'static', 'discrete'].includes(mode)) return;
    if (mode === this.mode) return;
    this.clearMotion();
    this.animations.forEach((animation) => animation?.cancel?.());
    this.animations = [];
    if (this.mode === 'discrete' && mode !== 'discrete') {
      this.elements.forEach((entry) => setDiscreteState(entry, false));
    }
    if (mode === 'discrete' && this.mode !== 'discrete') {
      this.discreteCursor = 0;
      this.discreteLastMs = null;
      this.elements.forEach((entry) => {
        entry.highlight.style.clipPath = '';
        entry.clipPath = null;
        setDiscreteState(entry, false);
      });
    }
    this.mode = mode;
  }

  dispose() {
    this.clear({ commit: false });
  }

  static supported() {
    const hasAnimation = typeof Element !== 'undefined' && typeof Element.prototype?.animate === 'function';
    const cssApi = globalThis.CSS;
    const hasClipPath =
      typeof cssApi === 'undefined' ||
      typeof cssApi.supports !== 'function' ||
      cssApi.supports('clip-path', 'inset(0 100% 0 0)');
    return hasAnimation && hasClipPath;
  }
}

function setDiscreteState(entry, complete) {
  if (!entry || !entry.wrapper) return;
  const state = complete ? 'complete' : 'upcoming';
  if (entry.state === state) return;
  entry.state = state;
  entry.wrapper.dataset.wordState = state;
  entry.wrapper.classList.toggle('is-complete', complete);
  entry.wrapper.classList.toggle('is-upcoming', !complete);
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
