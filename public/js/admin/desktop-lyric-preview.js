// 桌面歌词设置实时预览：完整歌词时间轴 + 当前行逐字进度。
'use strict';

import { LyricWordRenderer } from '../shared/lyric-word-renderer.js';
import { LyricWordAnimator } from '../shared/lyric-word-animator.js';
import { createLyricPerformanceProfile } from '../shared/lyric-performance.js';
import { copyText, localOverlayOrigin } from '../shared/utils.js';

const DEFAULTS = {
  desktopLyricFontFamily: 'Microsoft YaHei',
  desktopLyricFallbackFontFamily: 'Microsoft JhengHei',
  desktopLyricFontWeight: '800',
  desktopLyricTextColor: '#000000',
  desktopLyricTextAlign: 'left',
  desktopLyricLetterSpacing: '0',
  desktopLyricStrokeEnabled: 'true',
  desktopLyricStrokeColor: '#ffffff',
  desktopLyricFontSize: '56',
  desktopLyricStrokeWidth: '3',
  desktopLyricShadowEnabled: 'true',
  desktopLyricShadowColor: '#000000',
  desktopLyricShadowBlur: '8',
  desktopLyricShadowOffsetX: '0',
  desktopLyricShadowOffsetY: '3',
  desktopLyricOpacity: '0.95',
  desktopLyricBaseOpacity: '0.38',
  desktopLyricTranslationOpacity: '0.72',
  desktopLyricBgOpacity: '0.15',
  desktopLyricScale: '1',
  desktopLyricLineHeight: '1.4',
  desktopLyricShadowIntensity: '0.35',
  desktopLyricTranslationScale: '0.65',
  desktopLyricShowTranslation: 'true',
  desktopLyricKaraokeEnabled: 'true',
  desktopLyricHidePassedLines: 'false',
  desktopLyricTraditionalMode: 'false',
  desktopLyricInterludeOffsetEm: '0',
  desktopLyricHideOnPause: 'false',
  desktopLyricCurrentLineEnhanced: 'true',
  desktopLyricTimeOffsetMs: '0',
  desktopLyricShowTitleWhenNoLyric: 'false',
  desktopLyricNoLyricText: '纯音乐，请欣赏',
  desktopLyricSpringAnimation: 'false',
  desktopLyricBlurEffect: 'false',
  desktopLyricScaleEffect: 'false',
  desktopLyricAlignPosition: '0.5',
  desktopLyricAlignAnchor: 'center',
  desktopLyricTranslateX: '0',
  desktopLyricTranslateY: '0',
  desktopLyricPerspective: '800',
  desktopLyricRotateX: '0',
  desktopLyricRotateY: '0',
  desktopLyricBackgroundEnabled: 'false',
  desktopLyricBackgroundRenderer: 'mesh',
  desktopLyricGlobalOpacity: '1',
  desktopLyricBrightness: '1',
  desktopLyricContrast: '1',
  desktopLyricSaturation: '1',
  desktopLyricVisibleLines: '0'
};
const EMPTY_TIMELINE = {
  trackTitle: '', artists: [], status: 'idle', lines: []
};
const COUNTDOWN_WINDOW_MS = 3000;
const COUNTDOWN_MIN_GAP_MS = 6000;
const MANUAL_FOLLOW_PAUSE_MS = 6000;
const SPRING_STIFFNESS = 170;
const SPRING_DAMPING = 26;
const SPRING_SETTLE_DISTANCE = 0.5;
const SPRING_SETTLE_SPEED = 2;

let initialized = false;
let renderer = null;
let latestState = null;
let latestTimeline = EMPTY_TIMELINE;
let timelineElement = null;
let viewport = null;
let countdownElement = null;
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
let currentDisplaySettings = resolveDesktopLyricSettings(DEFAULTS);

