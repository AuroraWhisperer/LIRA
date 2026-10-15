// 桌面歌词设置实时预览：完整歌词时间轴 + 当前行逐字进度。
'use strict';

import { LyricWordRenderer } from '../shared/lyric-word-renderer.js';
import { LyricWordAnimator } from '../shared/lyric-word-animator.js';
import { createLyricPerformanceProfile } from '../shared/lyric-performance.js';
import {
  resolveLyricTime,
  resolveNoLyricText as resolveNoLyricTextValue,
  normalizeDesktopLyricSettings,
} from './desktop-lyric-settings.js';
import { DESKTOP_LYRIC_DEFAULTS } from './desktop-lyric-defaults.js';
import {
  calculateFollowTarget,
  findActiveLyricIndex,
  getLyricCountdown,
  getVisibleLyricRange,
  stepSpringScroll,
} from './desktop-lyric-timeline.js';
import { applyDesktopLyricStyles } from './desktop-lyric-styles.js';
import { createLyricLineTransition } from './desktop-lyric-line-transition.js';

export { calculateFollowTarget, findActiveLyricIndex, getLyricCountdown, getVisibleLyricRange, stepSpringScroll };

export { resolveDesktopLyricSettings, resolveLyricTime, resolveNoLyricText };

function resolveDesktopLyricSettings(settings = {}) {
  return normalizeDesktopLyricSettings(settings, DESKTOP_LYRIC_DEFAULTS);
}

function resolveNoLyricText(timeline, settings) {
  return resolveNoLyricTextValue(timeline, settings, DESKTOP_LYRIC_DEFAULTS);
}

const EMPTY_TIMELINE = {
  trackTitle: '',
  artists: [],
  status: 'idle',
  lines: [],
};
const MANUAL_FOLLOW_PAUSE_MS = 6000;
// Per-token inline blocks break joining scripts, combining marks and decomposed Hangul.
const JOINED_TEXT = /\p{Mark}|[\u0590-\u11FF\u1780-\u17FF\uA960-\uA97F\uA9E0-\uA9FF\uAA60-\uAA7F\uD7B0-\uD7FF]/u;

let initialized = false;
let renderer = null;
let latestState = null;
let latestTimeline = EMPTY_TIMELINE;
let timelineSignature = '';
let settingsSignature = '';
let timelineElement = null;
let viewport = null;
let countdownElement = null;
let countdownSignature = '';
let rowElements = [];
let activeIndex = -1;
let activeWordIndex = -1;
let activeWordSignature = '';
let activeWordAnimator = null;
let latestWordSignature = '';
let performanceProfile = null;
let lastLyricGeneration = null;
let lastLyricSequence = 0;
let manualFollowUntil = 0;
let followResumeTimer = 0;
let followAnimationFrame = 0;
let followPosition = 0;
let followVelocity = 0;
let followTarget = 0;
let followFrameAt = 0;
let lineTransition = null;
let immediateLineChange = false;
let currentDisplaySettings = resolveDesktopLyricSettings();

