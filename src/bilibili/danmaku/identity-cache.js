// 编写人：Aurora
// 用户身份缓存 — 缓存和合并用户身份信息（勋章、舰长等）。
'use strict';

const { cleanText, normalizeGuardLevel, normalizePositiveInteger } = require('../../shared/utils');
const { normalizeBilibiliAvatarUrl } = require('../parsers/danmaku-parser');

const BILIBILI_IDENTITY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const IDENTITY_SOURCE_PRIORITY = {
  fans_rank: 10,
  online_rank: 5,
  history: 20,
  superchat: 30,
  danmaku: 30
};

class IdentityCache {
  constructor() {
    this.identityByUid = new Map();
    this.identityByName = new Map();
    this.recentByUid = new Map();
    this.onlineUids = new Set();
  }

  resolve(input) {
    const uid = cleanText(input && input.uid);
    const userName = cleanText(input && input.userName) || '观众';
    const cached = this.lookup(uid, userName);
    const merged = mergeRequesterIdentity({
      uid,
      userName,
      avatarUrl: normalizeBilibiliAvatarUrl(input && input.avatarUrl),
      guardLevel: normalizeGuardLevel(input && input.requesterGuardLevel),
      medalName: cleanText(input && input.requesterMedalName),
      medalLevel: normalizePositiveInteger(input && input.requesterMedalLevel),
      currentRoom: Boolean(input && input.currentRoomVerified),
      source: input && input.identitySource
    }, cached);
    this.remember(merged);
    if (uid) {
      this.recentByUid.set(uid, {
        ...publicRequesterIdentity(merged),
        uid,
        userName: merged.userName,
        seenAt: Date.now()
      });
    }
    return publicRequesterIdentity(merged);
  }

  lookup(uid, userName) {
    const nowMs = Date.now();
    const uidKey = cleanText(uid);
    const uidIdentity = uidKey ? this.identityByUid.get(uidKey) : null;
    if (uidIdentity && nowMs - uidIdentity.seenAt <= BILIBILI_IDENTITY_CACHE_MAX_AGE_MS) {
      return uidIdentity;
    }

    const nameKey = requesterNameKey(userName);
    const nameIdentity = nameKey ? this.identityByName.get(nameKey) : null;
    if (nameIdentity && nowMs - nameIdentity.seenAt <= BILIBILI_IDENTITY_CACHE_MAX_AGE_MS) {
      return nameIdentity;
    }
    return null;
  }

  remember(input, options = {}) {
    const identity = normalizeRequesterIdentity({
      ...input,
      currentRoom: options.currentRoom === true || Boolean(input && input.currentRoom),
      source: options.source || (input && (input.source || input.identitySource))
    });
    if (!identity.uid && !identity.userName) return false;
    if (!identity.currentRoom && !identity.avatarUrl && !identity.guardLevel && !identity.medalLevel && !identity.medalName
      && !identity.userName) return false;

    const previous = this.lookup(identity.uid, identity.userName);
    const merged = {
      ...mergeRequesterIdentity(identity, previous),
      seenAt: Date.now()
    };

    if (merged.uid) this.identityByUid.set(merged.uid, merged);
    const nameKey = requesterNameKey(merged.userName);
    if (nameKey) this.identityByName.set(nameKey, merged);
    return true;
  }

  cleanup() {
    const cutoff = Date.now() - BILIBILI_IDENTITY_CACHE_MAX_AGE_MS;
    for (const [uid, identity] of this.identityByUid) {
      if (!identity || identity.seenAt < cutoff) this.identityByUid.delete(uid);
    }
    for (const [name, identity] of this.identityByName) {
      if (!identity || identity.seenAt < cutoff) this.identityByName.delete(name);
    }
    for (const [uid, identity] of this.recentByUid) {
      if (!identity || identity.seenAt < cutoff) this.recentByUid.delete(uid);
    }
  }

  listRecent() {
    this.cleanup();
    const seen = new Set();
    const candidates = new Map(this.recentByUid);
    for (const [uid, identity] of this.identityByUid) {
      if (!candidates.has(uid)) candidates.set(uid, publicRequesterIdentity(identity));
    }
    return [...candidates.values()]
      .filter(identity => {
        if (!identity?.uid || seen.has(identity.uid)) return false;
        seen.add(identity.uid);
        return true;
      })
      .map(publicRequesterIdentity)
      .sort((left, right) => right.seenAt - left.seenAt);
  }

  markOnlineSnapshot(uids = []) {
    this.onlineUids = new Set(uids.map(uid => cleanText(uid)).filter(Boolean));
  }

  listOnline() {
    return [...this.onlineUids]
      .map(uid => this.identityByUid.get(uid) || this.recentByUid.get(uid))
      .filter(Boolean)
      .map(publicRequesterIdentity)
      .sort((left, right) => left.userName.localeCompare(right.userName, 'zh-CN'));
  }

