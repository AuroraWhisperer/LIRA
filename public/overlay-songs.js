// 编写人：Aurora
// 当前项目版本：1.4.6
'use strict';

let state = null;
let songs = [];
let reloadTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let lastRenderKey = null;
const multilingualFontFallback = '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

document.addEventListener('DOMContentLoaded', () => {
  loadAll();
  connectSocket();
});

async function loadAll() {
  try {
    const category = new URLSearchParams(location.search).get('category') || '';
    const [stateResponse, songsResponse] = await Promise.all([
      fetch('/api/state'),
      fetch(`/api/songs?enabledOnly=true${category ? `&category=${encodeURIComponent(category)}` : ''}`)
    ]);
    const statePayload = await stateResponse.json();
    const songsPayload = await songsResponse.json();
    if (statePayload.ok) state = statePayload.data;
    if (songsPayload.ok) songs = songsPayload.data;
  } catch (error) {
    console.warn('[overlay-songs] loadAll failed:', error.message || error);
  }
  lastRenderKey = null;
  render();
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    lastRenderKey = null;
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'snapshot') {
      if (payload.reason === 'live:status' && state) {
        state.liveStatus = payload.state.liveStatus;
        return;
      }
      state = payload.state;
      if (payload.reason && (payload.reason.startsWith('songs:') || payload.reason === 'database:clear')) {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(loadAll, 220);
        return;
      }
      var newKey = computeSongsStateKey(state);
      if (newKey === lastRenderKey) return;
      lastRenderKey = newKey;
      render();
    }
  });

  socket.addEventListener('close', () => {
    const delay = Math.min(30000, 800 * Math.pow(2, Math.min(reconnectAttempts, 6)));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      loadAll();
      connectSocket();
    }, delay);
  });
}

function render() {
  if (!state) return;
  const settings = state.settings || {};
  const category = new URLSearchParams(location.search).get('category') || '';
  applyTheme(settings);
  // Respect custom title from settings, fall back to category-based title
  if (!settings.overlayTitle && !settings.songBoardTitle) {
    document.getElementById('songBoardTitle').textContent = category ? `可点歌单 · ${category}` : '可点歌单';
  }

  const list = document.getElementById('songScrollList');
  if (songs.length === 0) {
    list.classList.add('paused');
    list.innerHTML = '<div class="overlay-empty">歌库还没有可展示歌曲</div>';
    return;
  }

  const sortMode = settings.songBoardSortMode || 'initial';
  const html = sortMode === 'length'
    ? renderFlatSongs(sortSongsByLength(songs))
    : renderGroups(groupSongs(songs, sortMode));
  const shouldScroll = songs.length > 8;
  list.classList.toggle('paused', !shouldScroll);
  list.innerHTML = shouldScroll ? `${html}${html}` : html;
}

function computeSongsStateKey(currentState) {
  var settings = currentState.settings || {};
  return JSON.stringify([
    songs.map(function (s) { return s.id; }),
    settings.songBoardSortMode,
    settings.songBoardSyncTheme,
    settings.songBoardThemePrimary, settings.songBoardThemeAccent,
    settings.songBoardThemeText, settings.songBoardThemeBackground,
    settings.themePrimary, settings.themeAccent, settings.themeText, settings.themeBackground,
    settings.themeOpacity, settings.themeRadius,
    settings.backdropBlur, settings.glowIntensity,
    settings.enableGradient, settings.gradientEnd,
    settings.songBoardBackdropBlur, settings.songBoardGlowIntensity,
    settings.songBoardEnableGradient, settings.songBoardGradientEnd,
    settings.songBoardFontFamily, settings.songBoardFontWeight,
    settings.songBoardSongColor, settings.songBoardSongFontSize, settings.songBoardTitleFontSize,
    settings.overlayFontFamily, settings.overlayFontWeight,
    settings.overlaySongColor, settings.overlayRequesterColor,
    settings.overlayTitle, settings.songBoardTitle,
    settings.overlayLowPowerMode, settings.themeFontScale,
    settings.scrollSeconds
  ]);
}

