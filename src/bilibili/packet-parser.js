'use strict';

// ---------------------------------------------------------------------------
// Facade module - re-exports from specialized modules
// Maintains backward compatibility while using modular structure
// ---------------------------------------------------------------------------

// Packet decoding
const { parseBilibiliPackets } = require('./parsers/packet-decoder');

// Danmaku parsing
const { extractBilibiliDanmakuTimestamp } = require('./parsers/danmaku-parser');

// User metadata extraction
const {
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliOnlineRankUserMeta
} = require('./utils/user-meta-extractor');

// SuperChat parsing
const { extractBilibiliSuperChatMessage } = require('./parsers/superchat-parser');

// Gift parsing
const {
  extractBilibiliGiftMessage,
  extractBilibiliGiftV2Message,
  extractBilibiliOpenLiveGiftMessage,
  extractBilibiliOpenLiveGuardGiftMessage,
  extractBilibiliWebGiftMessage,
  extractBilibiliWebGuardGiftMessage,
  isBilibiliGiftCommand,
  isBilibiliGiftLikeCommand
} = require('./parsers/gift-parser');

// Protocol Buffer decoding
const {
  readBilibiliProtoVarint,
  decodeBilibiliGiftV2Proto
} = require('./protocols/protobuf-decoder');

// ---------------------------------------------------------------------------
// Exports (maintains original API)
// ---------------------------------------------------------------------------

module.exports = {
  parseBilibiliPackets,
  extractBilibiliDanmakuTimestamp,
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliSuperChatMessage,
  extractBilibiliGiftMessage,
  extractBilibiliGiftV2Message,
  extractBilibiliOpenLiveGiftMessage,
  extractBilibiliOpenLiveGuardGiftMessage,
  extractBilibiliWebGiftMessage,
  extractBilibiliWebGuardGiftMessage,
  extractBilibiliOnlineRankUserMeta,
  isBilibiliGiftCommand,
  isBilibiliGiftLikeCommand,
  readBilibiliProtoVarint,
  decodeBilibiliGiftV2Proto
};
