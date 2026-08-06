import { SongVirtualScroller } from './song-virtual-scroller.js';

'use strict';

let state = null;
let songs = [];
let songsRevision = 0;
let reloadTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let resizeTimer = null;
let resizeObserver = null;
let relayoutRevision = 0;
let scroller = null;
let songListElement = null;
let lastOrderKey = null;
let lastLayoutKey = null;
let lastMotionKey = null;
const overlayUtils = window.OverlayUtils;

document.addEventListener('DOMContentLoaded', () => {
  initializeScroller();
  loadAll();
  connectSocket();
});

function initializeScroller() {
  const list = document.getElementById('songScrollList');
  const viewport = list?.closest('.song-scroll-window');
  if (!list || !viewport) return;
  songListElement = list;

  scroller = new SongVirtualScroller({
    viewport,
    content: list,
    createNode: createSongRecordNode,
    beforeViewports: 1,
    afterViewports: 1.5
  });

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => scheduleRelayout({ delay: 120 }));
    resizeObserver.observe(viewport);
  } else {
    window.addEventListener('resize', handleViewportResize);
  }

  document.fonts?.addEventListener?.('loadingdone', handleFontsLoaded);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', destroyScroller, { once: true });
}

function destroyScroller() {
  clearTimeout(resizeTimer);
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('resize', handleViewportResize);
  document.fonts?.removeEventListener?.('loadingdone', handleFontsLoaded);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  scroller?.destroy();
  scroller = null;
  songListElement = null;
}

function handleViewportResize() {
  scheduleRelayout({ delay: 120 });
}

function handleFontsLoaded() {
  scheduleRelayout({ delay: 0 });
}

function handleVisibilityChange() {
  if (document.hidden) scroller?.pause();
  else scroller?.start();
}

async function loadAll() {
  const anchor = scroller?.captureAnchor() ?? null;
  try {
    const category = new URLSearchParams(location.search).get('category') || '';
    const [stateResponse, songsResponse] = await Promise.all([
      fetch('/api/state'),
      fetch(`/api/songs?enabledOnly=true${category ? `&category=${encodeURIComponent(category)}` : ''}`)
    ]);
    const statePayload = await stateResponse.json();
    const songsPayload = await songsResponse.json();
    if (statePayload.ok) state = statePayload.data;
    if (songsPayload.ok) {
      songs = songsPayload.data;
      songsRevision += 1;
    }
  } catch (error) {
    console.warn('[overlay-songs] loadAll failed:', error.message || error);
  }
  render({ forceData: true, anchor });
}

function connectSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = window.__API_TOKEN__;
  const wsUrl = `${protocol}//${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type !== 'snapshot') return;
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
    render();
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

function render({ forceData = false, anchor = scroller?.captureAnchor() ?? null } = {}) {
  if (!state || !scroller) return;
  const settings = state.settings || {};
  const category = new URLSearchParams(location.search).get('category') || '';
  const sortMode = settings.songBoardSortMode || 'initial';
  const orderKey = `${songsRevision}:${sortMode}`;
  const layoutKey = computeLayoutKey(settings);
  const motionKey = String(resolveSongScrollSpeed(settings));
  const orderChanged = forceData || orderKey !== lastOrderKey;
  const layoutChanged = layoutKey !== lastLayoutKey;

  if (layoutChanged) scroller.pause();
  applyTheme(settings);
  if (!settings.overlayTitle && !settings.songBoardTitle) {
    document.getElementById('songBoardTitle').textContent = category ? `可点歌单 · ${category}` : '可点歌单';
  }

  if (motionKey !== lastMotionKey) {
    scroller.setSecondsPerViewport(Number(scrollSpeedToDuration(Number(motionKey))));
  }

  if (orderChanged) {
    if (songs.length === 0) {
      scroller.setRecords([]);
      renderEmptyState();
    } else {
      const records = buildSongRecords(songs, sortMode);
      songListElement.classList.toggle('grouped', sortMode !== 'length');
      scroller.setRecords(records, anchor);
    }
  }

  lastOrderKey = orderKey;
  lastLayoutKey = layoutKey;
  lastMotionKey = motionKey;

  if (layoutChanged && songs.length > 0) {
    scheduleRelayout({ anchor: scroller.captureAnchor(), delay: 0, waitForFonts: true });
  } else if (!document.hidden && songs.length > 0) {
    scroller.start();
  }
}

function renderEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'overlay-empty';
  empty.textContent = '歌库还没有可展示歌曲';
  songListElement.replaceChildren(empty);
}

function scheduleRelayout({ anchor = scroller?.captureAnchor() ?? null, delay = 120, waitForFonts = false } = {}) {
  if (!scroller || scroller.records.length === 0) return;
  const revision = ++relayoutRevision;
  scroller.pause();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    if (waitForFonts && document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch (error) {
        console.warn('[overlay-songs] font loading failed:', error.message || error);
      }
    }
    if (revision !== relayoutRevision || !scroller) return;
    scroller.relayout(anchor);
    if (!document.hidden) scroller.start();
  }, delay);
}

function computeLayoutKey(settings) {
  return JSON.stringify([
    settings.songBoardSyncTheme,
    settings.songBoardFontFamily,
    settings.songBoardFontWeight,
    settings.songBoardFontSize,
    settings.songBoardSongFontSize,
    settings.overlayFontFamily,
    settings.overlayFontWeight
  ]);
}

export function buildSongRecords(items, sortMode = 'initial') {
  if (sortMode === 'length') {
    return sortSongsByLength(items).map(createSongRecord);
  }

  const records = [];
  for (const [label, groupedSongs] of groupSongs(items, sortMode)) {
    records.push({
      type: 'heading',
      key: `heading:${sortMode}:${label}`,
      label
    });
    records.push(...groupedSongs.map(createSongRecord));
  }
  return records;
}

function createSongRecord(song) {
  return {
    type: 'song',
    key: `song:${song.id}`,
    song,
    artist: primarySongArtist(song)
  };
}

function createSongRecordNode(record) {
  if (record.type === 'heading') {
    const heading = document.createElement('div');
    heading.className = 'song-group-title';
    heading.textContent = record.label;
    return heading;
  }

  const card = document.createElement('div');
  card.className = 'song-card';
  const name = document.createElement('strong');
  name.className = 'song-name';
  name.title = String(record.song.name || '');
  name.textContent = record.song.name || '';
  const artist = document.createElement('span');
  artist.className = 'song-artist';
  artist.title = record.artist;
  artist.textContent = record.artist;
  card.append(name, artist);
  return card;
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
        key = primarySongArtist(song) || '未知歌手';
        break;
      case 'language':
        key = song.language || '未知语言';
        break;
      default:
        key = song.name_initial || '#';
        break;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(song);
  }

  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'));
}

function sortSongsByLength(items) {
  return [...items].sort((a, b) => {
    const lengthDiff = String(a.name || '').length - String(b.name || '').length;
    if (lengthDiff !== 0) return lengthDiff;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  });
}

function primarySongArtist(song) {
  return String(song.artist || song.category_name || '').split('/', 1)[0].trim();
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
  root.style.setProperty('--overlay-opacity', resolve('themeOpacity', 'songBoardThemeOpacity', '0.48'));
  root.style.setProperty('--overlay-radius', `${resolve('themeRadius', 'songBoardThemeRadius', '8')}px`);
  const songBoardFontSize = Math.max(10, Math.min(80, Number(settings.songBoardFontSize) || 50));
  root.style.setProperty('--overlay-font-scale', String(songBoardFontSize / 16));

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

  const blur = lowPower ? 0 : Number(resolve('backdropBlur', 'songBoardBackdropBlur', '14'));
  root.style.setProperty('--overlay-blur', `${Number.isFinite(blur) ? Math.max(0, blur) : 0}px`);
  panel.classList.toggle('has-backdrop-blur', blur > 0);

  const rawGlowIntensity = Number(resolve('glowIntensity', 'songBoardGlowIntensity', '2'));
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

  panel.style.backgroundColor = hexToRgba(bgHex, resolve('themeOpacity', 'songBoardThemeOpacity', '0.48'));
}

function hexToRgb(hex) {
  return overlayUtils.hexToRgb(hex);
}

export function scrollSpeedToDuration(value) {
  const speed = Math.max(1, Math.min(100, Math.round(Number(value) || 20)));
  const minSeconds = 2;
  const maxSeconds = 1000;
  const oldMinRate = 1 / maxSeconds;
  const maxRate = 1 / minSeconds;
  const oldRange = 200 - 1;
  const minRate = oldMinRate + ((20 - 1) / oldRange) * (maxRate - oldMinRate);
  const ratio = (speed - 1) / (100 - 1);
  const rate = minRate + ratio * (maxRate - minRate);
  return (1 / rate).toFixed(6);
}

function resolveSongScrollSpeed(settings) {
  const urlSpeed = new URLSearchParams(location.search).get('speed');
  return Number(urlSpeed || settings?.scrollSeconds || 45);
}

function overlayLowPowerEnabled(settings) {
  return overlayUtils.overlayLowPowerEnabled(settings);
}

function hexToRgba(hex, opacity) {
  return overlayUtils.hexToRgba(hex, opacity);
}

function withMultilingualFallback(fontFamily) {
  return overlayUtils.withMultilingualFallback(fontFamily);
}