function groupSongs(items, sortMode) {
  const mode = sortMode || 'initial';
  const groups = new Map();

  for (const song of items) {
    let key;
    switch (mode) {
      case 'category':
        key = song.category_name || '默认';
        break;
      case 'artist':
        key = song.artist || '未知歌手';
        break;
      case 'language':
        key = song.language || '未知语言';
        break;
      case 'length': {
        const len = String(song.name || '').length;
        key = len > 0 ? `${len} 字` : '未知';
        break;
      }
      default:
        key = song.name_initial || '#';
        break;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(song);
  }

  const entries = Array.from(groups.entries());
  if (mode === 'length') {
    entries.sort((a, b) => {
      const numA = parseInt(a[0], 10) || 0;
      const numB = parseInt(b[0], 10) || 0;
      return numA - numB;
    });
  } else {
    entries.sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'));
  }
  return entries;
}

function sortSongsByLength(items) {
  return [...items].sort((a, b) => {
    const lengthDiff = String(a.name || '').length - String(b.name || '').length;
    if (lengthDiff !== 0) return lengthDiff;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  });
}

function renderFlatSongs(items) {
  return items.map((song) => `
    <div class="song-card">
      <strong>${escapeHtml(song.name)}</strong>
      <span>${escapeHtml(song.artist || song.category_name || '')}</span>
    </div>
  `).join('');
}

function renderGroups(groups) {
  return groups.map(([initial, groupSongs]) => `
    <div class="song-group">
      <div class="song-group-title">${escapeHtml(initial)}</div>
      ${groupSongs.map((song) => `
        <div class="song-card">
          <strong>${escapeHtml(song.name)}</strong>
          <span>${escapeHtml(song.artist || song.category_name || '')}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function applyTheme(settings) {
  const useOwnTheme = settings.songBoardSyncTheme === 'false';

  function resolve(mainKey, songBoardKey, defaultValue) {
    if (useOwnTheme) {
      const override = settings[songBoardKey];
      if (override !== undefined && override !== '') return override;
    }
    return settings[mainKey] !== undefined && settings[mainKey] !== '' ? settings[mainKey] : defaultValue;
  }

  const root = document.documentElement;
  const panel = document.querySelector('.overlay-panel');
  const lowPower = overlayLowPowerEnabled(settings);
  panel.classList.toggle('low-power', lowPower);

  root.style.setProperty('--overlay-primary', resolve('themePrimary', 'songBoardThemePrimary', '#ff6f91'));
  root.style.setProperty('--overlay-accent', resolve('themeAccent', 'songBoardThemeAccent', '#21b6a8'));
  root.style.setProperty('--overlay-text', resolve('themeText', 'songBoardThemeText', '#fff7fb'));
  root.style.setProperty('--overlay-opacity', resolve('themeOpacity', 'songBoardThemeOpacity', '0.76'));
  root.style.setProperty('--overlay-radius', `${resolve('themeRadius', 'songBoardThemeRadius', '8')}px`);
  root.style.setProperty('--overlay-font-scale', resolve('themeFontScale', 'songBoardThemeFontScale', '1'));

  const urlSpeed = new URLSearchParams(location.search).get('speed');
  const scrollSpeed = Number(urlSpeed || settings.scrollSeconds || 20);
  const scrollDuration = scrollSpeedToDuration(scrollSpeed);
  root.style.setProperty('--scroll-seconds', `${scrollDuration}s`);

  const primaryHex = resolve('themePrimary', 'songBoardThemePrimary', '#ff6f91');
  const primaryRgb = hexToRgb(primaryHex);
  root.style.setProperty('--overlay-primary-r', String(primaryRgb.r));
  root.style.setProperty('--overlay-primary-g', String(primaryRgb.g));
  root.style.setProperty('--overlay-primary-b', String(primaryRgb.b));

  const accentHex = resolve('themeAccent', 'songBoardThemeAccent', '#21b6a8');
  const accentRgb = hexToRgb(accentHex);
  root.style.setProperty('--overlay-accent-r', String(accentRgb.r));
  root.style.setProperty('--overlay-accent-g', String(accentRgb.g));
  root.style.setProperty('--overlay-accent-b', String(accentRgb.b));

  const bgHex = resolve('themeBackground', 'songBoardThemeBackground', '#181823');
  const bgRgb = hexToRgb(bgHex);
  root.style.setProperty('--overlay-bg-r', String(bgRgb.r));
  root.style.setProperty('--overlay-bg-g', String(bgRgb.g));
  root.style.setProperty('--overlay-bg-b', String(bgRgb.b));

  const blur = lowPower ? 0 : Number(resolve('backdropBlur', 'songBoardBackdropBlur', '0'));
  root.style.setProperty('--overlay-blur', `${Number.isFinite(blur) ? Math.max(0, blur) : 0}px`);
  panel.classList.toggle('has-backdrop-blur', blur > 0);

  const rawGlowIntensity = Number(resolve('glowIntensity', 'songBoardGlowIntensity', '0'));
  const glowIntensity = lowPower || !Number.isFinite(rawGlowIntensity) ? 0 : Math.max(0, rawGlowIntensity);
  root.style.setProperty('--overlay-glow-size', `${glowIntensity}px`);
  root.style.setProperty('--overlay-glow-color',
    glowIntensity > 0
      ? `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${Math.min(0.25, glowIntensity / 80)})`
      : 'transparent');

  const gradientEnabled = resolve('enableGradient', 'songBoardEnableGradient', 'false') === 'true';
  panel.classList.toggle('gradient-bg', gradientEnabled);
  if (gradientEnabled) {
    const gradHex = resolve('gradientEnd', 'songBoardGradientEnd', '#181823') || bgHex;
    const gradRgb = hexToRgb(gradHex);
    root.style.setProperty('--overlay-gradient-r', String(gradRgb.r));
    root.style.setProperty('--overlay-gradient-g', String(gradRgb.g));
    root.style.setProperty('--overlay-gradient-b', String(gradRgb.b));
  }

  root.style.setProperty('--overlay-font-family', withMultilingualFallback(resolve('overlayFontFamily', 'songBoardFontFamily', 'Microsoft YaHei')));
  root.style.setProperty('--overlay-font-weight', resolve('overlayFontWeight', 'songBoardFontWeight', '800'));

  const songColor = resolve('overlaySongColor', 'songBoardSongColor', '');
  root.style.setProperty('--overlay-song-color', songColor || resolve('themeText', 'songBoardThemeText', '#fff7fb'));
  root.style.setProperty('--overlay-requester-color', settings.overlayRequesterColor || '');

  const titleEl = document.getElementById('songBoardTitle');
  if (titleEl) {
    const customTitle = String(resolve('overlayTitle', 'songBoardTitle', '')).trim();
    titleEl.textContent = customTitle || '可点歌单';
  }

  if (useOwnTheme) {
    const songFontSize = Number(settings.songBoardSongFontSize || '16');
    root.style.setProperty('--overlay-song-font-size', `${songFontSize}px`);
    root.style.setProperty('--overlay-title-font-size', `${Number(settings.songBoardTitleFontSize || '15')}px`);
  } else {
    root.style.removeProperty('--overlay-song-font-size');
    root.style.removeProperty('--overlay-title-font-size');
  }

  panel.style.backgroundColor = hexToRgba(bgHex, resolve('themeOpacity', 'songBoardThemeOpacity', '0.76'));
}

function hexToRgb(hex) {
  const normalized = String(hex || '#181823').replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const number = Number.parseInt(value, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
}

function scrollSpeedToDuration(value) {
  const speed = Math.max(1, Math.min(200, Math.round(Number(value) || 20)));
  const minSeconds = 100;
  const maxSeconds = 3000;
  return (maxSeconds - ((speed - 1) / 199) * (maxSeconds - minSeconds)).toFixed(1);
}

function overlayLowPowerEnabled(settings) {
  const quality = new URLSearchParams(location.search).get('quality');
  if (quality === 'pretty' || quality === 'smooth') return false;
  if (quality === 'low') return true;
  return (settings.overlayLowPowerMode || 'false') === 'true';
}

function hexToRgba(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  const alpha = Number(opacity);
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.76;
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function withMultilingualFallback(fontFamily) {
  const selected = String(fontFamily || '').trim();
  if (!selected) return multilingualFontFallback;
  return `${selected}, ${multilingualFontFallback}`;
}
