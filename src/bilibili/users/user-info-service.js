'use strict';

const { cleanText, normalizeGuardLevel } = require('../../shared/utils');
const { normalizeBilibiliAvatarUrl } = require('../parsers/danmaku-parser');
const { IdentityCache } = require('../danmaku/identity-cache');
const {
  USER_INFO_TTL_MS,
  PROFILE_FAILURE_TTL_MS,
  PROFILE_FIELDS,
  ROOM_FIELDS,
  ALL_FIELDS,
  normalizeFields,
  normalizeSource,
  normalizeUid,
  profileEvidence,
  roomEvidence,
  shouldReplaceName,
  shouldReplaceProfileField,
  shouldReplaceRoomField,
  normalizeFansMedal,
  isMaskedDisplayName,
  sameValue,
  cloneValue,
  emptyIngestResult,
} = require('./user-info-evidence');

class UserInfoService {
  constructor(options = {}) {
    this.identityCache = options.identityCache || new IdentityCache();
    this.profileProvider = options.profileProvider || null;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.diagnostics = options.diagnostics || null;
    this.records = new Map();
    this.subscriptions = new Set();
    this.profileRequests = new Map();
    this.profileFailures = new Map();
    this.roomScope = null;
    this.activeRoomRun = null;
    this.generation = 0;
    this.nextRunToken = 0;
    this.lifecycleToken = 0;
    this.disposed = false;
  }

  peek(uid, options = {}) {
    const selection = normalizeFields(options.fields, ALL_FIELDS);
    const uidKey = normalizeUid(uid);
    if (!uidKey || !this.matchesRequestedRoom(options.roomId)) return null;
    this.cleanupExpired();
    const record = this.records.get(uidKey);
    return record ? this.project(record, selection) : null;
  }

  ingestHint(hint, context = {}) {
    const source = normalizeSource(context.source, this.diagnostics);
    if (this.disposed) return emptyIngestResult();
    const uid = normalizeUid(hint && hint.uid);
    if (!uid) return emptyIngestResult();
    if (source !== 'profile' && !this.matchesActiveRun(context))
      return emptyIngestResult();

    const observedAt = this.now();
    let record = this.records.get(uid);
    if (!record) {
      record = {
        uid,
        name: '',
        avatarUrl: '',
        evidence: {},
        room: {},
        updatedAt: observedAt,
        seenAt: observedAt,
      };
      this.records.set(uid, record);
    }

    const changed = new Set();
    const name = cleanText(hint && hint.name);
    if (
      name &&
      shouldReplaceName(record.evidence.name, name, source, observedAt)
    ) {
      if (record.name !== name) changed.add('name');
      record.name = name;
      record.evidence.name = profileEvidence(source, observedAt, {
        quality: isMaskedDisplayName(name) ? 'masked' : 'full',
      });
    }

    const avatarUrl = normalizeBilibiliAvatarUrl(hint && hint.avatarUrl);
    if (
      avatarUrl &&
      shouldReplaceProfileField(record.evidence.avatarUrl, source, observedAt)
    ) {
      if (record.avatarUrl !== avatarUrl) changed.add('avatarUrl');
      record.avatarUrl = avatarUrl;
      record.evidence.avatarUrl = profileEvidence(source, observedAt);
    }

    if (source !== 'profile') {
      this.mergeRoomIdentity(
        record,
        hint && hint.roomIdentity,
        context,
        source,
        observedAt,
        changed,
      );
    }

    record.seenAt = observedAt;
    if (changed.size > 0) record.updatedAt = observedAt;
    this.storeCompatibilityRecord(record, source !== 'profile');

    const changedFields = ALL_FIELDS.filter((field) => changed.has(field));
    if (changedFields.length > 0) this.notify(record, changedFields);
    return {
      snapshot: this.project(record, normalizeFields(undefined, ALL_FIELDS)),
      changedFields,
    };
  }

