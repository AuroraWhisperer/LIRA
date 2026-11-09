// 编写人：Aurora
// 组装歌曲、队列、礼物和弹幕领域服务，集中管理它们需要的共享状态。
'use strict';

const { createMessageApplication } = require('./message-application');
const { createDataMaintenanceRuntime } = require('./data-maintenance-runtime');
const { createPlaybackStore } = require('../storage/playback-store');
const { createThemeStore } = require('../storage/theme-store');
const { createCooldownStore } = require('../storage/cooldown-store');
const { createUserRequestCooldown } = require('../music/user-request-cooldown');
const { createDailyBotLegacyReader } = require('../storage/daily-bot-legacy-reader');
const { createQueueStore } = require('../storage/queue-store');
const { createFanProfileStore } = require('../storage/fan-profile-store');
const { createFanProfileService } = require('../fans/profile-service');
const { createSuperChatStore } = require('../storage/superchat-store');
const { createSongStore } = require('../storage/song-store');
const { createCloudSongSyncStore } = require('../storage/cloud-song-sync-store');
const { createGiftQueryStore } = require('../storage/gift-query-store');
const { createGiftMaintenanceStore } = require('../storage/gift-maintenance-store');
const { createGiftProjectionStore } = require('../storage/gift-projection-store');
const { createGiftStatisticsStore } = require('../storage/gift-statistics-store');
const { createOvertimeStore } = require('../storage/overtime-store');
const { createRequesterTargetStore } = require('../storage/requester-target-store');
const songService = require('../music/song-service');
const { createSongMetadataReader } = require('../music/song-metadata');
const { previewSongImport, applySongImport } = require('../music/song-import-update');
const queueService = require('../music/queue-service');
const giftService = require('../bilibili/gift');
const { createGiftWishService } = require('../bilibili/gift/wish-service');
const { createHeartBoxCollectionService } = require('../bilibili/gift/heart-box-collection');
const { createGiftWishStore } = require('../storage/gift-wish-store');
const superChatService = require('../bilibili/superchat-service');
const { createSuperChatUndo } = require('../bilibili/superchat-undo');
const { createCustomReplyService } = require('../bilibili/custom-reply-service');
const { createOvertimeConsumer, createOvertimeService } = require('../overtime');
const {
  createGiftSaleCatalogService,
  createUnavailableGiftSaleCatalogService,
} = require('../bilibili/gift/sale-catalog');
const { createHybridGiftSaleCatalogService } = require('../bilibili/gift/hybrid-catalog');

