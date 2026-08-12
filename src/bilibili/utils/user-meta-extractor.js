'use strict';

const {
  cleanText,
  normalizePositiveInteger,
  normalizeGuardLevel,
  readObjectValue
} = require('../../shared/utils');

// ---------------------------------------------------------------------------
// User metadata extraction utilities
// ---------------------------------------------------------------------------

function readMedalName(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return cleanText(medalInfo[1]);
  }
  return cleanText(readObjectValue(medalInfo, ['medal_name', 'medalName', 'name']));
}

function readMedalLevel(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return normalizePositiveInteger(medalInfo[0]);
  }
  return normalizePositiveInteger(readObjectValue(medalInfo, ['medal_level', 'medalLevel', 'level']));
}

function readFirstObject(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] && typeof value[key] === 'object') {
      return value[key];
    }
  }
  return null;
}

function extractBilibiliDanmakuUserMeta(info, roomOwnerUid = '') {
  const medalInfo = Array.isArray(info) ? info[3] : null;
  const danmakuOptions = Array.isArray(info) && Array.isArray(info[0]) ? info[0][15] : null;
  const userInfo = readFirstObject(danmakuOptions, ['user']);
  const userMedalInfo = readFirstObject(userInfo, ['medal']);
  const userGuardInfo = readFirstObject(userInfo, ['guard']);
  const medalTargetId = readMedalTargetId(userMedalInfo) || readMedalTargetId(medalInfo);
  const isCurrentRoomMedal = isTargetRoom(medalTargetId, roomOwnerUid);
  const arrayGuardLevel = Array.isArray(medalInfo) && medalInfo.length > 10
    ? medalInfo[10]
    : (Array.isArray(info) ? info[7] : 0);
  const currentMedalInfo = isCurrentRoomMedal ? (medalInfo || userMedalInfo) : null;
  return {
    guardLevel: normalizeGuardLevel(
      readObjectValue(userGuardInfo, ['level', 'guard_level', 'guardLevel'])
      || (isCurrentRoomMedal
        ? readObjectValue(userMedalInfo, ['guard_level', 'guardLevel']) || arrayGuardLevel
        : 0)
    ),
    medalName: readMedalName(currentMedalInfo),
    medalLevel: readMedalLevel(currentMedalInfo)
  };
}

function extractBilibiliHistoryUserMeta(item) {
  const medalInfo = item && (item.medal || item.fans_medal || item.fansMedal || item.medal_info || item.medalInfo);
  return {
    guardLevel: normalizeGuardLevel(readObjectValue(item, ['guard_level', 'guardLevel', 'guard_level_v2'])),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
  };
}

function extractBilibiliOnlineRankUserMeta(item, roomOwnerUid = '') {
  const uinfo = item && item.uinfo;
  const medalInfo = item && (
    item.medalInfo
    || item.medal_info
    || item.medal
    || item.fans_medal
    || item.fansMedal
    || item.uinfo_medal
    || (uinfo && uinfo.medal)
  );
  const guardInfo = item && (item.guard || item.guard_info || item.guardInfo || (uinfo && uinfo.guard));
  const medalTargetId = readMedalTargetId(medalInfo);
  const isCurrentRoomMedal = isTargetRoom(medalTargetId, roomOwnerUid);
  return {
    uid: cleanText(readObjectValue(item, ['uid', 'mid']) || readObjectValue(uinfo, ['uid', 'mid'])),
    userName: cleanText(
      readObjectValue(item, ['name', 'uname', 'nickname'])
      || readObjectValue(uinfo && uinfo.base, ['name', 'uname', 'nickname'])
    ),
    guardLevel: normalizeGuardLevel(
      readObjectValue(item, ['guard_level', 'guardLevel'])
      || readObjectValue(guardInfo, ['level', 'guardLevel', 'guard_level'])
      || (isCurrentRoomMedal ? readObjectValue(medalInfo, ['guardLevel', 'guard_level']) : 0)
    ),
    medalName: isCurrentRoomMedal ? readMedalName(medalInfo) : '',
    medalLevel: isCurrentRoomMedal ? readMedalLevel(medalInfo) : 0
  };
}

function readMedalTargetId(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return cleanText(medalInfo[12]);
  }
  return cleanText(readObjectValue(medalInfo, ['target_id', 'targetId', 'ruid']));
}

function isTargetRoom(targetId, roomOwnerUid) {
  const expectedUid = cleanText(roomOwnerUid);
  const actualUid = cleanText(targetId);
  return !expectedUid || !actualUid || actualUid === expectedUid;
}

module.exports = {
  readMedalName,
  readMedalLevel,
  readFirstObject,
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliOnlineRankUserMeta
};
