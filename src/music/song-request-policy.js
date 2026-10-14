'use strict';

const { cleanText } = require('../shared/utils');
const { normalizeGuardLevel } = require('../shared/bilibili-value-contract');

function requestRejection(code, message) {
  return Object.assign(new Error(message), { code });
}

function requesterIdentity(input) {
  const uid = cleanText(input.requesterUid);
  if (input.requesterIdentityType === 'open_id' && uid) return { uid, type: 'open_id' };
  if (input.requesterIdentityType === 'uid' && /^[1-9]\d{0,24}$/.test(uid)) return { uid, type: 'uid' };
  return null;
}

function verifiedGuardLevel(input) {
  return (input.requesterGuardVerified ?? input.currentRoomVerified) === true
    ? normalizeGuardLevel(input.requesterGuardLevel) : 0;
}

function userCooldownSeconds(settings, input) {
  const keys = { 1: 'userCooldownGovernorSeconds', 2: 'userCooldownAdmiralSeconds', 3: 'userCooldownCaptainSeconds' };
  const override = settings[keys[verifiedGuardLevel(input)]];
  return Number(override === undefined || override === '' ? settings.userCooldownSeconds : override) || 0;
}

function assertSongRequesterAllowed(settings, input, at = Date.now()) {
  const identity = requesterIdentity(input);
  const blacklist = JSON.parse(settings.songRequestUserBlacklist || '[]')
    .filter((entry) => !entry.expiresAt || entry.expiresAt > at);
  if (blacklist.length) {
    if (identity?.type !== 'uid') {
      throw requestRejection('REQUESTER_IDENTITY_REQUIRED', '暂时无法确认你的 UID，请稍后再点歌。');
    }
    if (blacklist.some((entry) => entry.uid === identity.uid)) {
      throw requestRejection('REQUESTER_BLACKLISTED', '你目前已被限制点歌。');
    }
  }
  if (Number(settings.userQueueLimit) > 0 && !identity) {
    throw requestRejection('REQUESTER_IDENTITY_REQUIRED', '暂时无法确认你的点歌身份，请稍后再点歌。');
  }

  const guardLevel = verifiedGuardLevel(input);
  const requiredGuard = Number(settings.songRequestGuardLevel) || 0;
  if (requiredGuard && (!guardLevel || guardLevel > requiredGuard)) {
    const label = { 1: '总督', 2: '提督及以上', 3: '舰长及以上' }[requiredGuard];
    throw requestRejection('REQUESTER_GUARD_REQUIRED', `点歌需要本直播间${label}身份，暂未确认你符合要求。`);
  }
  const requiredMedal = Number(settings.songRequestMinMedalLevel) || 0;
  const bypassMedal = settings.songRequestGuardMedalBypass === 'true' && guardLevel > 0;
  const medalVerified = (input.requesterMedalVerified ?? input.currentRoomVerified) === true;
  if (requiredMedal && !bypassMedal && (!medalVerified || (Number(input.requesterMedalLevel) || 0) < requiredMedal)) {
    throw requestRejection('REQUESTER_MEDAL_REQUIRED', `点歌需要本直播间 ${requiredMedal} 级及以上粉丝牌，暂未确认你符合要求。`);
  }
}

module.exports = { requestRejection, requesterIdentity, userCooldownSeconds, assertSongRequesterAllowed };