function init() {
  if (initialized) return true;
  const stage = document.getElementById('desktopLyricPreviewStage');
  const playback = document.getElementById('desktopLyricPreviewPlayback');
  timelineElement = document.getElementById('desktopLyricPreviewTimeline');
  viewport = document.getElementById('desktopLyricPreviewViewport');
  if (!stage || !playback || !timelineElement || !viewport) return false;
  initialized = true;
  lineTransition = createLyricLineTransition(viewport, timelineElement);

  renderer = new LyricWordRenderer({
    lineElement: playback,
    visibilityElement: stage,
    renderWords: false,
    wordClass: 'desktop-lyric-preview-live-word',
    progressProperty: '--preview-word-progress',
    fallbackText: previewFallback,
    onFrameBudget: (duration) => performanceProfile?.recordFrame(duration),
    onFrame: (position) => renderTimelineFrame(position.currentMs),
    onVisibilityChange: (visible) => {
      if (visible) followActiveLyric();
      else {
        stopFollowAnimation();
        lineTransition?.clear();
        updateActiveWordProgress(resolveLyricTime(currentPreviewPosition(), currentDisplaySettings));
      }
    },
  });
  performanceProfile = createLyricPerformanceProfile({
    onChange: (profile) => {
      activeWordAnimator?.setMode(resolveWordAnimationMode(profile));
      activeWordAnimator?.setMotionEnabled(profile.effects === 'full');
      stage.classList.toggle('is-low-power', profile.effects === 'low');
    },
  });
  activeWordAnimator = new LyricWordAnimator({
    mode: resolveWordAnimationMode(),
    motionEnabled: performanceProfile.profile.effects === 'full',
    wordClass: 'desktop-lyric-preview-word',
    highlightClass: 'desktop-lyric-preview-word-highlight',
  });
  stage.classList.toggle('is-low-power', performanceProfile.profile.effects === 'low');

  viewport.addEventListener('wheel', pauseAutomaticFollow, { passive: true });
  viewport.addEventListener('touchstart', pauseAutomaticFollow, {
    passive: true,
  });
  viewport.addEventListener('pointerdown', pauseAutomaticFollow, {
    passive: true,
  });
  viewport.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      pauseAutomaticFollow();
    }
  });
  window.addEventListener('resize', followActiveLyric);
  document.fonts?.addEventListener?.('loadingdone', followActiveLyric);
  return true;
}

function updateLyricState(state) {
  if (!state || typeof state !== 'object') return;
  if (!acceptLyricVersion(state)) return;
  const previousState = latestState;
  latestState = { ...(latestState || {}), ...state };
  latestWordSignature = JSON.stringify([latestState.lineText || '', latestState.words || []]);
  immediateLineChange = state.discontinuity === true || latestState.generation !== previousState?.generation
    || latestState.trackTitle !== previousState?.trackTitle;
  if (immediateLineChange) lineTransition?.clear();
  renderer?.setState({ ...latestState, discontinuity: state.discontinuity === true });
  immediateLineChange = false;
  renderActiveWords();
  if (state.discontinuity === true || latestState.generation !== previousState?.generation
    || latestState.trackTitle !== previousState?.trackTitle) {
    updateActiveWordProgress(resolveLyricTime(currentPreviewPosition(), currentDisplaySettings), true);
  }
  applyPlaybackVisibility();
  updatePreviewStatus();
}

function updateLyricTimeline(timeline) {
  if (!timeline || typeof timeline !== 'object') return;
  const nextTimeline = {
    ...EMPTY_TIMELINE,
    ...timeline,
    lines: Array.isArray(timeline.lines) ? timeline.lines : [],
  };
  const signature = JSON.stringify(nextTimeline);
  if (signature === timelineSignature) return;
  timelineSignature = signature;
  latestTimeline = nextTimeline;
  clearTimeout(followResumeTimer);
  manualFollowUntil = 0;
  viewport?.classList.remove('is-manual-browsing');
  renderTimeline();
  updatePreviewStatus();
}

function renderTimeline() {
  if (!timelineElement) return;
  lineTransition?.clear();
  const fragment = document.createDocumentFragment();
  rowElements = [];
  countdownElement = null;
  countdownSignature = '';
  activeIndex = -1;
  stopFollowAnimation();
  followPosition = viewport?.scrollTop || 0;
  followVelocity = 0;
  resetActiveWords();

  if (!latestTimeline.lines.length) {
    const empty = document.createElement('div');
    empty.className = 'desktop-lyric-preview-empty';
    empty.textContent = timelineFallback(latestTimeline, currentDisplaySettings);
    fragment.appendChild(empty);
  } else {
    latestTimeline.lines.forEach((line, index) => {
      const row = document.createElement('div');
      row.className = 'desktop-lyric-preview-row';
      row.dataset.lyricIndex = String(index);
      row.setAttribute('role', 'listitem');

      const text = document.createElement('div');
      text.className = 'desktop-lyric-preview-row-text';
      text.setAttribute('dir', 'auto');
      text.textContent = line.text || '';
      row.appendChild(text);

      if (line.translation) {
        const translation = document.createElement('div');
        translation.className = 'desktop-lyric-preview-row-translation';
        translation.setAttribute('dir', 'auto');
        translation.textContent = line.translation;
        row.appendChild(translation);
      }
      if (line.roma) {
        const roma = document.createElement('div');
        roma.className = 'desktop-lyric-preview-row-roma';
        roma.setAttribute('dir', 'auto');
        roma.textContent = line.roma;
        row.appendChild(roma);
      }

      rowElements.push(row);
      fragment.appendChild(row);
    });
    countdownElement = createCountdownElement();
    fragment.appendChild(countdownElement);
  }

  timelineElement.replaceChildren(fragment);
  renderTimelineFrame(currentPreviewPosition());
}

