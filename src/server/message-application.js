'use strict';

const { dailyBotCommand } = require('../bilibili/danmaku/command-text');
const { handleDanmakuMessage, logDanmakuCommand } = require('../bilibili/bilibili-message-handler');

function createMessageApplication({ getSettings, getDefaultSettings, userRequestCooldown,
  addQueueItem, cancelQueueItem, resolveSongRequest, pickRandomSong,
  recordRequestResult, customReplies }) {
  const songRequests = {
    settings: getSettings,
    settingsStore: { getDefaultSettings },
    userRequestCooldown,
    addQueueItem,
    cancelQueueItem,
    resolveSongRequest,
    pickRandomSong,
  };

  function handleDanmaku(danmaku) {
    const reserved = dailyBotCommand(danmaku.message);
    if (reserved) return { accepted: false, reason: 'cloud-owned', command: { type: reserved } };
    const result = handleDanmakuMessage(songRequests, danmaku);
    if (result.command?.type === 'request' || result.command?.type === 'random') {
      recordRequestResult({ accepted: result.accepted, requesterName: danmaku.userName,
        songName: result.queueItem?.song_name || result.command.songName });
    }
    if (result.command) return result;
    if (customReplies.isCloudOwnedCommand(danmaku.message)) {
      return { accepted: false, reason: 'cloud-owned', command: { type: 'custom-exact-reply' } };
    }
    const customReply = customReplies.handleDanmaku(danmaku);
    if (!customReply.command) return result;
    return {
      ...result,
      customReply,
      customReplyReply: customReply.autoReply || null,
    };
  }

  return { handleDanmaku, logDanmaku: logDanmakuCommand };
}

module.exports = { createMessageApplication };
