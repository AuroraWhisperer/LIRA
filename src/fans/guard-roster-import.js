'use strict';

const {
  identity,
  identityKey,
  timestamp,
  recordData,
} = require('./validation');
const { dayOf } = require('./dates');

function createGuardRosterImporter({ store, create, observe }) {
  return function importGuardRoster(scope, snapshot) {
    if (
      !snapshot ||
      !/^[1-9]\d{0,19}$/.test(snapshot.roomId) ||
      !/^[1-9]\d{0,19}$/.test(snapshot.ownerUid) ||
      !Array.isArray(snapshot.members) ||
      snapshot.members.length > 10000 ||
      !Number.isSafeInteger(snapshot.skipped) ||
      snapshot.skipped < 0
    )
      throw new Error('大航海名单格式无效。');
    const observedAt = timestamp(snapshot.observedAt);
    return store.transaction(() => {
      const result = {
        roomId: snapshot.roomId,
        ownerUid: snapshot.ownerUid,
        total: snapshot.members.length + snapshot.skipped,
        created: 0,
        updated: 0,
        skipped: snapshot.skipped,
      };
      const seen = new Set();
      for (const member of snapshot.members) {
        const person = identity({
          platform: 'bilibili',
          type: 'uid',
          value: member.uid,
        });
        if (!person) throw new Error('大航海名单缺少可靠 UID。');
        const key = identityKey(person);
        if (seen.has(key)) throw new Error('大航海名单存在重复 UID。');
        seen.add(key);
        const medalLevel = member.medalLevel ?? null;
        if (
          medalLevel !== null &&
          (!Number.isSafeInteger(medalLevel) || medalLevel < 0)
        )
          throw new Error('粉丝灯牌等级无效。');
        const data = recordData('membership', {
          type: 'observation',
          level: member.level,
          observedAt,
          reason: `手动同步房间 ${snapshot.roomId} 的大航海名单；仅确认同步时的等级，起止日期待补充。`,
        });
        let profile = store.byIdentity(scope, key);
        if (profile?.archived || store.suppressed(scope, key)) {
          result.skipped++;
          continue;
        }
        if (!profile) {
          profile = create(scope, { identity: person }, true);
          result.created++;
        } else {
          result.updated++;
        }
        observe(
          scope,
          {
            identity: person,
            name: member.name,
            avatar: member.avatar,
            nameComplete: Boolean(member.name),
            observedAt,
          },
          false,
          true,
        );
        const previous = store.records
          .list(scope, profile.id)
          .find(
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
      return result;
    });
  };
}

module.exports = { createGuardRosterImporter };
