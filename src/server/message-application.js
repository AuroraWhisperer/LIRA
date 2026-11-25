'use strict';

const { dailyBotCommand } = require('../bilibili/danmaku/command-text');
const { toSimplifiedChinese } = require('../shared/chinese-text');
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

  function handleDanmaku(danmaku, simplified = toSimplifiedChinese(String(danmaku.message || '').trim())) {
    const reserved = dailyBotCommand(danmaku.message, simplified);
    if (reserved) return { accepted: false, reason: 'cloud-owned', command: { type: reserved } };
    const result = handleDanmakuMessage(songRequests, danmaku, simplified);
    if (result.command?.type === 'request' || result.command?.type === 'random') {
      recordRequestResult({ accepted: result.accepted, requesterName: danmaku.userName,
        songName: result.queueItem?.song_name || result.command.songName, reason: result.reason });
    }
    if (result.command) return result;
    if (customReplies.isCloudOwnedCommand(danmaku.message, simplified)) {
      return { accepted: false, reason: 'cloud-owned', command: { type: 'custom-exact-reply' } };
    }
    const customReply = customReplies.handleDanmaku(danmaku, simplified);
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
