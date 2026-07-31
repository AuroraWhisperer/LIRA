// 编写人：Aurora
// 用户身份缓存 — 缓存和合并用户身份信息（勋章、舰长等）。
'use strict';

const { cleanText, normalizeGuardLevel, normalizePositiveInteger } = require('../../shared/utils');

const BILIBILI_IDENTITY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

class IdentityCache {
  constructor() {
    this.identityByUid = new Map();
    this.identityByName = new Map();
  }

  resolve(input) {
    const uid = cleanText(input && input.uid);
    const userName = cleanText(input && input.userName) || '观众';
    const cached = this.lookup(uid, userName);
    const merged = mergeRequesterIdentity({
      uid,
      userName,
      guardLevel: normalizeGuardLevel(input && input.requesterGuardLevel),
      medalName: cleanText(input && input.requesterMedalName),
      medalLevel: normalizePositiveInteger(input && input.requesterMedalLevel)
    }, cached);
    this.remember(merged);
    return merged;
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

  remember(input) {
    const identity = normalizeRequesterIdentity(input);
    if (!identity.uid && !identity.userName) return false;
    if (!identity.guardLevel && !identity.medalLevel && !identity.medalName) return false;

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
  }
}

function normalizeRequesterIdentity(input) {
  return {
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName),
    guardLevel: normalizeGuardLevel(input && input.guardLevel),
    medalName: cleanText(input && input.medalName),
    medalLevel: normalizePositiveInteger(input && input.medalLevel),
    seenAt: normalizePositiveInteger(input && input.seenAt)
  };
}

function mergeRequesterIdentity(primary, fallback) {
  const base = normalizeRequesterIdentity(primary);
  const extra = normalizeRequesterIdentity(fallback);
  return {
    uid: base.uid || extra.uid,
    userName: chooseRequesterUserName(base.userName, extra.userName),
    guardLevel: base.guardLevel || extra.guardLevel,
    medalName: base.medalName || extra.medalName,
    medalLevel: base.medalLevel || extra.medalLevel,
    seenAt: Math.max(base.seenAt, extra.seenAt)
  };
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
