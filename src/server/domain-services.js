// 编写人：Aurora
// 组装歌曲、队列、礼物和弹幕领域服务，集中管理它们需要的共享状态。
'use strict';

const database = require('../storage/database');
const retention = require('../storage/retention');
const { createPlaybackStore } = require('../storage/playback-store');
const { createThemeStore } = require('../storage/theme-store');
const { createCooldownStore } = require('../storage/cooldown-store');
const { createCheckinStore } = require('../storage/checkin-store');
const { createQueueStore } = require('../storage/queue-store');
const { createSuperChatStore } = require('../storage/superchat-store');
const { createGiftEventStore } = require('../storage/gift-event-store');
const {
  createRequesterTargetStore,
} = require('../music/requester-target-store');
const songService = require('../music/song-service');
const queueService = require('../music/queue-service');
const giftService = require('../bilibili/gift');
const superChatService = require('../bilibili/superchat-service');
const { createCheckinService } = require('../bilibili/checkin-service');
const { createFortuneService } = require('../bilibili/fortune-service');
const {
  createCustomReplyService,
} = require('../bilibili/custom-reply-service');
const bilibiliMessageHandler = require('../bilibili/bilibili-message-handler');
const {
  createOvertimeConsumer,
  createOvertimeService,
} = require('../overtime');
const {
  createGiftSaleCatalogService,
  createUnavailableGiftSaleCatalogService,
} = require('../bilibili/gift/sale-catalog');
const {
  createHybridGiftSaleCatalogService,
} = require('../bilibili/gift/hybrid-catalog');

