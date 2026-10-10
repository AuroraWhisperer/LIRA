'use strict';

const {
  cleanText,
  normalizeTimestampMs,
  readObjectValue,
} = require('../../shared/utils');
const { normalizeGuardLevel, normalizeSuperChatPrice } = require('../../shared/bilibili-value-contract');
const {
  readMedalName,
  readMedalLevel,
  readMedalTargetId,
  selectCurrentRoomMedalInfo,
} = require('../utils/user-meta-extractor');
const { normalizeBilibiliAvatarUrl } = require('./danmaku-parser');

// ---------------------------------------------------------------------------
// SuperChat message parsing utilities
// ---------------------------------------------------------------------------

function extractBilibiliSuperChatMessage(packet, roomOwnerUid = '') {
  const data = packet && packet.data && typeof packet.data === 'object' ? packet.data : {};
  const userInfo = data.user_info || data.userInfo || {};
  const medalInfo = data.medal_info || data.medalInfo || userInfo.medal_info || userInfo.medalInfo;
  const currentMedalInfo = selectCurrentRoomMedalInfo([medalInfo], roomOwnerUid);
  const messageTimestamp =
    normalizeTimestampMs(readObjectValue(data, ['start_time', 'startTime', 'ts', 'time', 'timestamp'])) || Date.now();

  return {
    id: cleanText(readObjectValue(data, ['id_str', 'id', 'message_id', 'messageId', 'token'])),
    message: cleanText(readObjectValue(data, ['message', 'message_trans', 'messageTrans'])),
    price: normalizeSuperChatPrice(readObjectValue(data, ['price', 'rmb', 'price_text', 'priceText'])),
    uid: cleanText(readObjectValue(data, ['uid', 'mid']) || readObjectValue(userInfo, ['uid', 'mid'])),
    userName:
      cleanText(
        readObjectValue(userInfo, ['uname', 'name', 'user_name', 'userName']) ||
          readObjectValue(data, ['uname', 'name', 'nickname']),
      ) || '观众',
    avatarUrl: normalizeBilibiliAvatarUrl(
      readObjectValue(userInfo, ['face', 'face_url', 'faceUrl', 'avatar', 'avatar_url']),
    ),
    guardLevel: normalizeGuardLevel(
      readObjectValue(currentMedalInfo, ['guard_level', 'guardLevel']) ||
        readObjectValue(userInfo, ['guard_level', 'guardLevel']) ||
        readObjectValue(data, ['guard_level', 'guardLevel']),
    ),
    medalName: readMedalName(currentMedalInfo),
    medalLevel: readMedalLevel(currentMedalInfo),
    medalTargetUid: readMedalTargetId(currentMedalInfo),
    messageTimestamp,
    currentRoomVerified: Boolean(cleanText(roomOwnerUid) && medalInfo),
  };
}

function extractBilibiliSuperChatDeleteIds(packet) {
  const ids = packet?.data?.ids;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.flatMap((value) => {
    if (typeof value !== 'string' && !(Number.isSafeInteger(value) && value > 0)) return [];
    const id = String(value).trim();
    return id && id.length <= 128 ? [id] : [];
  }))];
}

module.exports = {
  extractBilibiliSuperChatMessage,
  extractBilibiliSuperChatDeleteIds,
};
