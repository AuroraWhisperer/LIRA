// 编写人：Aurora
// 用户身份缓存 — 维护合并结果的索引，并适配旧调用形态。
'use strict';

const { cleanText, normalizePositiveInteger } = require('../../shared/utils');
const { normalizeGuardLevel } = require('../../shared/bilibili-value-contract');
const { normalizeBilibiliAvatarUrl } = require('../parsers/danmaku-parser');
const { projectLegacyRequester } = require('../users/user-info-evidence');

const BILIBILI_IDENTITY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

class IdentityCache {
  #serviceOwned = false;

  constructor() {
    this.identityByUid = new Map();
    this.identityByName = new Map();
    this.recentByUid = new Map();
    this.onlineUids = new Set();
  }

  useServiceProjections() {
    this.#serviceOwned = true;
  }

  resolve(input) {
    const uid = cleanText(input && input.uid);
    const userName = cleanText(input && input.userName);
    const previous = this.lookup(uid, userName);
    if (this.#serviceOwned) {
      return publicRequesterIdentity(previous || { uid, userName: userName || '观众' });
    }
    const merged = this.#rememberIdentity(normalizeRequesterIdentity({
      uid,
      userName: userName || previous?.userName || '观众',
      avatarUrl: input && input.avatarUrl,
      guardLevel: input && input.requesterGuardLevel,
      medalName: input && input.requesterMedalName,
      medalLevel: input && input.requesterMedalLevel,
      currentRoom: Boolean(input && input.currentRoomVerified),
      source: input && input.identitySource,
    }), previous);
    if (uid) {
      this.recentByUid.set(uid, {
        ...publicRequesterIdentity(merged),
        uid,
        userName: merged.userName,
        seenAt: Date.now(),
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
    if (nameIdentity && (!uidKey || !nameIdentity.uid || nameIdentity.uid === uidKey) &&
        nowMs - nameIdentity.seenAt <= BILIBILI_IDENTITY_CACHE_MAX_AGE_MS) {
      return nameIdentity;
    }
    return null;
  }

  remember(input, options = {}) {
    if (this.#serviceOwned) return false;
    const identity = normalizeRequesterIdentity({
      ...input,
      currentRoom: options.currentRoom === true || Boolean(input && input.currentRoom),
      source: options.source || (input && (input.source || input.identitySource)),
    });
    if (!identity.uid && !identity.userName) return false;
    if (
      !identity.currentRoom &&
      !identity.avatarUrl &&
      !identity.guardLevel &&
      !identity.medalLevel &&
      !identity.medalName &&
      !identity.userName
    )
      return false;

    this.#rememberIdentity(identity, this.lookup(identity.uid, identity.userName));
    return true;
  }

  #rememberIdentity(identity, previous) {
    const nowMs = Date.now();
    const merged = projectLegacyRequester(identity, normalizeRequesterIdentity(previous), nowMs);
    const stored = { ...merged, seenAt: nowMs };

    if (stored.uid) this.identityByUid.set(stored.uid, stored);
    const nameKey = requesterNameKey(stored.userName);
    if (nameKey) this.identityByName.set(nameKey, stored);
    return merged;
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
      .filter((identity) => {
        if (!identity?.uid || seen.has(identity.uid)) return false;
        seen.add(identity.uid);
        return true;
      })
      .map(publicRequesterIdentity)
      .sort((left, right) => right.seenAt - left.seenAt);
  }

  markOnlineSnapshot(uids = []) {
    this.onlineUids = new Set(uids.map((uid) => cleanText(uid)).filter(Boolean));
  }

  listOnline() {
    return [...this.onlineUids]
      .map((uid) => this.identityByUid.get(uid) || this.recentByUid.get(uid))
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
      seenAt: input && input.seenAt,
    });
    if (!identity.uid) return false;

    const previous = this.identityByUid.get(identity.uid);
    const previousNameKey = requesterNameKey(previous?.userName);
    const nameKey = requesterNameKey(identity.userName);
    if (previousNameKey && previousNameKey !== nameKey && this.identityByName.get(previousNameKey) === previous) {
      this.identityByName.delete(previousNameKey);
    }
    this.identityByUid.set(identity.uid, identity);
    if (nameKey) this.identityByName.set(nameKey, identity);
    if (options.recent === true) this.recentByUid.set(identity.uid, identity);
    return true;
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
    source: cleanText(input && (input.source || input.identitySource)),
  };
  return addAvatarUrl(identity, input && input.avatarUrl);
}

function publicRequesterIdentity(input) {
  const identity = normalizeRequesterIdentity(input);
  return addAvatarUrl(
    {
      uid: identity.uid,
      userName: identity.userName,
      guardLevel: identity.guardLevel,
      medalName: identity.medalName,
      medalLevel: identity.medalLevel,
      seenAt: identity.seenAt,
    },
    identity.avatarUrl,
  );
}

function addAvatarUrl(identity, value) {
  const avatarUrl = normalizeBilibiliAvatarUrl(value);
  if (avatarUrl) identity.avatarUrl = avatarUrl;
  return identity;
}

function requesterNameKey(value) {
  return cleanText(value).toLowerCase();
}

module.exports = { IdentityCache };