  async ensure(uid, options = {}) {
    const selection = normalizeFields(
      options.fields === undefined ? PROFILE_FIELDS : options.fields,
      PROFILE_FIELDS,
    );
    for (const field of selection.fields) {
      if (!PROFILE_FIELDS.includes(field))
        throw new TypeError(`ensure() does not support field: ${field}`);
    }

    const uidKey = normalizeUid(uid);
    if (!uidKey || !this.matchesRequestedRoom(options.roomId) || this.disposed)
      return null;
    this.cleanupExpired();
    const explicitRoomId =
      options.roomId === undefined ? '' : cleanText(options.roomId);
    const requestedGeneration =
      explicitRoomId && this.roomScope ? this.roomScope.generation : 0;
    const existing = this.records.get(uidKey);
    if (
      selection.fields.every((field) => Boolean(existing && existing[field]))
    ) {
      return this.project(existing, selection);
    }

    const nowMs = this.now();
    if (Number(this.profileFailures.get(uidKey) || 0) > nowMs) {
      return existing ? this.project(existing, selection) : null;
    }

    let request = this.profileRequests.get(uidKey);
    if (!request) {
      if (
        !this.profileProvider ||
        typeof this.profileProvider.fetchProfile !== 'function'
      ) {
        return existing ? this.project(existing, selection) : null;
      }
      const lifecycleToken = this.lifecycleToken;
      let providerRequest;
      try {
        providerRequest = this.profileProvider.fetchProfile(uidKey);
      } catch (error) {
        providerRequest = Promise.reject(error);
      }
      request = Promise.resolve(providerRequest)
        .then((profile) => {
          if (this.disposed || lifecycleToken !== this.lifecycleToken)
            return null;
          this.profileFailures.delete(uidKey);
          return this.ingestHint(
            {
              uid: uidKey,
              name: profile && profile.name,
              avatarUrl: profile && profile.avatarUrl,
            },
            { source: 'profile' },
          ).snapshot;
        })
        .catch((error) => {
          this.profileFailures.set(uidKey, this.now() + PROFILE_FAILURE_TTL_MS);
          this.recordDiagnostic('profile-failed', uidKey, error);
          return null;
        })
        .finally(() => {
          if (this.profileRequests.get(uidKey) === request)
            this.profileRequests.delete(uidKey);
        });
      this.profileRequests.set(uidKey, request);
    }

    await request;
    if (this.disposed) return null;
    if (
      explicitRoomId &&
      (!this.roomScope ||
        this.roomScope.roomId !== explicitRoomId ||
        this.roomScope.generation !== requestedGeneration)
    ) {
      return null;
    }
    const current = this.records.get(uidKey);
    return current ? this.project(current, selection) : null;
  }

  listRecent(options = {}) {
    const selection = normalizeFields(options.fields, ALL_FIELDS);
    if (!this.matchesRequestedRoom(options.roomId)) return [];
    this.cleanupExpired();
    return this.identityCache
      .listRecentUids()
      .map((uid) => this.records.get(uid))
      .filter(Boolean)
      .map((record) => this.project(record, selection));
  }

  listOnline(options = {}) {
    const selection = normalizeFields(options.fields, ALL_FIELDS);
    if (!this.matchesRequestedRoom(options.roomId)) return [];
    this.cleanupExpired();
    return this.identityCache
      .listOnlineUids()
      .map((uid) => this.records.get(uid))
      .filter(Boolean)
      .map((record) => this.project(record, selection))
      .sort((left, right) =>
        cleanText(left.name).localeCompare(cleanText(right.name), 'zh-CN'),
      );
  }

  replaceOnlineSnapshot(uids = [], context = {}) {
    if (this.disposed || !this.matchesActiveRun(context)) return false;
    const normalizedUids = [
      ...new Set(
        (Array.isArray(uids) ? uids : []).map(normalizeUid).filter(Boolean),
      ),
    ];
    this.identityCache.replaceOnlineSnapshot(normalizedUids);
    return true;
  }