function createCountdownElement() {
  const countdown = document.createElement('div');
  countdown.className = 'desktop-lyric-preview-countdown';
  countdown.setAttribute('role', 'status');
  countdown.hidden = true;
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'desktop-lyric-preview-countdown-dot';
    dot.setAttribute('aria-hidden', 'true');
    countdown.appendChild(dot);
  }
  return countdown;
}

function renderTimelineFrame(currentMs) {
  const lines = latestTimeline.lines;
  if (!lines.length) return;
  const lyricTime = resolveLyricTime(currentMs, currentDisplaySettings);
  const nextActiveIndex = findActiveLyricIndex(lines, lyricTime);

  if (nextActiveIndex !== activeIndex) {
    const canTransition = activeIndex >= 0 && nextActiveIndex === activeIndex + 1
      && !immediateLineChange && latestState?.playing === true && Date.now() >= manualFollowUntil;
    const positions = canTransition ? lineTransition?.capture(rowElements,
      getVisibleLyricRange(nextActiveIndex, currentDisplaySettings.visibleLines, rowElements.length)) : null;
    if (!positions) lineTransition?.clear();
    activeIndex = nextActiveIndex;
    rowElements.forEach((row, index) => {
      row.classList.toggle('is-past', index < activeIndex);
      row.classList.toggle('is-near', activeIndex >= 0 && Math.abs(index - activeIndex) <= 1);
      row.classList.toggle('is-active', index === activeIndex);
    });
    applyVisibleLineWindow();
    resetActiveWords();
    renderActiveWords();
    updateCountdown(lyricTime);
    followActiveLyric();
    if (positions) lineTransition.play(rowElements, positions);
  } else {
    updateCountdown(lyricTime);
  }

  updateActiveWordProgress(lyricTime);
}

function renderActiveWords() {
  if (activeIndex < 0 || !rowElements[activeIndex]) return;
  if (!currentDisplaySettings.karaokeEnabled || (latestTimeline.trackTitle && latestState?.trackTitle
    && latestTimeline.trackTitle !== latestState.trackTitle)) {
    resetActiveWords();
    return;
  }
  const line = latestTimeline.lines[activeIndex] || {};
  const timelineWords = Array.isArray(line.words) && line.words.length > 0 ? line.words : null;
  const words = timelineWords || (Array.isArray(latestState?.words) ? latestState.words : []);
  const matchesCurrentLine = latestState?.lineText === line.text;
  // Preloaded timing lets the local clock cross a line before the next state sample.
  if (!timelineWords && !matchesCurrentLine && activeWordIndex === activeIndex) return;
  const wordSignature = timelineWords ? JSON.stringify(timelineWords) : matchesCurrentLine ? latestWordSignature : '';
  const signature = `${activeIndex}:${wordSignature}`;
  if (signature === activeWordSignature) return;

  resetActiveWords();
  const textElement = rowElements[activeIndex].querySelector('.desktop-lyric-preview-row-text');
  if (!textElement || (!timelineWords && !matchesCurrentLine) || !words.length || JOINED_TEXT.test(line.text || '')) {
    activeWordSignature = signature;
    return;
  }

  textElement.replaceChildren();
  activeWordAnimator?.mount(textElement, words, {
    mode: resolveWordAnimationMode(),
  });
  activeWordIndex = activeIndex;
  activeWordSignature = signature;
  updateActiveWordProgress(resolveLyricTime(currentPreviewPosition(), currentDisplaySettings));
}

