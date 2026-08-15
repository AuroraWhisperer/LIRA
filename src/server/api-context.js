'use strict';

const { clearMusicCache, getMusicCacheStats } = require('../music/music-cache');
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
    settings,
    system,
    music
  } = options;

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
      replaceRules: domainServices.overtime.replaceRules
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

module.exports = { createApiContext };