  subscribe(listener, options = {}) {
    if (typeof listener !== 'function')
      throw new TypeError('listener must be a function');
    const selection = normalizeFields(options.fields, ALL_FIELDS);
    if (!this.matchesRequestedRoom(options.roomId)) return () => {};
    const explicitRoomId =
      options.roomId === undefined ? '' : cleanText(options.roomId);
    const subscription = {
      listener,
      selection,
      roomId: explicitRoomId,
      generation:
        explicitRoomId && this.roomScope ? this.roomScope.generation : 0,
      active: true,
    };
    this.subscriptions.add(subscription);
    return () => {
      subscription.active = false;
      this.subscriptions.delete(subscription);
    };
  }

  setRoom(scope = {}) {
    const roomId = cleanText(scope.roomId);
    const ownerUid = normalizeUid(scope.ownerUid);
    if ((roomId && !ownerUid) || (!roomId && ownerUid)) {
      throw new TypeError('roomId and ownerUid must be provided together');
    }
    if (
      this.roomScope &&
      this.roomScope.roomId === roomId &&
      this.roomScope.ownerUid === ownerUid
    ) {
      return { ...this.roomScope };
    }
    if (!this.roomScope && !roomId && !ownerUid) {
      return { roomId: '', ownerUid: '', generation: this.generation };
    }

    const invalidated = [];
    for (const subscription of this.subscriptions) {
      if (subscription.roomId) {
        subscription.active = false;
        this.subscriptions.delete(subscription);
      }
    }
    for (const record of this.records.values()) {
      const changedFields = [];
      if (record.room.guard) changedFields.push('guard');
      if (record.room.fansMedal) changedFields.push('fansMedal');
      if (changedFields.length > 0) invalidated.push({ record, changedFields });
      record.room = {};
    }

    this.generation += 1;
    this.roomScope = roomId
      ? Object.freeze({ roomId, ownerUid, generation: this.generation })
      : null;
    this.activeRoomRun = null;
    this.identityCache.clearRoomIndexes();
    for (const record of this.records.values())
      this.storeCompatibilityRecord(record, false);
    for (const item of invalidated)
      this.notify(item.record, item.changedFields);
    return this.roomScope
      ? { ...this.roomScope }
      : { roomId: '', ownerUid: '', generation: this.generation };
  }

  beginRoomRun() {
    if (!this.roomScope)
      throw new Error('Cannot begin room run without a room scope.');
    this.identityCache.replaceOnlineSnapshot([]);
    this.activeRoomRun = Object.freeze({
      ...this.roomScope,
      runToken: ++this.nextRunToken,
    });
    return this.activeRoomRun;
  }

  endRoomRun(context = {}) {
    if (!this.matchesActiveRun(context)) return false;
    this.activeRoomRun = null;
    this.identityCache.replaceOnlineSnapshot([]);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleToken += 1;
    this.activeRoomRun = null;
    this.identityCache.replaceOnlineSnapshot([]);
    this.subscriptions.clear();
    this.profileRequests.clear();
    this.profileFailures.clear();
  }

  mergeRoomIdentity(
    record,
    roomIdentity,
    context,
    source,
    observedAt,
    changed,
  ) {
    if (
      !roomIdentity ||
      context.roomIdentityVerified !== true ||
      !this.roomScope
    )
      return;
    if (roomIdentity.guardKnown === true) {
      const value = normalizeGuardLevel(roomIdentity.guardLevel);
      const incoming = roomEvidence(value, source, observedAt);
      if (shouldReplaceRoomField(record.room.guard, incoming, observedAt)) {
        if (!record.room.guard || record.room.guard.value !== value)
          changed.add('guard');
        record.room.guard = incoming;
      }
    }
    if (roomIdentity.medalKnown !== true) return;

    let value = null;
    if (
      roomIdentity.fansMedal !== null &&
      roomIdentity.fansMedal !== undefined
    ) {
      value = normalizeFansMedal(roomIdentity.fansMedal);
      if (!value || value.targetUid !== this.roomScope.ownerUid) {
        this.recordDiagnostic('medal-owner-mismatch', record.uid);
        return;
      }
    }
    const incoming = roomEvidence(value, source, observedAt);
    if (shouldReplaceRoomField(record.room.fansMedal, incoming, observedAt)) {
      if (
        !record.room.fansMedal ||
        !sameValue(record.room.fansMedal.value, value)
      ) {
        changed.add('fansMedal');
      }
      record.room.fansMedal = incoming;
    }
  }

