'use strict';

const { createPublicError } = require('../shared/public-error');

const { identity, identityKey, timestamp, recordData } = require('./validation');
const { dayOf } = require('./dates');
const { normalizeGuardAccompany, newerGuardAccompany } = require('./guard-accompany');

function getGuardRoster(profile, records) {
  const roster = profile.guardRoster;
  if (roster) {
    // Absence has no source record; active snapshots may be newer than same-day deduplicated evidence.
    const source = roster.level === null ? null : records
      .filter(({ original }) => original.evidence === 'guard-roster' &&
        original.roomId === roster.roomId && original.ownerUid === roster.ownerUid &&
        original.observedAt <= roster.observedAt)
      .sort((a, b) => b.original.observedAt.localeCompare(a.original.observedAt))[0]?.original;
    if (!source || source.level !== roster.level || !identityKey(source.identity) ||
      identityKey(source.identity) === identityKey(profile.identity)) return roster;
  }
  const latest = getLatestGuardRosterObservation(profile, records);
  return latest
    ? {
        roomId: latest.roomId,
        ownerUid: latest.ownerUid,
        observedAt: latest.observedAt,
        level: latest.status === 'inactive' ? null : latest.level,
      }
    : null;
}

function getLatestGuardRosterObservation(profile, records) {
  const key = identityKey(profile.identity);
  if (!key) return null;
  return records
    .filter((record) => record.original.evidence === 'guard-roster' && identityKey(record.original.identity) === key)
    .sort((a, b) => b.original.observedAt.localeCompare(a.original.observedAt))[0]?.original || null;
}

