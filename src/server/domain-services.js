// 编写人：Aurora
// 组装歌曲、队列、礼物和弹幕领域服务，集中管理它们需要的共享状态。
'use strict';

const database = require('../storage/database');
const songService = require('../music/song-service');
const queueService = require('../music/queue-service');
const giftService = require('../bilibili/gift-service');
const superChatService = require('../bilibili/superchat-service');
const bilibiliMessageHandler = require('../bilibili/bilibili-message-handler');
const { now } = require('../shared/utils');

function createDomainServices({ db, settingsStore }) {
  const state = {
    cooldownByUser: new Map(),
    giftBotPendingByName: new Map(),
    giftBotLastReportByName: new Map()
  };

  const baseContext = {
    db,
    settings: () => settingsStore.getSettings(),
    settingsStore,
    songService,
    state
  };

  const songs = {
    save: (input) => songService.saveSong(db.songDb, input),
    list: (options) => songService.listSongs(db.songDb, options),
    find: (songName, artist) => songService.findSong(db.songDb, songName, artist),
    listCategories: () => songService.listCategories(db.songDb),
    ensureCategory: (name) => songService.ensureCategory(db.songDb, name),
    import: (rows) => songService.importSongs(db.songDb, rows),
    count: () => db.songDb.prepare('SELECT COUNT(*) AS count FROM songs').get().count,
    delete(id) {
      db.songDb.prepare('DELETE FROM songs WHERE id = ?').run(id);
    },
    toggle(id) {
      const song = db.songDb.prepare('SELECT is_enabled FROM songs WHERE id = ?').get(id);
      if (!song) return { ok: false };
      db.songDb.prepare('UPDATE songs SET is_enabled = ?, updated_at = ? WHERE id = ?')
        .run(song.is_enabled ? 0 : 1, now(), id);
      return { ok: true };
    }
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
    getSprintSnapshot: () => giftService.getGiftSprintSnapshot(giftContext),
    add: (input) => giftService.addGiftEvent(giftContext, input),
    handleBotDanmaku: (danmaku) => giftService.handleGiftBotDanmaku(giftContext, danmaku),
    resetSprint: () => giftService.resetGiftSprintProgress(giftContext)
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
        addQueueItem: queue.add
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
    clearAll() {
      const result = database.clearAllData(db.songDb, db.superChatDb, db.giftDb);
      songs.ensureCategory('默认');
      return result;
    }
  };

  return {
    state,
    songs,
    queue,
    gifts,
    superChats,
    messages,
    data
  };
}

module.exports = { createDomainServices };