function init(form) {
  if (initialized) return;
  const stage = document.getElementById('desktopLyricPreviewStage');
  const playback = document.getElementById('desktopLyricPreviewPlayback');
  timelineElement = document.getElementById('desktopLyricPreviewTimeline');
  viewport = document.getElementById('desktopLyricPreviewViewport');
  if (!stage || !playback || !timelineElement || !viewport) return;
  initialized = true;

  renderer = new LyricWordRenderer({
    lineElement: playback,
    progressElement: document.getElementById('desktopLyricPreviewProgress'),
    renderWords: false,
    wordClass: 'desktop-lyric-preview-live-word',
    progressProperty: '--preview-word-progress',
    fallbackText: previewFallback,
    onFrameBudget: (duration) => performanceProfile?.recordFrame(duration),
    onFrame: (position) => renderTimelineFrame(position.currentMs)
  });
  performanceProfile = createLyricPerformanceProfile({
    onChange: (profile) => {
      activeWordAnimator?.setMode(profile.wordAnimation);
      stage.classList.toggle('is-low-power', profile.effects === 'low');
    }
  });
  activeWordAnimator = new LyricWordAnimator({
    mode: performanceProfile.profile.wordAnimation,
    wordClass: 'desktop-lyric-preview-word',
    highlightClass: 'desktop-lyric-preview-word-highlight'
  });
  stage.classList.toggle('is-low-power', performanceProfile.profile.effects === 'low');

  form?.addEventListener('input', applyStylesFromForm);
  form?.addEventListener('change', applyStylesFromForm);
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    button.addEventListener('click', () => setBackground(button.dataset.lyricPreviewBackground));
  });
  document.getElementById('desktopLyricCopyUrlBtn')?.addEventListener('click', copyDesktopLyricUrl);
  window.addEventListener('app:lyric-state', (event) => updateLyricState(event.detail));
  window.addEventListener('app:lyric-timeline', (event) => updateLyricTimeline(event.detail));
  window.addEventListener('app:settings-state', (event) => applySettings(event.detail));
  viewport.addEventListener('wheel', pauseAutomaticFollow, { passive: true });
  viewport.addEventListener('touchstart', pauseAutomaticFollow, { passive: true });
  viewport.addEventListener('pointerdown', pauseAutomaticFollow, { passive: true });
  viewport.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
      pauseAutomaticFollow();
    }
  });
  window.addEventListener('resize', followActiveLyric);
  document.fonts?.addEventListener?.('loadingdone', followActiveLyric);

  const appState = window.AdminApp.state?.getAppState?.();
  if (appState?.lyricTimeline) updateLyricTimeline(appState.lyricTimeline);
  if (appState?.lyricState) updateLyricState(appState.lyricState);
  applyStylesFromForm();
}

function updateLyricState(state) {
  if (!state || typeof state !== 'object') return;
  if (!acceptLyricVersion(state)) return;
  latestState = { ...(latestState || {}), ...state };
  latestWordSignature = JSON.stringify([latestState.lineText || '', latestState.words || []]);
  renderer?.setState(latestState);
  renderActiveWords();
  applyPlaybackVisibility();
  updatePreviewStatus();
}

function updateLyricTimeline(timeline) {
  if (!timeline || typeof timeline !== 'object') return;
  latestTimeline = {
    ...EMPTY_TIMELINE,
    ...timeline,
    lines: Array.isArray(timeline.lines) ? timeline.lines : []
  };
  renderTimeline();
  updatePreviewStatus();
}

function renderTimeline() {
  if (!timelineElement) return;
  const fragment = document.createDocumentFragment();
  rowElements = [];
  countdownElement = null;
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
      text.textContent = line.text || '';
      row.appendChild(text);

      if (line.translation) {
        const translation = document.createElement('div');
        translation.className = 'desktop-lyric-preview-row-translation';
        translation.textContent = line.translation;
        row.appendChild(translation);
      }
      if (line.roma) {
        const roma = document.createElement('div');
        roma.className = 'desktop-lyric-preview-row-roma';
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
    const previousIndex = activeIndex;
    activeIndex = nextActiveIndex;
    rowElements.forEach((row, index) => {
      row.classList.toggle('is-past', index < activeIndex);
      row.classList.toggle('is-near', activeIndex >= 0 && Math.abs(index - activeIndex) <= 1);
      row.classList.toggle('is-active', index === activeIndex);
    });
    applyVisibleLineWindow();
    if (previousIndex !== activeIndex) resetActiveWords();
    renderActiveWords();
    followActiveLyric();
  }

  updateActiveWordProgress(lyricTime);
  updateCountdown(lyricTime);
}

