// 桌面歌词设置实时预览：完整歌词时间轴 + 当前行逐字进度。
'use strict';

import { LyricWordRenderer } from '../shared/lyric-word-renderer.js';
import { localOverlayOrigin } from '../shared/utils.js';

const DEFAULTS = {
  desktopLyricFontFamily: 'Microsoft YaHei',
  desktopLyricFontWeight: '800',
  desktopLyricTextColor: '#000000',
  desktopLyricStrokeColor: '#ffffff',
  desktopLyricFontSize: '56',
  desktopLyricStrokeWidth: '3',
  desktopLyricOpacity: '0.95',
  desktopLyricBgOpacity: '0.15',
  desktopLyricScale: '1',
  desktopLyricLineHeight: '1.4',
  desktopLyricShadowIntensity: '0.35',
  desktopLyricTranslationScale: '0.65'
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
let activeWordElements = [];
let manualFollowUntil = 0;
let followResumeTimer = 0;
let followAnimationFrame = 0;
let followPosition = 0;
let followVelocity = 0;
let followTarget = 0;
let followFrameAt = 0;

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
    wordClass: 'desktop-lyric-preview-live-word',
    progressProperty: '--preview-word-progress',
    fallbackText: previewFallback,
    onFrame: (position) => renderTimelineFrame(position.currentMs)
  });

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

  const appState = window.AdminApp.state?.getAppState?.();
  if (appState?.lyricTimeline) updateLyricTimeline(appState.lyricTimeline);
  if (appState?.lyricState) updateLyricState(appState.lyricState);
  applyStylesFromForm();
}

function updateLyricState(state) {
  if (!state || typeof state !== 'object') return;
  latestState = { ...(latestState || {}), ...state };
  renderer?.setState(latestState);
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
    empty.textContent = timelineFallback(latestTimeline);
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
  const nextActiveIndex = findActiveLyricIndex(lines, currentMs);

  if (nextActiveIndex !== activeIndex) {
    const previousIndex = activeIndex;
    activeIndex = nextActiveIndex;
    rowElements.forEach((row, index) => {
      row.classList.toggle('is-past', index < activeIndex);
      row.classList.toggle('is-near', activeIndex >= 0 && Math.abs(index - activeIndex) <= 1);
      row.classList.toggle('is-active', index === activeIndex);
    });
    if (previousIndex !== activeIndex) resetActiveWords();
    renderActiveWords();
    followActiveLyric();
  } else {
    renderActiveWords();
  }

  updateActiveWordProgress(currentMs);
  updateCountdown(currentMs);
}

function renderActiveWords() {
  if (activeIndex < 0 || !rowElements[activeIndex]) return;
  const line = latestTimeline.lines[activeIndex] || {};
  const words = Array.isArray(latestState?.words) ? latestState.words : [];
  const matchesCurrentLine = latestState?.lineText === line.text;
  const signature = JSON.stringify([activeIndex, matchesCurrentLine ? words : []]);
  if (signature === activeWordSignature) return;

  resetActiveWords();
  const textElement = rowElements[activeIndex].querySelector('.desktop-lyric-preview-row-text');
  if (!textElement || !matchesCurrentLine || !words.length) {
    activeWordSignature = signature;
    return;
  }

  textElement.replaceChildren();
  activeWordElements = words.map((word) => {
    const element = document.createElement('span');
    element.className = 'desktop-lyric-preview-word';
    element.textContent = word.text || '';
    textElement.appendChild(element);
    return { element, word };
  });
  activeWordIndex = activeIndex;
  activeWordSignature = signature;
}

function resetActiveWords() {
  if (activeWordIndex >= 0 && rowElements[activeWordIndex]) {
    const textElement = rowElements[activeWordIndex].querySelector('.desktop-lyric-preview-row-text');
    if (textElement) textElement.textContent = latestTimeline.lines[activeWordIndex]?.text || '';
  }
  activeWordIndex = -1;
  activeWordSignature = '';
  activeWordElements = [];
}

function updateActiveWordProgress(currentMs) {
  activeWordElements.forEach(({ element, word }) => {
    const startMs = finiteNumber(word.startMs, 0);
    const endMs = Math.max(startMs, finiteNumber(word.endMs, startMs));
    const progress = endMs > startMs
      ? clamp((currentMs - startMs) / (endMs - startMs), 0, 1)
      : currentMs >= endMs ? 1 : 0;
    element.style.setProperty('--preview-word-progress', `${progress * 100}%`);
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
  const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  followTarget = clamp(
    activeRow.offsetTop - viewport.clientHeight / 2 + activeRow.offsetHeight / 2,
    0,
    maximum
  );
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || typeof requestAnimationFrame !== 'function') {
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
  const values = { ...DEFAULTS, ...settings };
  const fontSize = numberSetting(values.desktopLyricFontSize, 56);
  const translationScale = numberSetting(values.desktopLyricTranslationScale, 0.65);
  card.style.setProperty('--preview-font', `${values.desktopLyricFontFamily}, "Microsoft YaHei", sans-serif`);
  card.style.setProperty('--preview-weight', values.desktopLyricFontWeight);
  card.style.setProperty('--preview-color', values.desktopLyricTextColor);
  card.style.setProperty('--preview-stroke', values.desktopLyricStrokeColor);
  card.style.setProperty('--preview-size', `${fontSize}px`);
  card.style.setProperty('--preview-translation-size', `${fontSize * translationScale}px`);
  card.style.setProperty('--preview-stroke-width', `${numberSetting(values.desktopLyricStrokeWidth, 3)}px`);
  card.style.setProperty('--preview-opacity', String(numberSetting(values.desktopLyricOpacity, 0.95)));
  card.style.setProperty('--preview-bg-opacity', String(numberSetting(values.desktopLyricBgOpacity, 0.15)));
  card.style.setProperty('--preview-scale', String(numberSetting(values.desktopLyricScale, 1)));
  card.style.setProperty('--preview-line-height', String(numberSetting(values.desktopLyricLineHeight, 1.4)));
  card.style.setProperty('--preview-shadow-opacity', String(numberSetting(values.desktopLyricShadowIntensity, 0.35)));
  followActiveLyric();
}

function readFormSettings() {
  const values = {};
  for (const key of Object.keys(DEFAULTS)) {
    const input = document.getElementById(key);
    if (input) values[key] = input.value;
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
    await navigator.clipboard.writeText(desktopLyricUrl);
    window.AdminApp.utils?.toast?.('桌面歌词地址已复制');
  } catch (error) {
    prompt('复制以下桌面歌词地址：', desktopLyricUrl);
  }
}

function previewFallback(state) {
  if (state.status === 'loading') return '正在载入歌词';
  if (state.status === 'empty') return '这首歌暂无歌词';
  if (state.status === 'ready') return '前奏中';
  return '等待播放';
}

function timelineFallback(timeline) {
  if (timeline.status === 'loading') return '正在载入整首歌词…';
  if (timeline.status === 'empty') return '这首歌暂无歌词';
  if (timeline.status === 'ready') return '歌词已就绪，正在同步完整内容…';
  return '等待播放 · 歌词将在载入后完整显示';
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

window.AdminApp = window.AdminApp || {};
window.AdminApp.desktopLyricPreview = { init, applySettings, updateLyricState, updateLyricTimeline };
