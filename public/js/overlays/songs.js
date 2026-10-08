import { SongVirtualScroller } from './song-virtual-scroller.js';
import { createOverlaySocket } from './socket-client.js';
import { isComponentPreview } from './component-preview-client.js';
import { SONG_BOARD_THEME_FIELDS } from '../shared/song-board-theme-fields.js';
import { mountSceneExtraClient } from './scene-extra-client.js';
import { hexToRgba } from './overlay-utils-module.js';
import { applyOverlayTheme } from './overlay-theme.js';

('use strict');

let state = null;
let songs = [];
let songsRevision = 0;
let loadRevision = 0;
let stateRevision = 0;
let liveStatusRevision = 0;
let reloadTimer = null;
let socketController = null;
let resizeTimer = null;
let resizeObserver = null;
let relayoutRevision = 0;
let scroller = null;
let songListElement = null;
let lastOrderKey = null;
let lastLayoutKey = null;
let lastMotionKey = null;
let componentSongs = [];
let componentCategory = '';

document.addEventListener('DOMContentLoaded', () => {
  initializeScroller();
  if (isComponentPreview()) {
    mountSceneExtraClient('songlist', {
      onConfig(config) {
        state = { settings: { ...config, ...(config.songBoardSyncTheme === 'true'
          ? Object.fromEntries(Object.entries(SONG_BOARD_THEME_FIELDS).map(([field, key]) => [key, config[field]]))
          : { songBoardSyncTheme: 'false' }) } };
        componentCategory = config.category;
        updateComponentSongs();
      },
      onData(data) { componentSongs = data?.songs || []; updateComponentSongs(); },
      onDispose: destroyScroller,
    });
    return;
  }
  loadAll();
  connectSocket();
  window.addEventListener('beforeunload', disposeSocket, { once: true });
});

function updateComponentSongs() {
  const next = componentCategory ? componentSongs.filter((song) => song.category_name === componentCategory) : componentSongs;
  if (JSON.stringify(next) !== JSON.stringify(songs)) { songs = next; songsRevision += 1; }
  render();
}

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
    afterViewports: 1.5,
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
  const revision = ++loadRevision;
  const expectedStateRevision = stateRevision;
  const expectedLiveStatusRevision = liveStatusRevision;
  try {
    const category = new URLSearchParams(location.search).get('category') || '';
    const [stateResponse, songsResponse] = await Promise.all([
      fetch('/api/state'),
      fetch(`/api/songs?enabledOnly=true${category ? `&category=${encodeURIComponent(category)}` : ''}`),
    ]);
    const statePayload = await stateResponse.json();
    const songsPayload = await songsResponse.json();
    if (revision !== loadRevision) return;
    if (statePayload.ok && expectedStateRevision === stateRevision) {
      if (expectedLiveStatusRevision !== liveStatusRevision) statePayload.data.liveStatus = state.liveStatus;
      state = statePayload.data;
    }
    if (songsPayload.ok && JSON.stringify(songsPayload.data) !== JSON.stringify(songs)) {
      songs = songsPayload.data;
      songsRevision += 1;
    }
  } catch (error) {
    console.warn('[overlay-songs] loadAll failed:', error.message || error);
  }
  if (revision === loadRevision) render();
}

function connectSocket() {
  if (socketController) return;
  socketController = createOverlaySocket({
    onReconnect: () => {
      loadAll();
    },
    onMessage: (payload) => {
      if (payload.type !== 'snapshot') return;
      if (payload.reason === 'live:status' && state) {
        liveStatusRevision += 1;
        state.liveStatus = payload.state.liveStatus;
        return;
      }

      stateRevision += 1;
      state = payload.state;
      if (
        payload.reason &&
        (payload.reason.startsWith('songs:') ||
          payload.reason === 'cloud:songs' ||
          payload.reason === 'database:clear' ||
          payload.reason === 'database:clear-all')
      ) {
        loadRevision += 1;
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(loadAll, 220);
        return;
      }
      render();
    },
  });
  socketController.start();
}

function disposeSocket() {
  loadRevision += 1;
  clearTimeout(reloadTimer);
  socketController?.dispose();
  socketController = null;
}

function render() {
  if (!state || !scroller) return;
  const anchor = scroller.captureAnchor();
  const settings = state.settings || {};
  const category = new URLSearchParams(location.search).get('category') || '';
  const sortMode = settings.songBoardSortMode || 'initial';
  const orderKey = `${songsRevision}:${sortMode}`;
  const layoutKey = computeLayoutKey(settings);
  const motionKey = String(resolveSongScrollSpeed(settings));
  const orderChanged = orderKey !== lastOrderKey;
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
    scheduleRelayout({
      anchor: scroller.captureAnchor(),
      delay: 0,
      waitForFonts: true,
    });
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
    if (revision !== relayoutRevision || !scroller || scroller.records.length === 0) return;
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
    settings.overlayFontWeight,
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
      label,
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
    artist: primarySongArtist(song),
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
  return String(song.artist || song.category_name || '')
    .split('/', 1)[0]
    .trim();
}

// 点歌板自己的主题默认值与覆盖规则：共享 applyOverlayTheme 只负责写变量。
const SONG_BOARD_THEME_DEFAULTS = Object.freeze({
  themeOpacity: '0.48',
  themeRadius: '8',
  backdropBlur: '14',
  glowIntensity: '2',
  gradientEnd: '#181823',
  overlaySongColor: '',
});
const SONG_BOARD_KEY_BY_THEME_KEY = Object.freeze(
  Object.fromEntries(Object.entries(SONG_BOARD_THEME_FIELDS).map(([boardKey, themeKey]) => [themeKey, boardKey])),
);

function applyTheme(settings) {
  const useOwnTheme = settings.songBoardSyncTheme === 'false';
  const root = document.documentElement;
  const panel = document.querySelector('.overlay-panel');

  function resolve(themeKey, defaultValue) {
    const boardKey = SONG_BOARD_KEY_BY_THEME_KEY[themeKey];
    if (useOwnTheme && boardKey) {
      const override = settings[boardKey];
      if (override !== undefined && override !== '') return override;
    }
    return settings[themeKey] !== undefined && settings[themeKey] !== '' ? settings[themeKey] : defaultValue;
  }

  applyOverlayTheme(root, panel, settings, {
    resolve,
    defaults: SONG_BOARD_THEME_DEFAULTS,
    fontScale: () => String(Math.max(10, Math.min(80, Number(settings.songBoardFontSize) || 28)) / 16),
  });

  const titleEl = document.getElementById('songBoardTitle');
  if (titleEl) {
    const customTitle = String(resolve('overlayTitle', '')).trim();
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

  const bgHex = resolve('themeBackground', '#181823');
  panel.style.backgroundColor = hexToRgba(bgHex, resolve('themeOpacity', SONG_BOARD_THEME_DEFAULTS.themeOpacity));
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
