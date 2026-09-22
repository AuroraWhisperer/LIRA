'use strict';

// ---------------------------------------------------------------------------
// Facade module - re-exports from specialized modules
// Maintains backward compatibility while using modular structure
// ---------------------------------------------------------------------------

// Packet decoding
const { parseBilibiliPackets } = require('./parsers/packet-decoder');

// Danmaku parsing
const {
  extractBilibiliDanmakuTimestamp,
  extractBilibiliDanmakuAvatarUrl,
  extractBilibiliDanmakuEmotes,
} = require('./parsers/danmaku-parser');

// User metadata extraction
const {
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliOnlineRankUserMeta,
} = require('./utils/user-meta-extractor');

// SuperChat parsing
const { extractBilibiliSuperChatMessage } = require('./parsers/superchat-parser');

// Gift command routing for identity hints and explicit capture diagnostics.
const { isBilibiliGiftCommand, isBilibiliGiftLikeCommand } = require('./parsers/gift-command-utils');

// ---------------------------------------------------------------------------
// Packet, message and identity helpers.
// ---------------------------------------------------------------------------

module.exports = {
  parseBilibiliPackets,
  extractBilibiliDanmakuTimestamp,
  extractBilibiliDanmakuAvatarUrl,
  extractBilibiliDanmakuEmotes,
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliSuperChatMessage,
  extractBilibiliOnlineRankUserMeta,
  isBilibiliGiftCommand,
  isBilibiliGiftLikeCommand,
};