function createGuardRosterImporter({ store, create, observedProfile, saveObservation }) {
  return function importGuardRoster(scope, snapshot, automaticDate, refresh) {
    if (
      !snapshot ||
      !/^[1-9]\d{0,19}$/.test(snapshot.roomId) ||
      !/^[1-9]\d{0,19}$/.test(snapshot.ownerUid) ||
      !Array.isArray(snapshot.members) ||
      snapshot.members.length > 10000 ||
      !Number.isSafeInteger(snapshot.skipped) ||
      snapshot.skipped < 0
    )
      throw createPublicError('大航海名单格式无效。');
    const observedAt = timestamp(snapshot.observedAt);
    return store.transaction(() => {
      const suppressed = new Set(store.suppressions(scope));
      function saveRoster(profile, previous, level, accompanyDays, observation) {
        if (previous && previous.observedAt > observedAt) {
          if (observation) saveObservation(scope, profile, observation);
          return;
        }
        const accompany = normalizeGuardAccompany({
          days: accompanyDays, roomId: snapshot.roomId, observedAt, source: 'guard-roster',
        });
        if (accompanyDays !== undefined && !accompany) throw createPublicError('平台陪伴天数无效。');
        const lastAbsentAt = previous && (previous.level === null || previous.roomId !== snapshot.roomId)
          ? previous.observedAt : previous?.lastAbsentAt;
        store.save(
          scope,
          {
            ...(observation ? observedProfile(profile, observation) : profile),
            ...(accompany ? { guardAccompany: newerGuardAccompany(profile.guardAccompany, accompany) } : {}),
            guardRoster: {
              roomId: snapshot.roomId,
              ownerUid: snapshot.ownerUid,
              observedAt,
              level,
              ...(level !== null && !accompany && lastAbsentAt ? { lastAbsentAt } : {}),
            },
          },
          identityKey(profile.identity),
          observedAt,
        );
      }
      const result = {
        roomId: snapshot.roomId,
        ownerUid: snapshot.ownerUid,
        total: snapshot.members.length + snapshot.skipped,
        created: 0,
        updated: 0,
        skipped: snapshot.skipped,
        skippedDetails: [...(snapshot.skippedDetails || [])],
      };
      const seen = new Set();
      function* readMembers() {
        for (let offset = 0; offset < snapshot.members.length; offset += 500) {
          const batch = snapshot.members.slice(offset, offset + 500).map(member => ({
            member, person: identity({ platform: 'bilibili', type: 'uid', value: member.uid }),
          }));
          const profiles = store.byIdentities(scope, batch.map(({ person }) => identityKey(person)));
          const histories = store.records.listMembershipForProfiles(scope, [...profiles.values()].map(profile => profile.id));
          for (const { member, person } of batch) {
            const profile = profiles.get(identityKey(person));
            yield { member, person, profile, records: histories.get(profile?.id) || [] };
          }
        }
      }
      for (const { member, person, profile: existing, records } of readMembers()) {
        if (!person) throw createPublicError('大航海名单缺少可靠 UID。');
        const key = identityKey(person);
        if (seen.has(key)) throw createPublicError('大航海名单存在重复 UID。');
        seen.add(key);
        const medalLevel = member.medalLevel ?? null;
        if (medalLevel !== null && (!Number.isSafeInteger(medalLevel) || medalLevel < 0))
          throw createPublicError('粉丝灯牌等级无效。');
        const data = recordData('membership', {
          type: 'observation',
          level: member.level,
          observedAt,
          reason: `${automaticDate ? '自动' : '手动'}同步房间 ${snapshot.roomId} 的大航海名单；仅确认同步时的等级，起止日期待补充。`,
        });
        let profile = existing;
        if (profile?.archived || suppressed.has(key)) {
          result.skipped++;
          result.skippedDetails.push({
            uid: member.uid,
            name: profile?.alias || member.name || profile?.platformName || '',
            reason: profile?.archived ? 'archived' : 'suppressed',
          });
          continue;
        }
        if (!profile) {
          profile = create(scope, { identity: person }, true);
          result.created++;
        } else {
          result.updated++;
        }
        saveRoster(profile, getGuardRoster(profile, records), member.level, member.accompanyDays, {
          name: member.name, avatar: member.avatar, nameComplete: Boolean(member.name), observedAt,
        });
        const previous = records.find(
          (record) =>
            record.original.evidence === 'guard-roster' &&
            record.original.roomId === snapshot.roomId &&
            identityKey(record.original.identity) === key,
        );
        if (
          previous?.original.level === member.level &&
          (previous.original.medalLevel ?? null) === medalLevel &&
          dayOf(previous.original.observedAt) === dayOf(observedAt)
        )
          continue;
        data.cycleId = profile.cycleId;
        store.records.insert(scope, profile.id, {
          kind: 'membership',
          data,
          occurredAt: observedAt,
          sourceKey: `guard-roster:${snapshot.roomId}:${person.value}:${observedAt}:${member.level}:${medalLevel ?? ''}`,
          original: {
            ...data,
            source: 'platform',
            evidence: 'guard-roster',
            roomId: snapshot.roomId,
            ownerUid: snapshot.ownerUid,
            medalLevel,
            identity: person,
          },
        });
      }
      // Hidden identities cannot be matched to existing profiles, so their
      // absence from the visible members does not prove they left the roster.
      if (snapshot.skipped === 0) {
        const absent = store.list(scope).filter(profile => !profile.archived && profile.identity?.platform === 'bilibili'
          && profile.identity.type === 'uid' && !seen.has(identityKey(profile.identity)));
        for (let offset = 0; offset < absent.length; offset += 500) {
          const batch = absent.slice(offset, offset + 500);
          const histories = store.records.listMembershipForProfiles(scope, batch.map(profile => profile.id));
          for (const profile of batch) {
            const previous = getGuardRoster(profile, histories.get(profile.id) || []);
            if (previous && (previous.roomId !== snapshot.roomId || previous.level === null &&
              previous.ownerUid === snapshot.ownerUid && previous.observedAt === observedAt)) continue;
            saveRoster(profile, previous, null);
          }
        }
      }
      if (refresh) {
        result.profileRefresh = { updated: 0, failed: refresh.failed, skipped: 0 };
        for (const observation of refresh.observations) {
          const profile = store.get(scope, observation.id);
          const key = identityKey(observation.identity);
          // The UID may have been rebound, deleted or archived while the lookup was pending.
          if (!profile || profile.archived || identityKey(profile.identity) !== key || suppressed.has(key)) {
            result.profileRefresh.skipped++;
            continue;
          }
          const updated = saveObservation(scope, profile, observation);
          if (updated.platformObservedAt !== profile.platformObservedAt) result.profileRefresh.updated++;
          else result.profileRefresh.skipped++;
        }
      }
      if (automaticDate) {
        store.saveScope(scope, {
          ...store.getScope(scope),
          lastGuardRosterAutoUpdate: {
            date: automaticDate,
            roomId: snapshot.roomId,
          },
        });
      }
      return result;
    });
  };
}

module.exports = { createGuardRosterImporter, getGuardRoster, getLatestGuardRosterObservation };