  storeMerged(input, options = {}) {
    const identity = publicRequesterIdentity({
      uid: input && input.uid,
      userName: input && (input.userName || input.name),
      avatarUrl: input && input.avatarUrl,
      guardLevel: input && input.guardLevel,
      medalName: input && input.medalName,
      medalLevel: input && input.medalLevel,
      seenAt: input && input.seenAt
    });
    if (!identity.uid) return false;

    const stored = { ...identity };
    this.identityByUid.set(identity.uid, stored);
    const nameKey = requesterNameKey(identity.userName);
    if (nameKey) this.identityByName.set(nameKey, stored);
    if (options.recent === true) this.recentByUid.set(identity.uid, stored);
    return true;
  }

  readMerged(uid) {
    const identity = this.identityByUid.get(cleanText(uid));
    return identity ? { ...identity } : null;
  }

  listRecentUids() {
    this.cleanup();
    return [...this.recentByUid.entries()]
      .sort((left, right) => Number(right[1]?.seenAt || 0) - Number(left[1]?.seenAt || 0))
      .map(([uid]) => uid);
  }

  replaceOnlineSnapshot(uids = []) {
    this.markOnlineSnapshot(uids);
  }

  listOnlineUids() {
    return [...this.onlineUids];
  }

  clearRoomIndexes() {
    this.recentByUid.clear();
    this.onlineUids.clear();
  }

  deleteMerged(uid) {
    const uidKey = cleanText(uid);
    const identity = this.identityByUid.get(uidKey);
    if (identity) {
      const nameKey = requesterNameKey(identity.userName);
      if (nameKey && this.identityByName.get(nameKey) === identity) {
        this.identityByName.delete(nameKey);
      }
    }
    this.identityByUid.delete(uidKey);
    this.recentByUid.delete(uidKey);
    this.onlineUids.delete(uidKey);
  }
}

function normalizeRequesterIdentity(input) {
  const identity = {
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName),
    guardLevel: normalizeGuardLevel(input && input.guardLevel),
    medalName: cleanText(input && input.medalName),
    medalLevel: normalizePositiveInteger(input && input.medalLevel),
    seenAt: normalizePositiveInteger(input && input.seenAt),
    currentRoom: Boolean(input && input.currentRoom),
    source: cleanText(input && (input.source || input.identitySource))
  };
  return addAvatarUrl(identity, input && input.avatarUrl);
}

function mergeRequesterIdentity(primary, fallback) {
  const base = normalizeRequesterIdentity(primary);
  const extra = normalizeRequesterIdentity(fallback);
  if (base.currentRoom) return mergeCurrentRoomIdentity(base, extra);
  if (extra.currentRoom) return mergeCurrentRoomIdentity(extra, base);
  return addAvatarUrl({
    uid: base.uid || extra.uid,
    userName: chooseRequesterUserName(base.userName, extra.userName),
    guardLevel: base.guardLevel || extra.guardLevel,
    medalName: base.medalName || extra.medalName,
    medalLevel: base.medalLevel || extra.medalLevel,
    seenAt: Math.max(base.seenAt, extra.seenAt),
    currentRoom: false
  }, base.avatarUrl || extra.avatarUrl);
}

function mergeCurrentRoomIdentity(currentRoom, fallback) {
  const selected = chooseCurrentRoomEvidence(currentRoom, fallback);
  return addAvatarUrl({
    uid: selected.uid || fallback.uid || currentRoom.uid,
    userName: chooseRequesterUserName(selected.userName, fallback.userName || currentRoom.userName),
    guardLevel: selected.guardLevel,
    medalName: selected.medalName,
    medalLevel: selected.medalLevel,
    seenAt: Math.max(selected.seenAt, fallback.seenAt, currentRoom.seenAt),
    source: selected.source,
    currentRoom: true
  }, selected.avatarUrl || fallback.avatarUrl || currentRoom.avatarUrl);
}

function chooseCurrentRoomEvidence(primary, fallback) {
  const primaryPriority = identitySourcePriority(primary.source);
  const fallbackPriority = identitySourcePriority(fallback.source);
  if (fallback.currentRoom && fallbackPriority > primaryPriority) return fallback;
  return primary;
}

function identitySourcePriority(source) {
  return IDENTITY_SOURCE_PRIORITY[cleanText(source)] || 0;
}

function publicRequesterIdentity(input) {
  const identity = normalizeRequesterIdentity(input);
  return addAvatarUrl({
    uid: identity.uid,
    userName: identity.userName,
    guardLevel: identity.guardLevel,
    medalName: identity.medalName,
    medalLevel: identity.medalLevel,
    seenAt: identity.seenAt
  }, identity.avatarUrl);
}

function addAvatarUrl(identity, value) {
  const avatarUrl = normalizeBilibiliAvatarUrl(value);
  if (avatarUrl) identity.avatarUrl = avatarUrl;
  return identity;
}

function chooseRequesterUserName(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  if (isMaskedDisplayName(primary) && !isMaskedDisplayName(fallback)) {
    return fallback;
  }
  return primary;
}

function isMaskedDisplayName(value) {
  return /\*{2,}/.test(cleanText(value));
}

function requesterNameKey(value) {
  return cleanText(value).toLowerCase();
}

module.exports = { IdentityCache };