function createDomainServices(options) {
  const { db, settingsStore, giftEffectResolver, onGiftFlushed, onOvertimeUpdate } = options;
  const songStore = createSongStore(db.songDb);
  const cloudSongSync = createCloudSongSyncStore(db.songDb);
  const cooldownStore = createCooldownStore(db.songDb);
  const userRequestCooldown = createUserRequestCooldown(cooldownStore);
  const playbackStore = createPlaybackStore(db.musicDb);
  const themeStore = createThemeStore(db.songDb, settingsStore);
  const requesterTargets = createRequesterTargetStore(db.songDb);
  const dailyBotLegacy = createDailyBotLegacyReader(db.checkinDb, settingsStore);
  const fans = createFanProfileService({ store: createFanProfileStore(db.songDb) });
  const queueStore = createQueueStore(db.songDb, {
    getFanScope: options.getFanScope,
    archiveAccepted: fans.archiveAccepted,
  });
  const superChatStore = createSuperChatStore(db.superChatDb);
  const customReplies = createCustomReplyService({
    settings: () => settingsStore.getSettings(['enableCustomReplyBot', 'customReplyRules']),
  });

  // 冷却记录重启后从 DB 恢复，避免观众靠重启绕过冷却
  const restoredCooldowns = userRequestCooldown.restore();
  if (restoredCooldowns > 0) {
    console.log(`[Startup] restored ${restoredCooldowns} user cooldown record(s).`);
  }

  const songs = {
    hasPendingCloudSongs: cloudSongSync.hasPending,
    getPendingCloudSongs: cloudSongSync.readPending,
    acknowledgePendingCloudSongs: cloudSongSync.acknowledge,
    assertCloudSongAccount: cloudSongSync.assertAccount,
    acceptCloudSongAccount: cloudSongSync.acceptAccount,
    getMetadata: createSongMetadataReader(songStore),
    getChangeToken: songStore.getChangeToken,
    save: (input) => songService.saveSong(songStore, input),
    list: (options) => songService.listSongs(songStore, options),
    find: (songName, artist) => songService.findSong(songStore, songName, artist),
    findUniqueNameMatch: (songName) => songService.findUniqueSongNameMatch(
      songStore, songName, settingsStore.getSettings().songRequestMatchMode,
    ),
    listCategories: () => songService.listCategories(songStore),
    listTags: () => songService.listTags(songStore),
    ensureCategory: (name) => songService.ensureCategory(songStore, name),
    import: (rows) => songService.importSongs(songStore, rows),
    previewImport: (input) => previewSongImport(songStore, input),
    applyImport: (input) => applySongImport(songStore, input),
    replaceCloud: (rows, accountKey) => songService.replaceCloudSongs(songStore, rows, accountKey),
    count: () => songService.countSongs(songStore),
    delete: (id) => songService.deleteSong(songStore, id),
    toggle: (id) => songService.toggleSong(songStore, id),
    pickRandom: (scopeText) => songService.pickRandomSong(songStore, scopeText,
      (candidates) => queueService.filterSongsByCooldown(queueContext, candidates)),
  };

  const queueContext = {
    store: queueStore,
    settings: () => settingsStore.getSettings(),
    defaults: () => settingsStore.getDefaultSettings(),
    findSong: songs.find,
  };
  const queue = {
    getSnapshot: () => queueService.getQueueSnapshot(queueContext),
    recordRequestResult: (input) => queueService.recordQueueRequestResult(queueContext, input),
    add: (input) => queueService.addQueueItem(queueContext, input),
    cancel: (input) => queueService.cancelQueueItem(queueContext, input),
    handleAction: (action, id) => queueService.handleQueueAction(queueContext, action, id),
    ensureUnified: () => queueService.ensureUnifiedQueue(queueContext),
  };

  let overtimeGiftCatalog;
  const overtime = createOvertimeService({
    store: createOvertimeStore(db.giftDb),
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
  let localOvertimeGiftCatalog;
  let giftRuntime;
  try {
    localOvertimeGiftCatalog = options.dataDir
      ? createGiftSaleCatalogService({
          dataDir: options.dataDir,
          getRoomId: options.giftSaleGetRoomId || (() => settingsStore.getSettings().roomId),
          getBlindBoxConfig:
            options.giftSaleGetBlindBoxConfig || (() => settingsStore.getSettings().giftBlindBoxConfig),
          fetchJson: options.giftSaleFetchJson,
        })
      : createUnavailableGiftSaleCatalogService();
    overtimeGiftCatalog =
      typeof options.remoteGiftCatalog?.fetch === 'function' && options.dataDir
        ? createHybridGiftSaleCatalogService({
            local: localOvertimeGiftCatalog,
            visitAssetReferences: options.visitAssetReferences,
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
                const value = JSON.parse(settingsStore.getSettings().giftBlindBoxCustomConfigV2 || 'null');
                return Array.isArray(value) ? value : [];
              } catch (_) {
                return [];
              }
            },
            remoteCatalog: options.remoteGiftCatalog.remoteCatalog,
            remoteImageCache: options.remoteGiftCatalog.remoteImageCache,
            giftCatalogInitializer: options.remoteGiftCatalog.giftCatalogInitializer,
            fetchImage: options.remoteGiftCatalog.fetchImage,
            imageConcurrency: options.remoteGiftCatalog.imageConcurrency,
          })
        : localOvertimeGiftCatalog;
    const overtimeConsumer = createOvertimeConsumer({ service: overtime });
    giftRuntime = giftService.createGiftService(
      {
        queryStore: createGiftQueryStore(db.giftDb),
        maintenanceStore: createGiftMaintenanceStore(db.giftDb),
        projectionStore: createGiftProjectionStore(db.giftDb),
        statisticsStore: createGiftStatisticsStore(db.giftDb),
        settings: () => settingsStore.getSettings(),
      },
      {
        onGiftFlushed,
        consumers: [overtimeConsumer],
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

    const giftWishStore = createGiftWishStore(db.giftDb);
    const heartBoxCollection = createHeartBoxCollectionService({ store: giftWishStore, gifts, catalog: overtimeGiftCatalog });
    const giftWishes = createGiftWishService({
      store: giftWishStore,
      gifts,
      catalog: overtimeGiftCatalog,
      getRoomId: options.giftSaleGetRoomId || (() => settingsStore.getSettings().roomId),
    });

    const superChatContext = { store: superChatStore };
    const superChatUndo = createSuperChatUndo({ store: superChatStore,
      getScope: () => JSON.stringify([options.getSceneOwner?.(), settingsStore.getSettings().roomId]) });
    const superChats = {
      getSnapshot: () => superChatService.getSuperChatSnapshot(superChatContext),
      add: (input) => superChatService.addSuperChatItem(superChatContext, input),
      retract(platformIds) {
        const result = superChatService.retractSuperChatItems(superChatContext, platformIds);
        if (Array.isArray(platformIds)) superChatUndo.retract(platformIds);
        return result;
      },
      handleAction: (action, id) => superChatService.handleSuperChatAction(superChatContext, action, id),
      deleteWithUndo: superChatUndo.remove,
      undoDelete: superChatUndo.restore,
      dispose: superChatUndo.clear,
    };

    const messages = createMessageApplication({
      getSettings: () => settingsStore.getSettings(),
      getDefaultSettings: () => settingsStore.getDefaultSettings(),
      userRequestCooldown,
      addQueueItem: input => queue.add(input),
      cancelQueueItem: input => queue.cancel(input),
      resolveSongRequest: name => songs.findUniqueNameMatch(name),
      pickRandomSong: scope => songs.pickRandom(scope),
      recordRequestResult: input => queue.recordRequestResult(input),
      customReplies,
    });
    const data = createDataMaintenanceRuntime({
      db,
      getSettings: () => settingsStore.getSettings(),
      ensureSongCategory: name => songs.ensureCategory(name),
      ensureUnifiedQueue: () => queue.ensureUnified(),
      clearSuperChatUndo: () => superChatUndo.clear(),
      getActiveGiftSource: () => gifts.getActiveSource?.(),
      reloadOvertimeState: () => overtime.reloadState(),
      resetUserCooldowns: () => userRequestCooldown.reset(),
    });

    return {
      songs,
      queue,
      fans,
      gifts,
      giftWishes,
      heartBoxCollection,
      overtime,
      overtimeGiftCatalog,
      superChats,
      messages,
      requesterTargets,
      dailyBotLegacy,
      customReplies,
      data,
      playback: playbackStore,
      theme: themeStore,
      cooldowns: cooldownStore,
    };
  } catch (error) {
    // Factories retain ownership until the complete service bundle is returned.
    for (const [name, cleanup] of [
      ['gifts', () => giftRuntime?.dispose()],
      ['gift catalog', () => overtimeGiftCatalog?.dispose?.()],
      ['local gift catalog', () => localOvertimeGiftCatalog?.stop?.()],
      ['overtime', () => overtime.dispose()],
    ]) {
      try {
        cleanup();
      } catch (cleanupError) {
        console.warn(`[Startup] ${name} cleanup failed:`, cleanupError.message);
      }
    }
    throw error;
  }
}


module.exports = { createDomainServices };