function createDomainServices(options) {
  const {
    db,
    settingsStore,
    giftEffectResolver,
    onGiftFlushed,
    onOvertimeUpdate,
  } = options;
  const cooldownStore = createCooldownStore(db.songDb);
  const playbackStore = createPlaybackStore(db.musicDb);
  const themeStore = createThemeStore(db.songDb, settingsStore);
  const requesterTargets = createRequesterTargetStore(db.songDb);
  const checkinStore = createCheckinStore(db.checkinDb);
  const queueStore = createQueueStore(db.songDb);
  const superChatStore = createSuperChatStore(db.superChatDb);
  const giftEventStore = createGiftEventStore(db.giftDb);
  const checkins = createCheckinService({
    store: checkinStore,
    settings: () => settingsStore.getSettings(),
  });
  const fortunes = createFortuneService({
    settings: () => settingsStore.getSettings(),
  });
  const customReplies = createCustomReplyService({
    settings: () => settingsStore.getSettings(),
  });

  const state = {
    cooldownByUser: new Map(),
    blindBoxCache: null,
  };
  // schema 版本只在启动迁移时变化，运行时缓存避免每次 /api/health 重算 5 个 SELECT。
  let schemaVersionsCache = null;

  // 冷却记录重启后从 DB 恢复，避免观众靠重启绕过冷却
  const restoredCooldowns = cooldownStore.loadInto(state.cooldownByUser);
  if (restoredCooldowns > 0) {
    console.log(
      `[Startup] restored ${restoredCooldowns} user cooldown record(s).`,
    );
  }

  const baseContext = {
    db,
    settings: () => settingsStore.getSettings(),
    settingsStore,
    songService,
    cooldownStore,
    state,
  };

  const songs = {
    save: (input) => songService.saveSong(db.songDb, input),
    list: (options) => songService.listSongs(db.songDb, options),
    find: (songName, artist) =>
      songService.findSong(db.songDb, songName, artist),
    findUniqueNameMatch: (songName) =>
      songService.findUniqueSongNameMatch(db.songDb, songName),
    listCategories: () => songService.listCategories(db.songDb),
    listTags: () => songService.listTags(db.songDb),
    ensureCategory: (name) => songService.ensureCategory(db.songDb, name),
    import: (rows) => songService.importSongs(db.songDb, rows),
    // 下面三个原来在 facade 层写了内联 SQL，现统一委托给 song-service
    count: () => songService.countSongs(db.songDb),
    delete: (id) => songService.deleteSong(db.songDb, id),
    toggle: (id) => songService.toggleSong(db.songDb, id),
    // 随机选歌：供 bilibili-message-handler 通过 context 调用，屏蔽 DB 句柄
    pickRandom: (scopeText) => songService.pickRandomSong(db.songDb, scopeText),
    describeRandomScope: (scopeText) =>
      songService.describeRandomSongScope(db.songDb, scopeText),
  };

  const queueContext = {
    store: queueStore,
    settings: () => settingsStore.getSettings(),
    defaults: () => settingsStore.getDefaultSettings(),
    findSong: songs.find,
  };
  const queue = {
    getSnapshot: () => queueService.getQueueSnapshot(queueContext),
    add: (input) => queueService.addQueueItem(queueContext, input),
    handleAction: (action, id) =>
      queueService.handleQueueAction(queueContext, action, id),
    clearOnStartup: () => queueService.clearActiveQueueOnStartup(queueContext),
    ensureUnified: () => queueService.ensureUnifiedQueue(queueContext),
  };

  let overtimeGiftCatalog;
  const overtime = createOvertimeService({
    giftDb: db.giftDb,
    onUpdate: onOvertimeUpdate,
    allowedRemoteImageOrigins: () => {
      const imageBaseUrl = options.remoteGiftCatalog?.imageBaseUrl;
      return typeof imageBaseUrl === 'function' ? imageBaseUrl() : imageBaseUrl;
    },
    resolveGiftImagePath: (giftId) => {
      const snapshot = overtimeGiftCatalog?.getSnapshot?.();
      const id = String(giftId || '').trim();
      return (
        snapshot?.gifts?.find((gift) => String(gift?.id || '').trim() === id)
          ?.imagePath || ''
      );
    },
  });
  const localOvertimeGiftCatalog =
    options.dataDir && options.publicDir
      ? createGiftSaleCatalogService({
          dataDir: options.dataDir,
          publicDir: options.publicDir,
          getRoomId:
            options.giftSaleGetRoomId ||
            (() => settingsStore.getSettings().roomId),
          getBlindBoxConfig:
            options.giftSaleGetBlindBoxConfig ||
            (() => settingsStore.getSettings().giftBlindBoxConfig),
          getCookieHeader: options.giftSaleGetCookieHeader,
          fetchJson: options.giftSaleFetchJson,
        })
      : createUnavailableGiftSaleCatalogService();
  overtimeGiftCatalog =
    typeof options.remoteGiftCatalog?.fetch === 'function' && options.dataDir
      ? createHybridGiftSaleCatalogService({
          local: localOvertimeGiftCatalog,
          dataDir: options.dataDir,
          fetchRemote: options.remoteGiftCatalog.fetch,
          onUpdated: options.remoteGiftCatalog.onUpdated,
          now: options.remoteGiftCatalog.now,
          logger: options.remoteGiftCatalog.logger,
          minRefreshMs: options.remoteGiftCatalog.minRefreshMs,
          pollIntervalMs: options.remoteGiftCatalog.pollIntervalMs,
          imageBaseUrl: options.remoteGiftCatalog.imageBaseUrl,
          remoteCatalog: options.remoteGiftCatalog.remoteCatalog,
        })
      : localOvertimeGiftCatalog;
  const overtimeConsumer = createOvertimeConsumer({ service: overtime });
  const giftRuntime = giftService.createGiftService(baseContext, {
    onGiftFlushed,
    consumers: [overtimeConsumer],
    giftEventStore,
    getOvertimeEpoch: overtime.getCurrentEpoch,
    captureWhenDisabled: Boolean(giftEffectResolver),
  });
  const gifts = {
    ...giftRuntime,
    async resolveEffect(giftId) {
      if (!giftEffectResolver) return null;
      return giftEffectResolver.resolveEffect(giftId);
    },
  };

  const superChatContext = { store: superChatStore };
  const superChats = {
    getSnapshot: () => superChatService.getSuperChatSnapshot(superChatContext),
    add: (input) => superChatService.addSuperChatItem(superChatContext, input),
    handleAction: (action, id) =>
      superChatService.handleSuperChatAction(superChatContext, action, id),
  };

  const messages = {
    handleDanmaku(danmaku) {
      const result = bilibiliMessageHandler.handleDanmakuMessage(
        {
          ...baseContext,
          addQueueItem: queue.add,
          resolveSongRequest: songs.findUniqueNameMatch,
          // 通过 songs.pickRandom 传入，让 message-handler 无需直接访问 DB 句柄
          pickRandomSong: songs.pickRandom,
          describeRandomSongScope: songs.describeRandomScope,
        },
        danmaku,
      );
      const checkin = checkins.handleDanmaku(danmaku);
      if (checkin.command) {
        return {
          ...result,
          checkin,
          checkinReply: checkin.autoReply || null,
        };
      }
      const fortune = fortunes.handleDanmaku(danmaku);
      if (fortune.command) {
        return {
          ...result,
          fortune,
          fortuneReply: fortune.autoReply || null,
        };
      }
      if (result.command) return result;
      const customReply = customReplies.handleDanmaku(danmaku);
      if (!customReply.command) return result;
      return {
        ...result,
        customReply,
        customReplyReply: customReply.autoReply || null,
      };
    },
    logDanmaku: bilibiliMessageHandler.logDanmakuCommand,
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
      state.blindBoxCache = null;
      return result;
    },
    clearAll() {
      const result = database.clearAllData(
        db.songDb,
        db.superChatDb,
        db.giftDb,
        db.musicDb,
        db.checkinDb,
      );

      // 只有完全成功时才重置内存状态
      if (result.cleared === true && !result.partial) {
        state.cooldownByUser.clear();
        state.blindBoxCache = null;
        songs.ensureCategory('默认');
        queue.ensureUnified();
      }

      return result;
    },
    getSchemaVersions: () => {
      if (!schemaVersionsCache)
        schemaVersionsCache = database.getSchemaVersions(db);
      return schemaVersionsCache;
    },
    getRetentionStats: () => retention.getRetentionStats(db),
    runRetention(options = {}) {
      const policy =
        options.policy ||
        retention.readRetentionPolicy(settingsStore.getSettings());
      return retention.applyRetentionPolicies(db, {
        policy,
        dryRun: options.dryRun === true,
      });
    },
  };

  return {
    state,
    songs,
    queue,
    gifts,
    overtime,
    overtimeGiftCatalog,
    superChats,
    messages,
    requesterTargets,
    checkins,
    fortunes,
    customReplies,
    data,
    playback: playbackStore,
    theme: themeStore,
    cooldowns: cooldownStore,
  };
}

module.exports = { createDomainServices };
