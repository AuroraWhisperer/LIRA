'use strict';

const {
  cleanText,
  normalizeTimestampMs,
  normalizeGuardLevel,
  normalizeSuperChatPrice,
  readObjectValue
} = require('../../shared/utils');
const { readMedalName, readMedalLevel } = require('../utils/user-meta-extractor');

// ---------------------------------------------------------------------------
// SuperChat message parsing utilities
// ---------------------------------------------------------------------------

function extractBilibiliSuperChatMessage(packet) {
  const data = packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  const userInfo = data.user_info || data.userInfo || {};
  const medalInfo = data.medal_info || data.medalInfo || userInfo.medal_info || userInfo.medalInfo;
  const messageTimestamp = normalizeTimestampMs(
    readObjectValue(data, ['start_time', 'startTime', 'ts', 'time', 'timestamp'])
  ) || Date.now();

  return {
    id: cleanText(readObjectValue(data, ['id', 'message_id', 'messageId', 'token'])),
    message: cleanText(readObjectValue(data, ['message', 'message_trans', 'messageTrans'])),
    price: normalizeSuperChatPrice(readObjectValue(data, ['price', 'rmb', 'price_text', 'priceText'])),
    uid: cleanText(readObjectValue(data, ['uid', 'mid']) || readObjectValue(userInfo, ['uid', 'mid'])),
    userName: cleanText(
      readObjectValue(userInfo, ['uname', 'name', 'user_name', 'userName'])
      || readObjectValue(data, ['uname', 'name', 'nickname'])
    ) || '观众',
    guardLevel: normalizeGuardLevel(
      readObjectValue(medalInfo, ['guard_level', 'guardLevel'])
      || readObjectValue(userInfo, ['guard_level', 'guardLevel'])
      || readObjectValue(data, ['guard_level', 'guardLevel'])
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo),
    messageTimestamp
  };
}

module.exports = {
  extractBilibiliSuperChatMessage
};
