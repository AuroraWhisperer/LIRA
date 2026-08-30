'use strict';

const {
  cleanText,
  normalizePositiveInteger,
  normalizeGuardLevel,
  readObjectValue,
} = require('../../shared/utils');
const { normalizeBilibiliAvatarUrl } = require('../parsers/danmaku-parser');

// ---------------------------------------------------------------------------
// User metadata extraction utilities
// ---------------------------------------------------------------------------

function readMedalName(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return cleanText(medalInfo[1]);
  }
  return cleanText(
    readObjectValue(medalInfo, ['medal_name', 'medalName', 'name']),
  );
}

function readMedalLevel(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return normalizePositiveInteger(medalInfo[0]);
  }
  return normalizePositiveInteger(
    readObjectValue(medalInfo, ['medal_level', 'medalLevel', 'level']),
  );
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
  const danmakuOptions =
    Array.isArray(info) && Array.isArray(info[0]) ? info[0][15] : null;
  const userInfo = readFirstObject(danmakuOptions, ['user']);
  const userMedalInfo = readFirstObject(userInfo, ['medal']);
  const userGuardInfo = readFirstObject(userInfo, ['guard']);
  const currentMedalInfo = selectCurrentRoomMedalInfo(
    [medalInfo, userMedalInfo],
    roomOwnerUid,
  );
  const arrayGuardLevel =
    currentMedalInfo === medalInfo &&
    Array.isArray(medalInfo) &&
    medalInfo.length > 10
      ? medalInfo[10]
      : !cleanText(roomOwnerUid) && Array.isArray(info)
        ? info[7]
        : 0;
  const currentRoomVerified = Boolean(
    cleanText(roomOwnerUid) &&
    [medalInfo, userMedalInfo].some((candidate) =>
      readMedalTargetId(candidate),
    ),
  );
  return addCurrentRoomVerification(
    addMedalTargetUid(
      {
        guardLevel: normalizeGuardLevel(
          readObjectValue(userGuardInfo, [
            'level',
            'guard_level',
            'guardLevel',
          ]) ||
            readObjectValue(currentMedalInfo, ['guard_level', 'guardLevel']) ||
            arrayGuardLevel,
        ),
        medalName: readMedalName(currentMedalInfo),
        medalLevel: readMedalLevel(currentMedalInfo),
      },
      readMedalTargetId(currentMedalInfo),
    ),
    currentRoomVerified,
  );
}

function extractBilibiliHistoryUserMeta(item, roomOwnerUid = '') {
  const medalInfo =
    item &&
    (item.medal ||
      item.fans_medal ||
      item.fansMedal ||
      item.medal_info ||
      item.medalInfo);
  const currentMedalInfo = selectCurrentRoomMedalInfo(
    [medalInfo],
    roomOwnerUid,
  );
  const currentRoomVerified = Boolean(cleanText(roomOwnerUid) && medalInfo);
  return addCurrentRoomVerification(
    addMedalTargetUid(
      addAvatarUrl(
        {
          guardLevel: normalizeGuardLevel(
            readObjectValue(item, [
              'guard_level',
              'guardLevel',
              'guard_level_v2',
            ]) ||
              readObjectValue(currentMedalInfo, ['guard_level', 'guardLevel']),
          ),
          medalName: readMedalName(currentMedalInfo),
          medalLevel: readMedalLevel(currentMedalInfo),
        },
        readObjectValue(item, [
          'face',
          'face_url',
          'faceUrl',
          'avatar',
          'avatar_url',
        ]),
      ),
      readMedalTargetId(currentMedalInfo),
    ),
    currentRoomVerified,
  );
}

function extractBilibiliOnlineRankUserMeta(item, roomOwnerUid = '') {
  const uinfo = item && item.uinfo;
  const medalInfo =
    item &&
    (item.medalInfo ||
      item.medal_info ||
      item.medal ||
      item.fans_medal ||
      item.fansMedal ||
      item.uinfo_medal ||
      (uinfo && uinfo.medal));
  const guardInfo =
    item &&
    (item.guard || item.guard_info || item.guardInfo || (uinfo && uinfo.guard));
  const currentMedalInfo = selectCurrentRoomMedalInfo(
    [medalInfo],
    roomOwnerUid,
    { allowUnattributed: true },
  );
  return addCurrentRoomVerification(
    addMedalTargetUid(
      addAvatarUrl(
        {
          uid: cleanText(
            readObjectValue(item, ['uid', 'mid']) ||
              readObjectValue(uinfo, ['uid', 'mid']),
          ),
          userName: cleanText(
            readObjectValue(item, ['name', 'uname', 'nickname']) ||
              readObjectValue(uinfo && uinfo.base, [
                'name',
                'uname',
                'nickname',
              ]),
          ),
          guardLevel: normalizeGuardLevel(
            readObjectValue(item, ['guard_level', 'guardLevel']) ||
              readObjectValue(guardInfo, [
                'level',
                'guardLevel',
                'guard_level',
              ]) ||
              readObjectValue(currentMedalInfo, ['guardLevel', 'guard_level']),
          ),
          medalName: readMedalName(currentMedalInfo),
          medalLevel: readMedalLevel(currentMedalInfo),
        },
        readObjectValue(item, [
          'face',
          'face_url',
          'faceUrl',
          'avatar',
          'avatar_url',
        ]) ||
          readObjectValue(uinfo && uinfo.base, [
            'face',
            'face_url',
            'faceUrl',
            'avatar',
            'avatar_url',
          ]),
      ),
      readMedalTargetId(currentMedalInfo) || cleanText(roomOwnerUid),
    ),
    Boolean(cleanText(roomOwnerUid) && medalInfo),
  );
}

function addAvatarUrl(identity, value) {
  const avatarUrl = normalizeBilibiliAvatarUrl(value);
  if (avatarUrl) identity.avatarUrl = avatarUrl;
  return identity;
}

function readMedalTargetId(medalInfo) {
  if (Array.isArray(medalInfo)) {
    return cleanText(medalInfo[12]);
  }
  return cleanText(
    readObjectValue(medalInfo, ['target_id', 'targetId', 'ruid']),
  );
}

function selectCurrentRoomMedalInfo(candidates, roomOwnerUid, options = {}) {
  const medalCandidates = (Array.isArray(candidates) ? candidates : []).filter(
    Boolean,
  );
  if (medalCandidates.length === 0) return null;

  const expectedUid = cleanText(roomOwnerUid);
  if (!expectedUid) return medalCandidates[0];

  let hasTargetId = false;
  for (const candidate of medalCandidates) {
    const targetId = readMedalTargetId(candidate);
    if (!targetId) continue;
    hasTargetId = true;
    if (targetId === expectedUid) return candidate;
  }

  return options.allowUnattributed && !hasTargetId ? medalCandidates[0] : null;
}

function addCurrentRoomVerification(identity, currentRoomVerified) {
  if (currentRoomVerified) identity.currentRoomVerified = true;
  return identity;
}

function addMedalTargetUid(identity, value) {
  const targetUid = cleanText(value);
  if (targetUid) {
    Object.defineProperty(identity, 'medalTargetUid', {
      value: targetUid,
      enumerable: false,
      configurable: true,
    });
  }
  return identity;
}

module.exports = {
  readMedalName,
  readMedalLevel,
  readMedalTargetId,
  readFirstObject,
  selectCurrentRoomMedalInfo,
  extractBilibiliDanmakuUserMeta,
  extractBilibiliHistoryUserMeta,
  extractBilibiliOnlineRankUserMeta,
};