function resetActiveWords() {
  const previousIndex = activeWordIndex;
  activeWordAnimator?.clear({ commit: false });
  if (previousIndex >= 0 && rowElements[previousIndex]) {
    const textElement = rowElements[previousIndex].querySelector('.desktop-lyric-preview-row-text');
    if (textElement) textElement.textContent = latestTimeline.lines[previousIndex]?.text || '';
  }
  activeWordIndex = -1;
  activeWordSignature = '';
}

function updateActiveWordProgress(currentMs, force = false) {
  activeWordAnimator?.sync({ currentMs }, {
    playing: latestState?.playing === true && renderer?.isVisible() !== false, force,
  });
}

function resolveWordAnimationMode(profile = performanceProfile?.profile) {
  if (currentDisplaySettings.karaokeMode === 'discrete') return 'discrete';
  return profile?.wordAnimation || 'waapi';
}

function acceptLyricVersion(state) {
  const hasVersion = Number.isFinite(Number(state.generation)) && Number.isFinite(Number(state.sequence));
  if (!hasVersion) return lastLyricGeneration === null;
  const generation = Number(state.generation);
  const sequence = Number(state.sequence);
  if (lastLyricGeneration === null || generation > lastLyricGeneration) {
    lastLyricGeneration = generation;
    lastLyricSequence = sequence;
    return true;
  }
  if (generation < lastLyricGeneration || sequence <= lastLyricSequence) return false;
  lastLyricSequence = sequence;
  return true;
}

function applyVisibleLineWindow() {
  const range = getVisibleLyricRange(activeIndex, currentDisplaySettings.visibleLines, rowElements.length);
  rowElements.forEach((row, index) => {
    row.classList.toggle('is-line-hidden', index < range.first || index > range.last);
  });
}

function updateCountdown(currentMs) {
  if (!countdownElement || !timelineElement) return;
  const countdown = getLyricCountdown(latestTimeline.lines, activeIndex, currentMs);
  const signature = countdown ? `${countdown.nextIndex}:${countdown.seconds}` : '';
  if (signature === countdownSignature) return;
  countdownSignature = signature;
  if (!countdown) {
    countdownElement.hidden = true;
    return;
  }

  const nextRow = rowElements[countdown.nextIndex];
  if (nextRow && countdownElement.nextElementSibling !== nextRow) {
    timelineElement.insertBefore(countdownElement, nextRow);
  }
  countdownElement.hidden = false;
  countdownElement.setAttribute('aria-label', `距离下一句 ${countdown.seconds} 秒`);
  const activeDot = 3 - countdown.seconds;
  Array.from(countdownElement.children).forEach((dot, index) => {
    dot.classList.toggle('is-active', index === activeDot);
    dot.classList.toggle('is-elapsed', index < activeDot);
  });
}

function followActiveLyric() {
  if (renderer?.isVisible() === false || activeIndex < 0 || Date.now() < manualFollowUntil) return;
  const activeRow = rowElements[activeIndex];
  if (!activeRow || !viewport || viewport.clientHeight <= 0) return;
  followTarget = calculateFollowTarget(
    activeRow.offsetTop,
    activeRow.offsetHeight,
    viewport.clientHeight,
    viewport.scrollHeight,
    currentDisplaySettings.alignPosition,
    currentDisplaySettings.alignAnchor,
  );
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!currentDisplaySettings.springAnimation || reducedMotion || typeof requestAnimationFrame !== 'function') {
    stopFollowAnimation();
    followPosition = followTarget;
    followVelocity = 0;
    viewport.scrollTop = followTarget;
    return;
  }
  if (followAnimationFrame) return;
  followPosition = viewport.scrollTop;
  followFrameAt = 0;
  viewport.classList.add('is-following');
  followAnimationFrame = requestAnimationFrame(animateLyricFollow);
}

function animateLyricFollow(now) {
  followAnimationFrame = 0;
  if (!viewport || Date.now() < manualFollowUntil) {
    stopFollowAnimation();
    return;
  }

  const elapsedMs = followFrameAt > 0 ? now - followFrameAt : 16;
  followFrameAt = now;
  const next = stepSpringScroll(followPosition, followVelocity, followTarget, elapsedMs);
  followPosition = next.position;
  followVelocity = next.velocity;
  viewport.scrollTop = followPosition;

  if (followPosition === followTarget && followVelocity === 0) {
    stopFollowAnimation();
    return;
  }
  followAnimationFrame = requestAnimationFrame(animateLyricFollow);
}