function renderActiveWords() {
  if (activeIndex < 0 || !rowElements[activeIndex]) return;
  if (!currentDisplaySettings.karaokeEnabled) {
    resetActiveWords();
    return;
  }
  const line = latestTimeline.lines[activeIndex] || {};
  const words = Array.isArray(latestState?.words) ? latestState.words : [];
  const matchesCurrentLine = latestState?.lineText === line.text;
  const signature = `${activeIndex}:${matchesCurrentLine ? latestWordSignature : ''}`;
  if (signature === activeWordSignature) return;

  resetActiveWords();
  const textElement = rowElements[activeIndex].querySelector('.desktop-lyric-preview-row-text');
  if (!textElement || !matchesCurrentLine || !words.length) {
    activeWordSignature = signature;
    return;
  }

  activeWordAnimator?.mount(textElement, words, {
    mode: performanceProfile?.profile.wordAnimation || 'waapi'
  });
  activeWordIndex = activeIndex;
  activeWordSignature = signature;
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

function updateActiveWordProgress(currentMs) {
  activeWordAnimator?.sync({ currentMs }, { playing: latestState?.playing === true });
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
  if (activeIndex < 0 || Date.now() < manualFollowUntil) return;
  const activeRow = rowElements[activeIndex];
  if (!activeRow || !viewport || viewport.clientHeight <= 0) return;
  followTarget = calculateFollowTarget(
    activeRow.offsetTop,
    activeRow.offsetHeight,
    viewport.clientHeight,
    viewport.scrollHeight,
    currentDisplaySettings.alignPosition,
    currentDisplaySettings.alignAnchor
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
  manualFollowUntil = Date.now() + MANUAL_FOLLOW_PAUSE_MS;
  stopFollowAnimation();
  followPosition = viewport?.scrollTop || 0;
  followVelocity = 0;
  clearTimeout(followResumeTimer);
  followResumeTimer = setTimeout(() => {
    manualFollowUntil = 0;
    followPosition = viewport?.scrollTop || 0;
    followVelocity = 0;
    followActiveLyric();
  }, MANUAL_FOLLOW_PAUSE_MS);
}

export function stepSpringScroll(position, velocity, target, elapsedMs) {
  const currentPosition = finiteNumber(position, 0);
  const currentVelocity = finiteNumber(velocity, 0);
  const destination = finiteNumber(target, currentPosition);
  const deltaSeconds = clamp(finiteNumber(elapsedMs, 0) / 1000, 0, 0.05);
  const acceleration = (destination - currentPosition) * SPRING_STIFFNESS
    - currentVelocity * SPRING_DAMPING;
  const nextVelocity = currentVelocity + acceleration * deltaSeconds;
  const nextPosition = currentPosition + nextVelocity * deltaSeconds;

  if (Math.abs(destination - nextPosition) <= SPRING_SETTLE_DISTANCE
      && Math.abs(nextVelocity) <= SPRING_SETTLE_SPEED) {
    return { position: destination, velocity: 0 };
  }
  return { position: nextPosition, velocity: nextVelocity };
}

export function findActiveLyricIndex(lines, currentMs) {
  if (!Array.isArray(lines) || !lines.length) return -1;
  const target = Math.max(0, finiteNumber(currentMs, 0));
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (finiteNumber(lines[middle]?.startMs, 0) <= target) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function getLyricCountdown(lines, currentIndex, currentMs) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const nextIndex = currentIndex + 1;
  const nextLine = lines[nextIndex];
  if (!nextLine) return null;
  const nextStartMs = finiteNumber(nextLine.startMs, 0);
  const previousStartMs = currentIndex >= 0
    ? finiteNumber(lines[currentIndex]?.startMs, 0)
    : 0;
  const gapMs = nextStartMs - previousStartMs;
  const remainingMs = nextStartMs - Math.max(0, finiteNumber(currentMs, 0));
  if (gapMs < COUNTDOWN_MIN_GAP_MS || remainingMs <= 0 || remainingMs > COUNTDOWN_WINDOW_MS) {
    return null;
  }
  return { nextIndex, seconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
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
    status.textContent = latestState?.playing ? `实时播放中 · ${lineCount} 行` : `歌词已载入 · ${lineCount} 行`;
  } else {
    status.textContent = '等待播放';
  }
  status.className = `pill ${hasLyric ? 'good' : 'warn'}`;
}

function applyStylesFromForm() {
  applySettings(readFormSettings());
}

function applySettings(settings = {}) {
  const card = document.getElementById('desktopLyricLivePreview')
    || document.getElementById('desktopLyricSurface');
  if (!card) return;
  const previousSettings = currentDisplaySettings;
  currentDisplaySettings = resolveDesktopLyricSettings(settings);
  const values = currentDisplaySettings;
  card.style.setProperty('--preview-font', `${values.fontFamily}, ${values.fallbackFontFamily}, "Microsoft YaHei", sans-serif`);
  card.style.setProperty('--preview-weight', values.fontWeight);
  card.style.setProperty('--preview-color', values.textColor);
  card.style.setProperty('--preview-text-align', values.textAlign);
  card.style.setProperty('--preview-row-align', textAlignToFlex(values.textAlign));
  card.style.setProperty('--preview-letter-spacing', `${values.letterSpacing}em`);
  card.style.setProperty('--preview-stroke', values.strokeColor);
  card.style.setProperty('--preview-size', `${values.fontSize}px`);
  card.style.setProperty('--preview-translation-size', `${values.fontSize * values.translationScale}px`);
  card.style.setProperty('--preview-stroke-width', `${values.strokeEnabled ? values.strokeWidth : 0}px`);
  card.style.setProperty('--preview-opacity', String(values.opacity));
  card.style.setProperty('--preview-base-opacity', String(values.baseOpacity));
  card.style.setProperty('--preview-translation-opacity', String(values.translationOpacity));
  card.style.setProperty('--preview-bg-opacity', String(values.backgroundOpacity));
  card.style.setProperty('--preview-scale', String(values.scale));
  card.style.setProperty('--preview-line-height', String(values.lineHeight));
  card.style.setProperty('--preview-shadow-color', values.shadowEnabled
    ? hexWithAlpha(values.shadowColor, values.shadowIntensity)
    : 'transparent');
  card.style.setProperty('--preview-shadow-blur', `${values.shadowBlur}px`);
  card.style.setProperty('--preview-shadow-x', `${values.shadowOffsetX}px`);
  card.style.setProperty('--preview-shadow-y', `${values.shadowOffsetY}px`);
  card.style.setProperty('--preview-interlude-offset', `${values.interludeOffsetEm}em`);
  card.style.setProperty('--preview-translate-x', `${values.translateX}px`);
  card.style.setProperty('--preview-translate-y', `${values.translateY}px`);
  card.style.setProperty('--preview-perspective', `${values.perspective}px`);
  card.style.setProperty('--preview-rotate-x', `${values.rotateX}deg`);
  card.style.setProperty('--preview-rotate-y', `${values.rotateY}deg`);
  card.style.setProperty('--preview-global-opacity', String(values.globalOpacity));
  card.style.setProperty('--preview-brightness', String(values.brightness));
  card.style.setProperty('--preview-contrast', String(values.contrast));
  card.style.setProperty('--preview-saturation', String(values.saturation));
  card.classList.toggle('is-translation-hidden', !values.showTranslation);
  card.classList.toggle('is-text-justify', values.textAlign === 'justify');
  card.classList.toggle('is-hide-passed', values.hidePassedLines);
  card.classList.toggle('is-traditional', values.traditionalMode);
  card.classList.toggle('is-current-enhanced', values.currentLineEnhanced);
  card.classList.toggle('is-spring-enabled', values.springAnimation);
  card.classList.toggle('is-blur-enabled', values.blurEffect);
  card.classList.toggle('is-scale-enabled', values.scaleEffect);
  card.classList.toggle('is-background-enabled', values.backgroundEnabled);
  for (const rendererName of ['mesh', 'aurora', 'solid']) {
    card.classList.toggle(`is-background-${rendererName}`, values.backgroundRenderer === rendererName);
  }
  applyPlaybackVisibility();
  if (previousSettings.karaokeEnabled !== values.karaokeEnabled) {
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

function readFormSettings() {
  const values = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'desktopLyricTextAlign') {
      values[key] = document.querySelector('input[name="desktopLyricTextAlign"]:checked')?.value
        || DEFAULTS.desktopLyricTextAlign;
      continue;
    }
    const input = document.getElementById(key);
    if (input) values[key] = input.type === 'checkbox' ? String(input.checked) : input.value;
  }
  return values;
}

function setBackground(background) {
  const solid = background === 'solid';
  document.getElementById('desktopLyricPreviewStage')?.classList.toggle('is-solid', solid);
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    const active = button.dataset.lyricPreviewBackground === (solid ? 'solid' : 'grid');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function copyDesktopLyricUrl() {
  const desktopLyricUrl = `${localOverlayOrigin(location)}/lyrics`;
  try {
    await copyText(desktopLyricUrl);
    window.AdminApp.utils?.toast?.('桌面歌词地址已复制');
  } catch (error) {
    prompt('复制以下桌面歌词地址：', desktopLyricUrl);
  }
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
  const card = document.getElementById('desktopLyricLivePreview')
    || document.getElementById('desktopLyricSurface');
  if (!card) return;
  const hidden = currentDisplaySettings.hideOnPause && latestState?.playing === false;
  card.classList.toggle('is-paused-hidden', hidden);
}

function currentPreviewPosition() {
  if (!renderer) return 0;
  const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  return renderer.getPosition(now).currentMs;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function numberSetting(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function boolSetting(value, fallback) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function enumSetting(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function resolveDesktopLyricSettings(settings = {}) {
  const values = { ...DEFAULTS, ...settings };
  return {
    fontFamily: String(values.desktopLyricFontFamily || DEFAULTS.desktopLyricFontFamily),
    fallbackFontFamily: String(values.desktopLyricFallbackFontFamily || DEFAULTS.desktopLyricFallbackFontFamily),
    fontWeight: String(values.desktopLyricFontWeight || DEFAULTS.desktopLyricFontWeight),
    textColor: String(values.desktopLyricTextColor || DEFAULTS.desktopLyricTextColor),
    textAlign: enumSetting(values.desktopLyricTextAlign, ['left', 'center', 'right', 'justify'], 'left'),
    letterSpacing: clamp(numberSetting(values.desktopLyricLetterSpacing, 0), -0.1, 0.3),
    fontSize: clamp(numberSetting(values.desktopLyricFontSize, 56), 24, 72),
    lineHeight: clamp(numberSetting(values.desktopLyricLineHeight, 1.4), 1, 2),
    strokeEnabled: boolSetting(values.desktopLyricStrokeEnabled, true),
    strokeColor: String(values.desktopLyricStrokeColor || DEFAULTS.desktopLyricStrokeColor),
    strokeWidth: clamp(numberSetting(values.desktopLyricStrokeWidth, 3), 0, 6),
    shadowEnabled: boolSetting(values.desktopLyricShadowEnabled, true),
    shadowColor: String(values.desktopLyricShadowColor || DEFAULTS.desktopLyricShadowColor),
    shadowIntensity: clamp(numberSetting(values.desktopLyricShadowIntensity, 0.35), 0, 1),
    shadowBlur: clamp(numberSetting(values.desktopLyricShadowBlur, 8), 0, 30),
    shadowOffsetX: clamp(numberSetting(values.desktopLyricShadowOffsetX, 0), -20, 20),
    shadowOffsetY: clamp(numberSetting(values.desktopLyricShadowOffsetY, 3), -20, 20),
    showTranslation: boolSetting(values.desktopLyricShowTranslation, true),
    translationScale: clamp(numberSetting(values.desktopLyricTranslationScale, 0.65), 0.4, 1),
    karaokeEnabled: boolSetting(values.desktopLyricKaraokeEnabled, true),
    hidePassedLines: boolSetting(values.desktopLyricHidePassedLines, false),
    traditionalMode: boolSetting(values.desktopLyricTraditionalMode, false),
    interludeOffsetEm: clamp(numberSetting(values.desktopLyricInterludeOffsetEm, 0), -10, 10),
    hideOnPause: boolSetting(values.desktopLyricHideOnPause, false),
    currentLineEnhanced: boolSetting(values.desktopLyricCurrentLineEnhanced, true),
    opacity: clamp(numberSetting(values.desktopLyricOpacity, 0.95), 0, 1),
    baseOpacity: clamp(numberSetting(values.desktopLyricBaseOpacity, 0.38), 0, 1),
    translationOpacity: clamp(numberSetting(values.desktopLyricTranslationOpacity, 0.72), 0, 1),
    timeOffsetMs: clamp(numberSetting(values.desktopLyricTimeOffsetMs, 0), -5000, 5000),
    showTitleWhenNoLyric: boolSetting(values.desktopLyricShowTitleWhenNoLyric, false),
    noLyricText: String(values.desktopLyricNoLyricText || DEFAULTS.desktopLyricNoLyricText).slice(0, 80),
    springAnimation: boolSetting(values.desktopLyricSpringAnimation, false),
    blurEffect: boolSetting(values.desktopLyricBlurEffect, false),
    scaleEffect: boolSetting(values.desktopLyricScaleEffect, false),
    scale: clamp(numberSetting(values.desktopLyricScale, 1), 0.5, 2),
    alignPosition: clamp(numberSetting(values.desktopLyricAlignPosition, 0.5), 0, 1),
    alignAnchor: enumSetting(values.desktopLyricAlignAnchor, ['start', 'center', 'end'], 'center'),
    translateX: clamp(numberSetting(values.desktopLyricTranslateX, 0), -500, 500),
    translateY: clamp(numberSetting(values.desktopLyricTranslateY, 0), -500, 500),
    perspective: clamp(numberSetting(values.desktopLyricPerspective, 800), 200, 2000),
    rotateX: clamp(numberSetting(values.desktopLyricRotateX, 0), -45, 45),
    rotateY: clamp(numberSetting(values.desktopLyricRotateY, 0), -45, 45),
    backgroundEnabled: boolSetting(values.desktopLyricBackgroundEnabled, false),
    backgroundRenderer: enumSetting(values.desktopLyricBackgroundRenderer, ['mesh', 'aurora', 'solid'], 'mesh'),
    backgroundOpacity: clamp(numberSetting(values.desktopLyricBgOpacity, 0.15), 0, 1),
    globalOpacity: clamp(numberSetting(values.desktopLyricGlobalOpacity, 1), 0, 1),
    brightness: clamp(numberSetting(values.desktopLyricBrightness, 1), 0.2, 2),
    contrast: clamp(numberSetting(values.desktopLyricContrast, 1), 0.2, 2),
    saturation: clamp(numberSetting(values.desktopLyricSaturation, 1), 0, 2),
    visibleLines: Math.max(0, Math.min(99, Math.round(numberSetting(values.desktopLyricVisibleLines, 0))))
  };
}

export function getVisibleLyricRange(activeLine, visibleLines, lineCount) {
  const count = Math.max(0, Math.floor(finiteNumber(lineCount, 0)));
  const lines = Math.max(0, Math.min(99, Math.round(finiteNumber(visibleLines, 0))));
  if (!count) return { first: 0, last: -1 };
  if (lines === 0) return { first: 0, last: count - 1 };
  if (activeLine < 0) return { first: 0, last: -1 };
  const before = Math.floor((lines - 1) / 2);
  const after = lines - 1 - before;
  return {
    first: Math.max(0, Math.floor(activeLine) - before),
    last: Math.min(count - 1, Math.floor(activeLine) + after)
  };
}

export function resolveLyricTime(currentMs, settings) {
  return Math.max(0, finiteNumber(currentMs, 0) + finiteNumber(settings?.timeOffsetMs, 0));
}

export function resolveNoLyricText(timeline, settings) {
  const title = String(timeline?.trackTitle || '').trim();
  if (settings?.showTitleWhenNoLyric && title) return title;
  return String(settings?.noLyricText || DEFAULTS.desktopLyricNoLyricText).trim()
    || DEFAULTS.desktopLyricNoLyricText;
}

export function calculateFollowTarget(rowTop, rowHeight, viewportHeight, scrollHeight, alignPosition, alignAnchor) {
  const anchorRatio = alignAnchor === 'start' ? 0 : alignAnchor === 'end' ? 1 : 0.5;
  const maximum = Math.max(0, finiteNumber(scrollHeight, 0) - finiteNumber(viewportHeight, 0));
  const rowAnchor = finiteNumber(rowTop, 0) + finiteNumber(rowHeight, 0) * anchorRatio;
  const viewportAnchor = finiteNumber(viewportHeight, 0) * clamp(finiteNumber(alignPosition, 0.5), 0, 1);
  return clamp(rowAnchor - viewportAnchor, 0, maximum);
}

function textAlignToFlex(textAlign) {
  if (textAlign === 'center') return 'center';
  if (textAlign === 'right') return 'flex-end';
  if (textAlign === 'justify') return 'stretch';
  return 'flex-start';
}

function hexWithAlpha(color, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
  if (!match) return String(color || 'transparent');
  const value = Number.parseInt(match[1], 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${clamp(alpha, 0, 1)})`;
}

window.AdminApp = window.AdminApp || {};
window.AdminApp.desktopLyricPreview = { init, applySettings, updateLyricState, updateLyricTimeline };
