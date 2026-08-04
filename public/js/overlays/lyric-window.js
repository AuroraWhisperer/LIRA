'use strict';

const DEFAULT_STATE = {
  trackTitle: '', artists: [], lineText: '', translation: '', words: [],
  currentMs: 0, durationMs: 0, progress: 0, playing: false, locked: false, status: 'idle'
};

let lyricState = { ...DEFAULT_STATE };
let lyricSettings = {
  fontFamily: 'Microsoft YaHei', fontWeight: '800', textColor: '#000000',
  strokeColor: '#ffffff', fontSize: '56', strokeWidth: '3', opacity: '0.95',
  bgOpacity: '0.15', scale: '1', lineHeight: '1.4', shadowIntensity: '0.35',
  translationScale: '0.65'
};
let currentScale = 1;
let reconnectTimer = null;
let reconnectAttempts = 0;
let animationFrame = 0;
let renderedWords = [];
let wordElements = [];
let contentSignature = '';
let playbackAnchor = { currentMs: 0, durationMs: 0, progress: 0, updatedAt: performance.now() };

document.addEventListener('DOMContentLoaded', () => {
  renderLyricState();
  void loadSettings();
  setupWheelZoom();
  connectSocket();
  if (window.musicAPI?.onLyricState) window.musicAPI.onLyricState(updateLyricState);
});

function updateLyricState(state) {
  const now = performance.now();
  const estimated = playbackPosition(now);
  const nextPlaying = hasOwn(state, 'playing') ? state.playing === true : lyricState.playing;
  const incomingCurrentMs = hasOwn(state, 'currentMs') ? numberValue(state.currentMs, 0) : estimated.currentMs;
  lyricState = { ...lyricState, ...(state || {}) };
  playbackAnchor = {
    currentMs: smoothCurrentMs(incomingCurrentMs, estimated.currentMs, nextPlaying),
    durationMs: hasOwn(state, 'durationMs') ? numberValue(state.durationMs, 0) : playbackAnchor.durationMs,
    progress: hasOwn(state, 'progress') ? numberValue(state.progress, 0) : estimated.progress,
    updatedAt: now
  };
  renderLyricState();
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    document.body.classList.remove('is-disconnected');
  });
  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'lyric-state') updateLyricState(payload.state);
      if (payload.type === 'snapshot') {
        if (payload.state?.settings) updateSettings(payload.state.settings);
        if (payload.state?.lyricState) updateLyricState(payload.state.lyricState);
      }
    } catch (error) {
      console.warn('[lyrics] invalid WebSocket message:', error);
    }
  });
  socket.addEventListener('close', scheduleReconnect);
  socket.addEventListener('error', () => socket.close());
}

function scheduleReconnect() {
  document.body.classList.add('is-disconnected');
  reconnectAttempts += 1;
  const delay = Math.min(1000 * (2 ** Math.min(reconnectAttempts - 1, 4)), 15000);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectSocket, delay);
  renderLyricState();
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.ok && payload.data) updateSettings(payload.data);
  } catch (error) {
    console.warn('[lyrics] settings unavailable:', error);
  }
}

function updateSettings(settings) {
  const mapping = {
    desktopLyricFontFamily: 'fontFamily', desktopLyricFontWeight: 'fontWeight',
    desktopLyricTextColor: 'textColor', desktopLyricStrokeColor: 'strokeColor',
    desktopLyricFontSize: 'fontSize', desktopLyricStrokeWidth: 'strokeWidth',
    desktopLyricOpacity: 'opacity', desktopLyricBgOpacity: 'bgOpacity',
    desktopLyricScale: 'scale', desktopLyricLineHeight: 'lineHeight',
    desktopLyricShadowIntensity: 'shadowIntensity',
    desktopLyricTranslationScale: 'translationScale'
  };
  for (const [settingKey, localKey] of Object.entries(mapping)) {
    if (settings[settingKey] !== undefined && settings[settingKey] !== '') {
      lyricSettings[localKey] = settings[settingKey];
    }
  }
  currentScale = numberSetting(lyricSettings.scale, 1);
  applyStyles();
}

