// 编写人：Aurora
// 组装歌曲、队列、礼物和弹幕领域服务，集中管理它们需要的共享状态。
'use strict';

const database = require('../storage/database');
const retention = require('../storage/retention');
const { createPlaybackStore } = require('../storage/playback-store');
const { createThemeStore } = require('../storage/theme-store');
const { createCooldownStore } = require('../storage/cooldown-store');
const songService = require('../music/song-service');
const queueService = require('../music/queue-service');
const giftService = require('../bilibili/gift-service');
const superChatService = require('../bilibili/superchat-service');
const bilibiliMessageHandler = require('../bilibili/bilibili-message-handler');

function createDomainServices({ db, settingsStore }) {
  const cooldownStore = createCooldownStore(db.songDb);
  const playbackStore = createPlaybackStore(db.musicDb);
  const themeStore = createThemeStore(db.songDb, settingsStore);

  const state = {
    cooldownByUser: new Map(),
    giftBotPendingByName: new Map(),
    giftBotLastReportByName: new Map(),
    giftComboPending: new Map(),
    blindBoxCache: null
  };

  // 冷却记录重启后从 DB 恢复，避免观众靠重启绕过冷却
  const restoredCooldowns = cooldownStore.loadInto(state.cooldownByUser);
  if (restoredCooldowns > 0) {
    console.log(`[Startup] restored ${restoredCooldowns} user cooldown record(s).`);
  }

  const baseContext = {
    db,
    settings: () => settingsStore.getSettings(),
    settingsStore,
    songService,
    cooldownStore,
    state
  };

  const songs = {
    save:           (input) => songService.saveSong(db.songDb, input),
    list:           (options) => songService.listSongs(db.songDb, options),
    find:           (songName, artist) => songService.findSong(db.songDb, songName, artist),
    listCategories: () => songService.listCategories(db.songDb),
    ensureCategory: (name) => songService.ensureCategory(db.songDb, name),
    import:         (rows) => songService.importSongs(db.songDb, rows),
    // 下面三个原来在 facade 层写了内联 SQL，现统一委托给 song-service
    count:  () => songService.countSongs(db.songDb),
    delete: (id) => songService.deleteSong(db.songDb, id),
    toggle: (id) => songService.toggleSong(db.songDb, id),
    // 随机选歌：供 bilibili-message-handler 通过 context 调用，屏蔽 DB 句柄
    pickRandom: (scopeText) => songService.pickRandomSong(db.songDb, scopeText)
  };

  const queueContext = {
    ...baseContext,
    findSong: songs.find
  };
  const queue = {
    getSnapshot: () => queueService.getQueueSnapshot(queueContext),
    add: (input) => queueService.addQueueItem(queueContext, input),
    handleAction: (action, id) => queueService.handleQueueAction(queueContext, action, id),
    clearOnStartup: () => queueService.clearActiveQueueOnStartup(queueContext),
    ensureUnified: () => queueService.ensureUnifiedQueue(queueContext)
  };

  const giftContext = baseContext;
  const gifts = {
    getSnapshot: () => giftService.getGiftSnapshot(giftContext),
    getHistory: (options) => giftService.getGiftHistory(giftContext, options),
    getSprintSnapshot: () => giftService.getGiftSprintSnapshot(giftContext),
    getBlindBoxStats: () => giftService.getBlindBoxStats(giftContext),
    add: (input) => giftService.addGiftEvent(giftContext, input),
    handleBotDanmaku: (danmaku) => giftService.handleGiftBotDanmaku(giftContext, danmaku),
    resetSprint: () => giftService.resetGiftSprintProgress(giftContext),
    search: (opts) => giftService.searchGifts(giftContext, opts || {})
  };

  const superChats = {
    getSnapshot: () => superChatService.getSuperChatSnapshot(baseContext),
    add: (input) => superChatService.addSuperChatItem(baseContext, input),
    handleAction: (action, id) => superChatService.handleSuperChatAction(baseContext, action, id)
  };

  const messages = {
    handleDanmaku(danmaku) {
      return bilibiliMessageHandler.handleDanmakuMessage({
        ...baseContext,
        addQueueItem: queue.add,
        // 通过 songs.pickRandom 传入，让 message-handler 无需直接访问 DB 句柄
        pickRandomSong: songs.pickRandom
      }, danmaku);
    },
    logDanmaku: bilibiliMessageHandler.logDanmakuCommand
  };

  const data = {
    clearSongLibrary() {
      const result = database.clearSongLibraryData(db.songDb);
      songs.ensureCategory('默认');
      queue.ensureUnified();
      return result;
    },
    clearSuperChats: () => database.clearSuperChatData(db.superChatDb),
    clearPlayback: () => database.clearPlaybackData(db.musicDb),
    clearGifts() {
      const result = database.clearGiftData(db.giftDb);
      state.giftBotPendingByName.clear();
      state.giftBotLastReportByName.clear();
      state.giftComboPending.clear();
      state.blindBoxCache = null;
      return result;
    },
    clearAll() {
      const result = database.clearAllData(db.songDb, db.superChatDb, db.giftDb, db.musicDb);
      state.cooldownByUser.clear();
      songs.ensureCategory('默认');
      return result;
    },
    getSchemaVersions: () => database.getSchemaVersions(db),
    getRetentionStats: () => retention.getRetentionStats(db),
    runRetention(options = {}) {
      const policy = options.policy || retention.readRetentionPolicy(settingsStore.getSettings());
      return retention.applyRetentionPolicies(db, { policy, dryRun: options.dryRun === true });
    }
  };

  return {
    state,
    songs,
    queue,
    gifts,
    superChats,
    messages,
    data,
    playback: playbackStore,
    theme: themeStore,
    cooldowns: cooldownStore
  };
}

module.exports = { createDomainServices };