  project(record, selection) {
    const snapshot = { uid: record.uid };
    for (const field of selection.fields) {
      if (field === 'name' && record.name) snapshot.name = record.name;
      if (field === 'avatarUrl' && record.avatarUrl)
        snapshot.avatarUrl = record.avatarUrl;
    }
    const wantsRoom = selection.fields.some((field) =>
      ROOM_FIELDS.includes(field),
    );
    if (wantsRoom && this.roomScope) {
      snapshot.room = {
        roomId: this.roomScope.roomId,
        ownerUid: this.roomScope.ownerUid,
      };
      if (selection.fields.includes('guard')) {
        snapshot.guard = record.room.guard
          ? { known: true, level: record.room.guard.value }
          : { known: false };
      }
      if (selection.fields.includes('fansMedal')) {
        snapshot.fansMedal = record.room.fansMedal
          ? { known: true, value: cloneValue(record.room.fansMedal.value) }
          : { known: false };
      }
    }
    if (!selection.explicit) snapshot.updatedAt = record.updatedAt;
    return snapshot;
  }

  notify(record, changedFields) {
    for (const subscription of [...this.subscriptions]) {
      if (!subscription.active) continue;
      if (
        subscription.roomId &&
        (!this.roomScope ||
          subscription.roomId !== this.roomScope.roomId ||
          subscription.generation !== this.roomScope.generation)
      ) {
        subscription.active = false;
        this.subscriptions.delete(subscription);
        continue;
      }
      const projectedChanges = changedFields.filter((field) =>
        subscription.selection.fields.includes(field),
      );
      if (projectedChanges.length === 0) continue;
      try {
        subscription.listener({
          type: 'user-info:updated',
          uid: record.uid,
          changedFields: projectedChanges,
          snapshot: this.project(record, subscription.selection),
        });
      } catch (error) {
        this.recordDiagnostic('subscriber-failed', record.uid, error);
      }
    }
  }

  matchesRequestedRoom(roomId) {
    if (roomId === undefined) return true;
    const requested = cleanText(roomId);
    return Boolean(
      this.roomScope && requested && this.roomScope.roomId === requested,
    );
  }

  matchesActiveRun(context) {
    if (!this.activeRoomRun) return false;
    return (
      cleanText(context.roomId) === this.activeRoomRun.roomId &&
      normalizeUid(context.ownerUid) === this.activeRoomRun.ownerUid &&
      Number(context.generation) === this.activeRoomRun.generation &&
      Number(context.runToken) === this.activeRoomRun.runToken
    );
  }

  storeCompatibilityRecord(record, recent) {
    const medal = record.room.fansMedal && record.room.fansMedal.value;
    this.identityCache.storeMerged(
      {
        uid: record.uid,
        userName: record.name,
        avatarUrl: record.avatarUrl,
        guardLevel: record.room.guard ? record.room.guard.value : 0,
        medalName: medal ? medal.name : '',
        medalLevel: medal ? medal.level : 0,
        seenAt: record.seenAt,
      },
      { recent },
    );
  }

  cleanupExpired() {
    const cutoff = this.now() - USER_INFO_TTL_MS;
    for (const [uid, record] of this.records) {
      if (record.seenAt >= cutoff) continue;
      this.records.delete(uid);
      this.identityCache.deleteMerged(uid);
    }
    this.identityCache.cleanup();
  }

  recordDiagnostic(kind, uid, error) {
    const entry = {
      kind,
      uid: cleanText(uid),
      message: cleanText(error && error.message),
    };
    if (typeof this.diagnostics === 'function') {
      this.diagnostics(entry);
    } else if (
      this.diagnostics &&
      typeof this.diagnostics.record === 'function'
    ) {
      this.diagnostics.record(entry);
    }
  }
}

module.exports = {
  UserInfoService,
  normalizeFields,
};
