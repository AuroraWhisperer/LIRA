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
import { createAdvancedLyricRenderer } from './advanced-lyric-renderer.js';

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
let advancedRenderer = null;
let advancedStage = null;
let previewStage = null;
let layoutObserver = null;
let outputLayer = 'both';
let previewLayer = 'both';
let basicVisible = true;
let advancedVisible = false;
let rawSettings = {};
let fallbackLine = null;
let advancedLineCache = null;
let latestState = null;
let latestTimeline = EMPTY_TIMELINE;
let timelineSignature = '';
let settingsSignature = '';
let timelineElement = null;
let viewport = null;
let countdownElement = null;
let countdownSignature = '';
let countdownRow = null;
let rowElements = [];
let activeIndex = -1;
let visibleLineRange = null;
let activeWordIndex = -1;
let activeWordSignature = '';
let activeWordAnimator = null;
let latestWordSignature = '';
let performanceProfile = null;
let lastLyricGeneration = null;
let lastLyricSequence = 0;
let suspended = false;
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

function init({ layer = 'both' } = {}) {
  if (initialized) return true;
  const stage = document.getElementById('desktopLyricPreviewStage');
  const playback = document.getElementById('desktopLyricPreviewPlayback');
  timelineElement = document.getElementById('desktopLyricPreviewTimeline');
  viewport = document.getElementById('desktopLyricPreviewViewport');
  if (!stage || !playback || !timelineElement || !viewport) return false;
  initialized = true;
  previewStage = stage;
  outputLayer = normalizeLayer(layer);
  advancedStage = document.getElementById('advancedLyricPreviewStage');
  if (advancedStage) advancedRenderer = createAdvancedLyricRenderer(advancedStage);
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
      advancedRenderer?.setVisible(visible && advancedVisible);
      performanceProfile?.setVisible(visible);
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
  viewport.addEventListener('keydown', onViewportKeydown);
  window.addEventListener('resize', followActiveLyric);
  document.fonts?.addEventListener?.('loadingdone', followActiveLyric);
  if (typeof ResizeObserver === 'function') {
    // Auto-sized rows and the desktop preview can settle after the first layout pass.
    layoutObserver = new ResizeObserver(followActiveLyric);
    layoutObserver.observe(viewport);
    layoutObserver.observe(timelineElement);
  }
  syncLayerVisibility();
  return true;
}

function onViewportKeydown(event) {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) pauseAutomaticFollow();
}

function normalizeLayer(value) {
  return value === 'basic' || value === 'advanced' ? value : 'both';
}

function setPreviewLayer(layer) {
  const next = normalizeLayer(layer);
  if (previewLayer === next) return;
  previewLayer = next;
  applyPlaybackVisibility();
  renderTimelineFrame(currentPreviewPosition());
}

function syncLayerVisibility() {
  const previousBasic = basicVisible;
  const previousAdvanced = advancedVisible;
  const paused = latestState?.playing === false;
  basicVisible = outputLayer !== 'advanced' && (previewLayer === 'basic'
    || previewLayer === 'both' && (outputLayer === 'basic' || rawSettings.desktopLyricEnabled !== 'false' && rawSettings.desktopLyricEnabled !== false)
      && !(paused && currentDisplaySettings.hideOnPause));
  advancedVisible = Boolean(advancedRenderer) && outputLayer !== 'basic' && (previewLayer === 'advanced'
    || previewLayer === 'both' && (outputLayer === 'advanced' || rawSettings.advancedLyricEnabled === 'true' || rawSettings.advancedLyricEnabled === true)
      && !(paused && (rawSettings.advancedLyricHideOnPause === 'true' || rawSettings.advancedLyricHideOnPause === true)));
  if (viewport) viewport.hidden = !basicVisible;
  if (previewStage) previewStage.dataset.lyricLayers = basicVisible ? advancedVisible ? 'both' : 'basic' : advancedVisible ? 'advanced' : 'none';
  if (previousBasic !== basicVisible) renderTimeline();
  else if (advancedVisible && !previousAdvanced) renderAdvancedFrame(resolveLyricTime(currentPreviewPosition(), currentDisplaySettings));
  const hasContent = (latestTimeline.lines.length > 0 || Boolean(fallbackLine))
    && !['loading', 'empty'].includes(latestTimeline.status)
    && !['idle', 'loading', 'empty'].includes(latestState?.status);
  renderer?.setEnabled((basicVisible || advancedVisible) && hasContent);
  advancedRenderer?.setVisible(advancedVisible && renderer?.isVisible() !== false);
}