function applyStyles() {
  const root = document.documentElement;
  const surface = document.querySelector('.lyric-window-surface');
  if (!surface) return;
  const fontSize = numberSetting(lyricSettings.fontSize, 56);
  root.style.setProperty('--lyric-font', `${lyricSettings.fontFamily}, "Microsoft YaHei", sans-serif`);
  root.style.setProperty('--lyric-weight', lyricSettings.fontWeight);
  root.style.setProperty('--lyric-size', `${fontSize}px`);
  root.style.setProperty('--lyric-line-height', lyricSettings.lineHeight);
  root.style.setProperty('--lyric-color', lyricSettings.textColor);
  root.style.setProperty('--lyric-stroke', lyricSettings.strokeColor);
  root.style.setProperty('--lyric-stroke-width', `${numberSetting(lyricSettings.strokeWidth, 3)}px`);
  root.style.setProperty('--lyric-opacity', String(numberSetting(lyricSettings.opacity, 0.95)));
  root.style.setProperty('--lyric-bg-opacity', String(numberSetting(lyricSettings.bgOpacity, 0.15)));
  root.style.setProperty('--lyric-shadow-opacity', String(numberSetting(lyricSettings.shadowIntensity, 0.35)));
  root.style.setProperty('--lyric-translation-size', `${fontSize * numberSetting(lyricSettings.translationScale, 0.65)}px`);
  surface.style.transform = `scale(${currentScale})`;
}

function renderLyricState() {
  const line = document.getElementById('lyricLine');
  const translation = document.getElementById('lyricTranslation');
  const progress = document.getElementById('lyricProgress');
  if (!line || !translation || !progress) return;

  const fallback = fallbackCopy();
  const hasLine = Boolean(lyricState.lineText || lyricState.words?.length);
  const nextSignature = JSON.stringify([
    hasLine ? lyricState.lineText : fallback,
    lyricState.translation,
    lyricState.words
  ]);
  if (nextSignature !== contentSignature) {
    if (hasLine && Array.isArray(lyricState.words) && lyricState.words.length > 0) {
      renderedWords = lyricState.words;
      line.innerHTML = renderedWords.map(renderWord).join('');
      wordElements = Array.from(line.querySelectorAll('.lyric-word'));
    } else {
      renderedWords = [];
      wordElements = [];
      line.textContent = hasLine ? lyricState.lineText : fallback;
    }
    translation.textContent = lyricState.translation;
    translation.hidden = !lyricState.translation;
    contentSignature = nextSignature;
  }
  document.body.classList.toggle('has-lyric', hasLine);
  document.body.classList.toggle('is-locked', lyricState.locked === true);
  if (animationFrame) cancelAnimationFrame(animationFrame);
  renderPlaybackFrame(performance.now());
}

function fallbackCopy() {
  if (document.body.classList.contains('is-disconnected')) {
    return '正在重新连接';
  }
  if (lyricState.status === 'loading') {
    return '正在载入歌词';
  }
  if (lyricState.status === 'empty') {
    return '这首歌暂无歌词';
  }
  if (lyricState.status === 'ready') {
    return '前奏中';
  }
  return '等待播放';
}

function renderWord(word) {
  return `<span class="lyric-word">${escapeHtml(word.text || '')}</span>`;
}

function renderPlaybackFrame(now) {
  animationFrame = 0;
  const position = playbackPosition(now);
  const progress = document.getElementById('lyricProgress');
  if (progress) progress.style.transform = `scaleX(${position.progress})`;

  for (let index = 0; index < wordElements.length; index += 1) {
    const word = renderedWords[index] || {};
    const startMs = numberValue(word.startMs, 0);
    const endMs = Math.max(startMs, numberValue(word.endMs, startMs));
    const wordProgress = endMs > startMs
      ? clamp((position.currentMs - startMs) / (endMs - startMs), 0, 1)
      : position.currentMs >= endMs ? 1 : 0;
    wordElements[index].style.setProperty('--word-progress', `${wordProgress * 100}%`);
  }

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (lyricState.playing && !reducedMotion) {
    animationFrame = requestAnimationFrame(renderPlaybackFrame);
  }
}

function playbackPosition(now) {
  const elapsed = lyricState.playing ? Math.max(0, now - playbackAnchor.updatedAt) : 0;
  const durationMs = Math.max(0, playbackAnchor.durationMs);
  const currentMs = durationMs > 0
    ? Math.min(durationMs, playbackAnchor.currentMs + elapsed)
    : Math.max(0, playbackAnchor.currentMs + elapsed);
  const progress = durationMs > 0
    ? currentMs / durationMs
    : playbackAnchor.progress;
  return { currentMs, progress: clamp(progress, 0, 1) };
}

function smoothCurrentMs(incoming, estimated, playing) {
  if (!playing || Math.abs(incoming - estimated) > 600) return incoming;
  return Math.max(incoming, estimated);
}

function setupWheelZoom() {
  const surface = document.querySelector('.lyric-window-surface');
  if (!surface) return;
  surface.addEventListener('wheel', (event) => {
    if (lyricState.locked || !event.ctrlKey) return;
    event.preventDefault();
    currentScale = Math.max(0.5, Math.min(2, currentScale + (event.deltaY > 0 ? -0.1 : 0.1)));
    surface.style.transform = `scale(${currentScale})`;
  }, { passive: false });
}

function numberSetting(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
