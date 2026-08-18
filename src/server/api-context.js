'use strict';

const { clearMusicCache, getMusicCacheStats } = require('../music/music-cache');
const { createUnavailableGiftSaleCatalogService } = require('../bilibili/gift/sale-catalog');
const lifecycle = require('./lifecycle');
const systemMetrics = require('./system-metrics');

function createApiContext(options) {
  const {
    maxBodyBytes,
    sessionToken,
    broadcastSnapshot,
    broadcastGiftEffectPreview,
    domainServices,
    messageBuffer,
    publishLyricState,
    publishLyricTimeline,
    weSingCapture,
    bilibili,
    ai,
    games,
    settings,
    system,
    music
  } = options;
  const overtimeGiftCatalog = domainServices.overtimeGiftCatalog
    || createUnavailableGiftSaleCatalogService();

  return {
    maxBodyBytes,
    sessionToken,
    broadcastSnapshot,
    songs: {
      list: domainServices.songs.list,
      save: domainServices.songs.save,
      delete: domainServices.songs.delete,
      toggle: domainServices.songs.toggle,
      import: domainServices.songs.import,
      listCategories: domainServices.songs.listCategories
    },
    queue: {
      add: domainServices.queue.add,
      handleAction: domainServices.queue.handleAction
    },
    superChat: {
      handleAction: domainServices.superChats.handleAction
    },
    gifts: {
      resetSprint: domainServices.gifts.resetSprint,
      getHistory: (historyOptions) => domainServices.gifts.getHistory(historyOptions),
      getBlindBoxStats: domainServices.gifts.getBlindBoxStats,
      getBlindBoxAnalysis: domainServices.gifts.getBlindBoxAnalysis,
      search: domainServices.gifts.search,
      clearRecent: domainServices.gifts.clearRecent,
      resolveEffect: domainServices.gifts.resolveEffect,
      previewEffect: broadcastGiftEffectPreview
    },
    overtime: {
      getOverview: domainServices.overtime.getOverview,
      setTime: domainServices.overtime.setTime,
      act: domainServices.overtime.act,
      setBackground: domainServices.overtime.setBackground,
      replaceRules: domainServices.overtime.replaceRules,
      getGiftCatalog: overtimeGiftCatalog.getSnapshot,
      refreshGiftCatalog: overtimeGiftCatalog.refresh
    },
    debug: {
      getGiftMessages: () => messageBuffer.getAll(),
      getGiftMessageStats: () => messageBuffer.getStats(),
      clearGiftMessages: () => messageBuffer.clear()
    },
    data: {
      clearSongLibrary: domainServices.data.clearSongLibrary,
      clearSuperChats: domainServices.data.clearSuperChats,
      clearPlayback: domainServices.data.clearPlayback,
      clearGifts: domainServices.data.clearGifts,
      clearAll: domainServices.data.clearAll,
      getSchemaVersions: domainServices.data.getSchemaVersions,
      getRetentionStats: domainServices.data.getRetentionStats,
      runRetention: domainServices.data.runRetention
    },
    playback: domainServices.playback,
    playbackLyrics: {
      publish: publishLyricState,
      publishTimeline: publishLyricTimeline
    },
    weSing: {
      getStatus: weSingCapture.getStatus,
      configure: weSingCapture.setCachePath,
      setLyricOffsetMs: weSingCapture.setLyricOffsetMs,
      setActive: weSingCapture.setActive,
      refresh: weSingCapture.refresh
    },
    theme: domainServices.theme,
    bilibili: {
      liveStatus: bilibili.liveStatus,
      configure: bilibili.configure,
      reconnect: bilibili.reconnect,
      updateStatus: bilibili.updateStatus,
      auth: bilibili.auth,
      getDanmakuSenderState: () => bilibili.danmakuSender.getState(),
      sendDanmaku: (input) => bilibili.danmakuSender.send(input)
    },
    ai: {
      getConfig: () => ai.configStore.getPublicConfig(),
      updateConfig: (input) => ai.configStore.updateConfig(input),
      getStatus: () => ai.service.getStatus(),
      listModels: (input) => ai.service.listModels(input),
      test: () => ai.service.testConfiguration(),
      testProvider: (provider) => ai.service.testProvider(provider)
    },
    games: createGamesContext(games),
    settings: {
      defaults: settings.defaults,
      get: settings.store.getSettings,
      set: settings.store.setSetting
    },
    system: {
      getHealth: () => ({
        serviceId: lifecycle.SERVICE_ID,
        rootDir: system.rootDir,
        dataDir: system.dataDir,
        songDb: system.songDbPath,
        superChatDb: system.superChatDbPath,
        giftDb: system.giftDbPath,
        musicDb: system.musicDbPath,
        checkinDb: system.checkinDbPath,
        schemaVersions: domainServices.data.getSchemaVersions(),
        desktop: process.env.ELECTRON_DESKTOP === '1',
        pid: process.pid,
        liveStatus: system.liveStatus
      }),
      getState: system.getState,
      getMetrics: systemMetrics.getSystemMetrics,
      shutdown: system.shutdown
    },
    music: {
      registry: music.registry,
      lyrics: music.lyrics,
      getCacheStats: () => getMusicCacheStats(music.apiCacheDir, music.lyricCacheDir),
      clearCache: () => clearMusicCache(music.apiCacheDir, music.lyricCacheDir)
    }
  };
}

function createGamesContext(games = {}) {
  const service = games.service || {
    getSession: () => null,
    start: () => null,
    stop: () => null,
    move: () => ({ accepted: false, reason: '小游戏服务未启用。' }),
    listViewers: () => []
  };
  const listOnlineViewers = typeof games.listOnlineViewers === 'function'
    ? games.listOnlineViewers
    : () => [];
  return {
    getSession: service.getSession,
    start: service.start,
    stop: service.stop,
    move: service.move,
    listViewers: () => mergeViewerCandidates(service.listViewers(), listOnlineViewers())
  };
}

function mergeViewerCandidates(...groups) {
  const byKey = new Map();
  for (const viewer of groups.flat()) {
    const uid = String(viewer?.uid || '').trim();
    const name = String(viewer?.name || viewer?.userName || '观众').trim() || '观众';
    const key = uid || `name:${name}`;
    const previous = byKey.get(key);
    byKey.set(key, {
      uid,
      name,
      lastSeenAt: Math.max(Number(previous?.lastSeenAt) || 0, Number(viewer?.lastSeenAt || viewer?.seenAt) || 0)
    });
  }
  return [...byKey.values()].filter(viewer => viewer.uid).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

module.exports = { createApiContext };
