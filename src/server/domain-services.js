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
const { createSongStore } = require('../storage/song-store');
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
  const songStore = createSongStore(db.songDb);
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
  };
  const giftState = { blindBoxCache: null };
  // schema 版本只在启动迁移时变化，运行时缓存避免每次 /api/health 重算 5 个 SELECT。
  let schemaVersionsCache = null;

  // 冷却记录重启后从 DB 恢复，避免观众靠重启绕过冷却
  const restoredCooldowns = cooldownStore.loadInto(state.cooldownByUser);
  if (restoredCooldowns > 0) {
    console.log(
      `[Startup] restored ${restoredCooldowns} user cooldown record(s).`,
    );
  }

  const songs = {
    save: (input) => songService.saveSong(songStore, input),
    list: (options) => songService.listSongs(songStore, options),
    find: (songName, artist) =>
      songService.findSong(songStore, songName, artist),
    findUniqueNameMatch: (songName) =>
      songService.findUniqueSongNameMatch(songStore, songName),
    listCategories: () => songService.listCategories(songStore),
    listTags: () => songService.listTags(songStore),
    ensureCategory: (name) => songService.ensureCategory(songStore, name),
    import: (rows) => songService.importSongs(songStore, rows),
    replaceCloud: (rows) => songService.replaceCloudSongs(songStore, rows),
    count: () => songService.countSongs(songStore),
    delete: (id) => songService.deleteSong(songStore, id),
    toggle: (id) => songService.toggleSong(songStore, id),
    pickRandom: (scopeText) => songService.pickRandomSong(songStore, scopeText),
    describeRandomScope: (scopeText) =>
      songService.describeRandomSongScope(songStore, scopeText),
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
      const id = String(giftId || '').trim();
      return overtimeGiftCatalog?.resolveGiftImagePath?.(id) || '';
    },
  });
  const localOvertimeGiftCatalog =
    options.dataDir
      ? createGiftSaleCatalogService({
          dataDir: options.dataDir,
          getRoomId:
            options.giftSaleGetRoomId ||
            (() => settingsStore.getSettings().roomId),
          getBlindBoxConfig:
            options.giftSaleGetBlindBoxConfig ||
            (() => settingsStore.getSettings().giftBlindBoxConfig),
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
          getBlindBoxCustomConfigV2: () => {
            try {
              const value = JSON.parse(
                settingsStore.getSettings().giftBlindBoxCustomConfigV2 || 'null',
              );
              return Array.isArray(value) ? value : [];
            } catch (_) {
              return [];
            }
          },
          remoteCatalog: options.remoteGiftCatalog.remoteCatalog,
          remoteImageCache: options.remoteGiftCatalog.remoteImageCache,
          giftCatalogInitializer:
            options.remoteGiftCatalog.giftCatalogInitializer,
          fetchImage: options.remoteGiftCatalog.fetchImage,
          imageConcurrency: options.remoteGiftCatalog.imageConcurrency,
        })
      : localOvertimeGiftCatalog;
  const overtimeConsumer = createOvertimeConsumer({ service: overtime });
  const giftRuntime = giftService.createGiftService(
    {
      db: { giftDb: db.giftDb },
      settings: () => settingsStore.getSettings(),
      state: giftState,
    },
    {
      onGiftFlushed,
      consumers: [overtimeConsumer],
      giftEventStore,
      getOvertimeEpoch: overtime.getCurrentEpoch,
      captureWhenDisabled: Boolean(giftEffectResolver),
    },
  );
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
          settings: () => settingsStore.getSettings(),
          // message-handler still reads this legacy-shaped adapter; it only
          // exposes the defaults query rather than the full settings store.
          settingsStore: {
            getDefaultSettings: () => settingsStore.getDefaultSettings(),
          },
          cooldownStore,
          state,
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
      const result = database.clearGiftData(db.giftDb, {
        sourceId: getActiveGiftSourceId(gifts),
      });
      giftState.blindBoxCache = null;
      return result;
    },
    clearAll() {
      const result = database.clearAllData(
        db.songDb,
        db.superChatDb,
        db.giftDb,
        db.musicDb,
        db.checkinDb,
        { sourceId: getActiveGiftSourceId(gifts) },
      );

      // 只有完全成功时才重置内存状态
      if (result.cleared === true && !result.partial) {
        state.cooldownByUser.clear();
        giftState.blindBoxCache = null;
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

function getActiveGiftSourceId(gifts) {
  const source = gifts.getActiveSource?.();
  if (source?.syncState === 'SOURCE_SWITCHING') return null;
  const sourceId = Number(source?.sourceId);
  return Number.isSafeInteger(sourceId) && sourceId >= 1 ? sourceId : null;
}

module.exports = { createDomainServices };
