'use strict';

const DEFAULT_STATE = {
  trackTitle: '', artists: [], lineText: '', translation: '', words: [],
  currentMs: 0, progress: 0, playing: false, locked: false, status: 'idle'
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

document.addEventListener('DOMContentLoaded', () => {
  renderLyricState();
  void loadSettings();
  setupWheelZoom();
  connectSocket();
  if (window.musicAPI?.onLyricState) window.musicAPI.onLyricState(updateLyricState);
});

function updateLyricState(state) {
  lyricState = { ...lyricState, ...(state || {}) };
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
  const meta = document.getElementById('lyricMeta');
  const playbackState = document.getElementById('lyricPlaybackState');
  const track = document.getElementById('lyricTrack');
  const progress = document.getElementById('lyricProgress');
  if (!line || !translation || !meta || !playbackState || !track || !progress) return;

  const fallback = fallbackCopy();
  const hasLine = Boolean(lyricState.lineText || lyricState.words?.length);
  if (hasLine && Array.isArray(lyricState.words) && lyricState.words.length > 0) {
    line.innerHTML = lyricState.words.map(renderWord).join('');
  } else {
    line.textContent = hasLine ? lyricState.lineText : fallback.line;
  }
  translation.textContent = lyricState.translation || fallback.detail;
  translation.hidden = !translation.textContent;
  track.textContent = [lyricState.trackTitle, formatArtists(lyricState.artists)].filter(Boolean).join(' · ');
  playbackState.textContent = lyricState.playing ? '正在播放' : lyricState.trackTitle ? '已暂停' : fallback.label;
  meta.hidden = !lyricState.trackTitle && !fallback.showMeta;
  progress.style.width = `${Math.max(0, Math.min(100, Number(lyricState.progress || 0) * 100))}%`;
  document.body.classList.toggle('has-lyric', hasLine);
  document.body.classList.toggle('is-playing', lyricState.playing === true);
  document.body.classList.toggle('is-locked', lyricState.locked === true);
}

function fallbackCopy() {
  if (document.body.classList.contains('is-disconnected')) {
    return { line: '正在重新连接', detail: '请确认点歌助手仍在运行', label: '连接中', showMeta: true };
  }
  if (lyricState.status === 'loading') {
    return { line: '正在载入歌词', detail: lyricState.trackTitle || '', label: '载入中', showMeta: true };
  }
  if (lyricState.status === 'empty') {
    return { line: '这首歌暂无歌词', detail: '播放正常，暂未获取到歌词文本', label: '无歌词', showMeta: true };
  }
  if (lyricState.status === 'ready' && lyricState.trackTitle) {
    return { line: '前奏中', detail: '歌词即将开始', label: '正在播放', showMeta: true };
  }
  return { line: '等待播放', detail: '开始播放歌曲后，歌词会显示在这里', label: '待机', showMeta: true };
}

function renderWord(word) {
  const currentMs = Number(lyricState.currentMs || 0);
  const startMs = Number(word.startMs || 0);
  const endMs = Math.max(startMs, Number(word.endMs || startMs));
  const wordProgress = endMs > startMs
    ? Math.max(0, Math.min(1, (currentMs - startMs) / (endMs - startMs)))
    : currentMs >= endMs ? 1 : 0;
  return `<span class="lyric-word" style="--word-progress:${wordProgress * 100}%">${escapeHtml(word.text || '')}</span>`;
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

function formatArtists(artists) {
  return Array.isArray(artists) ? artists.filter(Boolean).join(' / ') : String(artists || '');
}

function numberSetting(value, fallback) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