function stopFollowAnimation() {
  if (followAnimationFrame && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(followAnimationFrame);
  }
  followAnimationFrame = 0;
  followFrameAt = 0;
  viewport?.classList.remove('is-following');
}

function pauseAutomaticFollow() {
  if (!latestTimeline.lines.length) return;
  lineTransition?.clear();
  manualFollowUntil = Date.now() + MANUAL_FOLLOW_PAUSE_MS;
  viewport?.classList.add('is-manual-browsing');
  stopFollowAnimation();
  followPosition = viewport?.scrollTop || 0;
  followVelocity = 0;
  clearTimeout(followResumeTimer);
  followResumeTimer = setTimeout(() => {
    manualFollowUntil = 0;
    viewport?.classList.remove('is-manual-browsing');
    followPosition = viewport?.scrollTop || 0;
    followVelocity = 0;
    followActiveLyric();
  }, MANUAL_FOLLOW_PAUSE_MS);
}

function updatePreviewStatus() {
  const status = document.getElementById('desktopLyricPreviewStatus');
  if (!status) return;
  const lineCount = latestTimeline.lines.length;
  const hasLyric = lineCount > 0 || Boolean(latestState?.lineText || latestState?.words?.length);
  if (latestTimeline.status === 'loading' || latestState?.status === 'loading') {
    status.textContent = '正在载入歌词';
  } else if (latestTimeline.status === 'empty' || latestState?.status === 'empty') {
    status.textContent = '这首歌暂无歌词';
  } else if (hasLyric) {
    status.textContent = latestState?.playing ? `播放中 · ${lineCount} 行` : `已载入 · ${lineCount} 行`;
  } else {
    status.textContent = '等待播放';
  }
  status.className = `pill ${hasLyric ? 'good' : 'warn'}`;
}

function applySettings(settings = {}) {
  const card = document.getElementById('desktopLyricLivePreview') || document.getElementById('desktopLyricSurface');
  if (!card) return;
  const values = resolveDesktopLyricSettings(settings);
  const signature = JSON.stringify(values);
  if (signature === settingsSignature) return;
  settingsSignature = signature;
  lineTransition?.clear();
  const previousSettings = currentDisplaySettings;
  currentDisplaySettings = values;
  applyDesktopLyricStyles(card, values);
  applyPlaybackVisibility();
  if (
    previousSettings.karaokeEnabled !== values.karaokeEnabled ||
    previousSettings.karaokeMode !== values.karaokeMode
  ) {
    resetActiveWords();
    renderActiveWords();
  }
  if (!latestTimeline.lines.length) renderTimeline();
  else {
    applyVisibleLineWindow();
    renderTimelineFrame(currentPreviewPosition());
  }
  followActiveLyric();
}
function previewFallback(state) {
  if (state.status === 'loading') return '正在载入歌词';
  if (state.status === 'empty') return resolveNoLyricText(latestTimeline, currentDisplaySettings);
  if (state.status === 'ready') return '前奏中';
  return '等待播放';
}

function timelineFallback(timeline, settings) {
  if (timeline.status === 'loading') return '正在载入整首歌词…';
  if (timeline.status === 'empty') return resolveNoLyricText(timeline, settings);
  if (timeline.status === 'ready') return '歌词已就绪，正在同步完整内容…';
  return '等待播放 · 歌词将在载入后完整显示';
}

function applyPlaybackVisibility() {
  const card = document.getElementById('desktopLyricLivePreview') || document.getElementById('desktopLyricSurface');
  if (!card) return;
  const hidden = currentDisplaySettings.hideOnPause && latestState?.playing === false;
  card.classList.toggle('is-paused-hidden', hidden);
}

function currentPreviewPosition() {
  if (!renderer) return 0;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  return renderer.getPosition(now).currentMs;
}
export const desktopLyricRenderer = Object.freeze({
  init,
  applySettings,
  updateLyricState,
  updateLyricTimeline,
});