function updateLyricState(state) {
  if (!state || typeof state !== 'object' || !acceptLyricVersion(state)) return false;
  suspended = false;
  applyLyricState(state);
  return true;
}

function suspend() {
  suspended = true;
  applyLyricState({ playing: false, lineText: '', words: [], currentMs: 0, status: 'idle' });
}

function applyLyricState(state) {
  const previousState = latestState;
  const previousWords = latestWordSignature;
  latestState = { ...(latestState || {}), ...state };
  latestWordSignature = JSON.stringify([latestState.lineText || '', latestState.words || []]);
  immediateLineChange = state.discontinuity === true || latestState.generation !== previousState?.generation
    || latestState.trackTitle !== previousState?.trackTitle;
  if (latestWordSignature !== previousWords || immediateLineChange) {
    const words = Array.isArray(latestState.words) ? latestState.words : [];
    fallbackLine = latestState.lineText ? {
      text: latestState.lineText, translation: latestState.translation || '', words,
      startMs: words[0]?.startMs ?? (fallbackLine?.text === latestState.lineText ? fallbackLine.startMs : latestState.currentMs),
      endMs: words.at(-1)?.endMs,
    } : null;
  }
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
  syncLayerVisibility();
  updatePreviewStatus();
}

function renderTimeline() {
  if (!timelineElement) return;
  lineTransition?.clear();
  const fragment = document.createDocumentFragment();
  rowElements = [];
  countdownElement = null;
  countdownSignature = '';
  countdownRow = null;
  activeIndex = -1;
  visibleLineRange = null;
  stopFollowAnimation();
  followPosition = viewport?.scrollTop || 0;
  followVelocity = 0;
  resetActiveWords();

  if (!basicVisible) {
    timelineElement.replaceChildren();
    renderTimelineFrame(currentPreviewPosition());
    return;
  }

  if (!latestTimeline.lines.length) {
    timelineElement.style.paddingBlockStart = '';
    timelineElement.style.paddingBlockEnd = '';
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
  applyVisibleLineWindow();
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
  if (!basicVisible && !advancedVisible) return;
  const lines = latestTimeline.lines;
  const lyricTime = resolveLyricTime(currentMs, currentDisplaySettings);
  const nextActiveIndex = findActiveLyricIndex(lines, lyricTime);

  if (!basicVisible || !lines.length) {
    activeIndex = nextActiveIndex;
    renderAdvancedFrame(lyricTime);
    return;
  }

  if (nextActiveIndex !== activeIndex) {
    const canTransition = activeIndex >= 0 && nextActiveIndex === activeIndex + 1
      && !immediateLineChange && latestState?.playing === true && Date.now() >= manualFollowUntil;
    const positions = canTransition ? lineTransition?.capture(rowElements,
      getVisibleLyricRange(nextActiveIndex, currentDisplaySettings.visibleLines, rowElements.length)) : null;
    if (!positions) lineTransition?.clear();
    const previousIndex = activeIndex;
    activeIndex = nextActiveIndex;
    const first = Math.max(0, Math.min(previousIndex, activeIndex) - 1);
    const last = Math.min(rowElements.length - 1, Math.max(previousIndex, activeIndex) + 1);
    for (let index = first; index <= last; index += 1) {
      const row = rowElements[index];
      if ((index < previousIndex) !== (index < activeIndex)) {
        row.classList.toggle('is-past', index < activeIndex);
      }
      const wasNear = previousIndex >= 0 && Math.abs(index - previousIndex) <= 1;
      const isNear = activeIndex >= 0 && Math.abs(index - activeIndex) <= 1;
      if (wasNear !== isNear) row.classList.toggle('is-near', isNear);
      if (index === previousIndex || index === activeIndex) {
        row.classList.toggle('is-active', index === activeIndex);
      }
    }
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
  renderAdvancedFrame(lyricTime);
}

function renderAdvancedFrame(currentMs) {
  if (!advancedVisible || renderer?.isVisible() === false) return;
  const matchesTrack = !latestTimeline.trackTitle || !latestState?.trackTitle
    || latestTimeline.trackTitle === latestState.trackTitle;
  const available = matchesTrack && !['idle', 'loading', 'empty'].includes(latestState?.status)
    && !['loading', 'empty'].includes(latestTimeline.status);
  let line = available ? latestTimeline.lines[activeIndex]
    || (!latestTimeline.lines.length ? fallbackLine : null) : null;
  if (line && !line.words?.length && latestState?.lineText === line.text && latestState.words?.length) {
    if (advancedLineCache?.source !== line || advancedLineCache.words !== latestWordSignature) {
      advancedLineCache = { source: line, words: latestWordSignature, line: { ...line, words: latestState.words } };
    }
    line = advancedLineCache.line;
  }
  advancedRenderer?.renderFrame({
    currentMs, line, index: activeIndex,
    nextLine: available ? latestTimeline.lines[activeIndex + 1] : null,
    playing: latestState?.playing === true, playbackRate: latestState?.playbackRate,
    discontinuity: immediateLineChange,
    trackTitle: latestState?.trackTitle || latestTimeline.trackTitle,
  });
}

function renderActiveWords() {
  if (!basicVisible || activeIndex < 0 || !rowElements[activeIndex]) return;
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
  if (!basicVisible) return;
  activeWordAnimator?.sync({ currentMs }, {
    playing: latestState?.playing === true && renderer?.isVisible() !== false, playbackRate: latestState?.playbackRate, force,
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
  if (generation < lastLyricGeneration || sequence < lastLyricSequence) return false;
  if (sequence === lastLyricSequence) return suspended;
  lastLyricSequence = sequence;
  return true;
}

function applyVisibleLineWindow() {
  const range = getVisibleLyricRange(activeIndex, currentDisplaySettings.visibleLines, rowElements.length);
  if (!visibleLineRange) {
    rowElements.forEach((row, index) => {
      row.classList.toggle('is-line-hidden', index < range.first || index > range.last);
    });
  } else {
    setLinesHidden(visibleLineRange.first, Math.min(visibleLineRange.last, range.first - 1), true);
    setLinesHidden(Math.max(visibleLineRange.first, range.last + 1), visibleLineRange.last, true);
    setLinesHidden(range.first, Math.min(range.last, visibleLineRange.first - 1), false);
    setLinesHidden(Math.max(range.first, visibleLineRange.last + 1), range.last, false);
  }
  visibleLineRange = range;
}

function setLinesHidden(first, last, hidden) {
  for (let index = first; index <= last; index += 1) {
    rowElements[index].classList.toggle('is-line-hidden', hidden);
  }
}

function updateCountdown(currentMs) {
  if (!countdownElement || !timelineElement) return;
  const countdown = getLyricCountdown(latestTimeline.lines, activeIndex, currentMs);
  const signature = countdown ? `${countdown.nextIndex}:${countdown.seconds}:${currentDisplaySettings.visibleLines}` : '';
  if (signature === countdownSignature) return;
  countdownSignature = signature;
  const targetRow = countdown && currentDisplaySettings.visibleLines > 0 ? rowElements[activeIndex] : null;
  if (countdownRow !== targetRow) {
    countdownRow?.classList.remove('is-interlude');
    countdownRow = targetRow;
    if (countdownRow) {
      countdownRow.appendChild(countdownElement);
      countdownRow.classList.add('is-interlude');
    }
  }
  if (!countdown) {
    countdownElement.hidden = true;
    return;
  }

  const nextRow = rowElements[countdown.nextIndex];
  if (!countdownRow && nextRow && countdownElement.nextElementSibling !== nextRow) {
    timelineElement.insertBefore(countdownElement, nextRow);
  }
  countdownElement.hidden = false;
  countdownElement.setAttribute('aria-label', `距离下一句 ${countdown.seconds} 秒`);
  const activeDot = 3 - countdown.seconds;
  Array.from(countdownElement.children).forEach((dot, index) => {
    dot.classList.toggle('is-active', index === activeDot);
    dot.classList.toggle('is-elapsed', index < activeDot);
  });
  if (activeIndex < 0) followActiveLyric();
}

function followActiveLyric() {
  if (!basicVisible || renderer?.isVisible() === false || Date.now() < manualFollowUntil) return;
  const activeRow = rowElements[activeIndex] || (countdownElement?.hidden === false ? countdownElement : null);
  if (!activeRow || !viewport || viewport.clientHeight <= 0) return;
  timelineElement.style.paddingBlockStart = `${viewport.clientHeight * currentDisplaySettings.alignPosition}px`;
  timelineElement.style.paddingBlockEnd = `${viewport.clientHeight * (1 - currentDisplaySettings.alignPosition)}px`;
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
  if (!basicVisible || !latestTimeline.lines.length) return;
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
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('desktopLyric') || key.startsWith('advancedLyric') && key !== 'advancedLyricSavedPresets'
      || key === 'lyricLayer') rawSettings[key] = value;
  }
  const values = resolveDesktopLyricSettings(rawSettings);
  const signature = JSON.stringify([values, rawSettings]);
  if (signature === settingsSignature) return;
  settingsSignature = signature;
  lineTransition?.clear();
  const previousSettings = currentDisplaySettings;
  currentDisplaySettings = values;
  if (Object.hasOwn(settings, 'lyricLayer')) outputLayer = normalizeLayer(settings.lyricLayer);
  advancedRenderer?.applySettings(rawSettings);
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
  const hidden = previewLayer !== 'basic' && currentDisplaySettings.hideOnPause && latestState?.playing === false;
  card.classList.toggle('is-paused-hidden', hidden);
  syncLayerVisibility();
}

function currentPreviewPosition() {
  if (!renderer) return 0;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  return renderer.getPosition(now).currentMs;
}

function dispose() {
  if (!initialized) return;
  initialized = false;
  stopFollowAnimation();
  clearTimeout(followResumeTimer);
  lineTransition?.clear();
  layoutObserver?.disconnect();
  viewport?.removeEventListener?.('wheel', pauseAutomaticFollow);
  viewport?.removeEventListener?.('touchstart', pauseAutomaticFollow);
  viewport?.removeEventListener?.('pointerdown', pauseAutomaticFollow);
  viewport?.removeEventListener?.('keydown', onViewportKeydown);
  window.removeEventListener?.('resize', followActiveLyric);
  document.fonts?.removeEventListener?.('loadingdone', followActiveLyric);
  advancedRenderer?.dispose();
  activeWordAnimator?.dispose();
  performanceProfile?.dispose();
  renderer?.dispose();
  renderer = advancedRenderer = advancedStage = previewStage = layoutObserver = null;
  timelineElement = viewport = lineTransition = activeWordAnimator = performanceProfile = null;
  latestState = fallbackLine = advancedLineCache = null;
  latestTimeline = EMPTY_TIMELINE;
  rowElements = [];
  countdownElement = countdownRow = null;
  activeIndex = activeWordIndex = -1;
  visibleLineRange = null;
  countdownSignature = timelineSignature = settingsSignature = activeWordSignature = latestWordSignature = '';
  lastLyricGeneration = null;
  suspended = false;
  lastLyricSequence = manualFollowUntil = followResumeTimer = 0;
  outputLayer = previewLayer = 'both';
  basicVisible = true;
  advancedVisible = false;
  rawSettings = {};
  currentDisplaySettings = resolveDesktopLyricSettings();
}

export const desktopLyricRenderer = Object.freeze({
  init,
  applySettings,
  updateLyricState,
  suspend,
  updateLyricTimeline,
  setPreviewLayer,
  dispose,
});
