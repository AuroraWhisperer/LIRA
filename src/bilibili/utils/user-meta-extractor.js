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

function extractBilibiliDanmakuUserMeta(info) {
  const medalInfo = Array.isArray(info) ? info[3] : null;
  const extraInfo = Array.isArray(info) ? info[9] : null;
  return {
    guardLevel: normalizeGuardLevel(
      readObjectValue(extraInfo, ['guard_level', 'guardLevel'])
      || (Array.isArray(info) ? info[7] : 0)
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
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

function extractBilibiliOnlineRankUserMeta(item) {
  const medalInfo = item && (
    item.medalInfo
    || item.medal_info
    || item.medal
    || item.fans_medal
    || item.fansMedal
    || item.uinfo_medal
  );
  const guardInfo = item && (item.guard || item.guard_info || item.guardInfo);
  return {
    uid: cleanText(readObjectValue(item, ['uid', 'mid'])),
    userName: cleanText(readObjectValue(item, ['name', 'uname', 'nickname'])),
    guardLevel: normalizeGuardLevel(
      readObjectValue(medalInfo, ['guardLevel', 'guard_level'])
      || readObjectValue(item, ['guard_level', 'guardLevel'])
      || readObjectValue(guardInfo, ['level', 'guardLevel', 'guard_level'])
    ),
    medalName: readMedalName(medalInfo),
    medalLevel: readMedalLevel(medalInfo)
  };
}

module.exports = {
  readMedalName,
  readMedalLevel,
  readFirstObject,
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliOnlineRankUserMeta
};
