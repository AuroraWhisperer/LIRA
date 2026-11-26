'use strict';

const { createPublicError } = require('../shared/public-error');

const { createHash } = require('node:crypto');
const { profilePatch, identity, identityKey, timestamp, recordData, entrySnapshot, text } = require('./validation');
const { DAY_MS, dateValue, dayStart } = require('./dates');
const { normalizeGuardAccompany, accompanySettings } = require('./guard-accompany');
const { validateSongSummary, summarizeSongs, songIdentity, LEGACY_SONG_GROUP_PREFIX } = require('./song-summary');

const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const MAX_BACKUP_PROFILES = 10000;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function retainedSongLookup(profiles) {
  const byId = new Map();
  const mergesBySource = new Map();
  for (const profile of profiles) {
    const songs = new Set();
    for (const record of profile.records.filter(record => record.kind === 'song')) {
      songs.add(songIdentity(record.data));
      const ids = new Set([record.id, ...(record.data.mergedRecordIds || [])]);
      for (const id of ids) byId.set(id, ids);
    }
    for (const merge of profile.merges || []) {
      if (!mergesBySource.has(merge.sourceId)) mergesBySource.set(merge.sourceId, []);
      mergesBySource.get(merge.sourceId).push({ merge, songs });
    }
  }
  return (profileId, record, backup) => {
    const lineage = record.data.mergedRecordIds || [];
    const ids = [record.id, ...lineage];
    const owner = byId.get(ids.find(id => byId.has(id)));
    if (owner) {
      // Older aggregates can prove individual IDs even without the later group tag.
      if (owner.has(record.id) && lineage.every(id => owner.has(id) ||
        (id.startsWith(LEGACY_SONG_GROUP_PREFIX) && !byId.has(id)))) return true;
      throw createPublicError('备份点歌汇总与本机记录部分重叠，无法安全合并。请核对后选择完整替换或恢复本机恢复点。');
    }
    // Pre-upgrade summaries may have lost every ID present in an older v1 file.
    const key = songIdentity(record.data);
    for (const { merge, songs } of mergesBySource.get(profileId) || []) {
      if (!songs.has(key)) continue;
      if (merge.songsTracked !== true && backup.version === 2 && !lineage.length &&
          Date.parse(backup.exportedAt) <= Date.parse(merge.mergedAt)) return true;
      if (merge.songsTracked !== true || lineage.some(id => id.startsWith(LEGACY_SONG_GROUP_PREFIX)))
        throw createPublicError('旧版合并缺少点歌来源标识，无法确认这份备份是否重复。请使用合并前备份并选择完整替换，或恢复本机恢复点。');
    }
    return false;
  };
}

function createFanBackupService({ store, now, detail, requireProfile }) {
  function backup(scope) {
    store.records.pruneSongCounts(now(), scope);
    return {
      format: 'lira-fan-profiles',
      version: 2,
      scope,
      exportedAt: now(),
      ...store.exportScope(scope),
    };
  }

  function validateBackup(scope, input, { fileImport = true } = {}) {
    if (
      !input ||
      input.format !== 'lira-fan-profiles' ||
      ![1, 2].includes(input.version) ||
      input.scope !== scope ||
      !Array.isArray(input.profiles) ||
      (fileImport && input.profiles.length > MAX_BACKUP_PROFILES) ||
      !Array.isArray(input.suppressions)
    ) {
      throw createPublicError('备份格式无效或归属不匹配。请切换到备份所属服务器和主播账号后恢复。');
    }
    const profileIds = new Set();
    const recordIds = new Set();
    const sourceKeys = new Set();
    accompanySettings(input.settings);
    const identityKeys = new Set();
    const profiles = [];
    for (const profile of input.profiles) {
      if (typeof profile.id !== 'string' || profileIds.has(profile.id)) throw createPublicError('备份中有重复或无效档案。');
      profileIds.add(profile.id);
      const patch = profilePatch(profile);
      const lastEntry = entrySnapshot(profile.lastEntry);
      let excludedFormerNames;
      if (profile.excludedFormerNames !== undefined) {
        if (!Array.isArray(profile.excludedFormerNames)) throw createPublicError('备份中的曾用名排除记录无效。');
        excludedFormerNames = [...new Set(profile.excludedFormerNames.map(name => text(name, '曾用名', 200)).filter(Boolean))];
      }
      if (profile.guardAccompany != null && !normalizeGuardAccompany(profile.guardAccompany))
        throw createPublicError('备份中的平台陪伴天数无效。');
      let roster = profile.guardRoster;
      if (roster !== undefined && roster !== null) {
        if (
          !roster ||
          typeof roster !== 'object' ||
          Array.isArray(roster) ||
          typeof roster.roomId !== 'string' ||
          !/^[1-9]\d{0,19}$/.test(roster.roomId) ||
          typeof roster.ownerUid !== 'string' ||
          !/^[1-9]\d{0,19}$/.test(roster.ownerUid) ||
          ![null, 1, 2, 3].includes(roster.level)
        )
          throw createPublicError('备份中的大航海名单状态无效。');
        const observedAt = timestamp(roster.observedAt, '大航海名单同步时间');
        roster = { ...roster, observedAt };
        if (roster.lastAbsentAt !== undefined) {
          roster.lastAbsentAt = timestamp(roster.lastAbsentAt, '上次确认缺席时间');
          if (roster.lastAbsentAt > observedAt) throw createPublicError('上次确认缺席时间晚于名单同步时间。');
        }
      }
      const records = [];
      profiles.push({ ...profile, records, identity: patch.identity,
        ...(roster ? { guardRoster: roster } : {}),
        ...(profile.lastEntry !== undefined ? { lastEntry } : {}),
        ...(profile.preferredFormerName !== undefined ? { preferredFormerName: patch.preferredFormerName } : {}),
        ...(excludedFormerNames ? { excludedFormerNames } : {}),
      });
      const key = identityKey(patch.identity);
      if (key && identityKeys.has(key)) throw createPublicError('备份中同一身份重复。');
      if (key) identityKeys.add(key);
      if (!Array.isArray(profile.records) || !Array.isArray(profile.reminders)) throw createPublicError('备份缺少完整记录。');
      for (const record of profile.records) {
        const summary = record.kind === 'song' && input.version === 2;
        const validated = recordData(record.kind, summary ? { ...record.data, note: '' } : record.data);
        // Restore the effective interval while preserving the source evidence, decisions and revisions.
        records.push(record.kind === 'membership' && validated.type === 'interval'
          ? { ...record, data: { ...record.data, startAt: validated.startAt, endAt: validated.endAt } }
          : record);
        if (summary && typeof record.data.note !== 'string') throw createPublicError('备份中的点歌说明无效。');
        if (record.kind === 'song' && input.version === 2) validateSongSummary(record.data);
        if (record.kind === 'song' && input.version === 1 && Object.hasOwn(record.data, 'count'))
          throw createPublicError('点歌汇总需要第 2 版备份格式。');
        timestamp(record.occurredAt);
        if (!record.original || !Array.isArray(record.revisions) || typeof record.id !== 'string')
          throw createPublicError('备份缺少原始依据或修订。');
        if (recordIds.has(record.id) || (record.sourceKey && sourceKeys.has(record.sourceKey)))
          throw createPublicError('备份中有重复记录。');
        recordIds.add(record.id);
        if (record.sourceKey) sourceKeys.add(record.sourceKey);
      }
      for (const state of profile.reminders) {
        if (typeof state.key !== 'string' || !['pending', 'handled', 'ignored', 'snoozed'].includes(state.status))
          throw createPublicError('备份提醒状态无效。');
      }
    }
    const suppressions = [];
    for (const key of input.suppressions) {
      let parts;
      try {
        if (typeof key !== 'string' || key.length > 300) throw new Error();
        parts = JSON.parse(key);
        if (!Array.isArray(parts) || parts.length !== 3) throw new Error();
        const value = identity({ platform: parts[0], type: parts[1], value: parts[2] });
        if (!value) throw new Error();
        suppressions.push(identityKey(value));
      } catch (_) {
        throw createPublicError('备份抑制标记无效。');
      }
    }
    return { ...input, profiles, suppressions };
  }

  function preview(scope, value) {
    const conflicts = [];
    let added = 0;
    for (const profile of value.profiles) {
      const current =
        store.get(scope, profile.id) || (profile.identity && store.byIdentity(scope, identityKey(profile.identity)));
      if (current)
        conflicts.push({
          incomingId: profile.id,
          existingId: current.id,
          name: current.alias || current.platformName,
          revision: current.revision,
        });
      else added++;
    }
    const current = store.exportScope(scope);
    const { cursor, epoch, synchronizedAt, coverageSince, syncStatus, ...settings } = current.settings;
    const suppressionConflicts = current.profiles.filter(profile => {
      const key = identityKey(profile.identity);
      return key && value.suppressions.includes(key) && !current.suppressions.includes(key);
    }).map(profile => ({ existingId: profile.id, name: profile.alias || profile.platformName }));
    return {
      added,
      updated: conflicts.length,
      conflicts,
      suppressionConflicts,
      scope,
      digest: digest(value),
      currentDigest: digest({ ...current, settings }),
    };
  }

  function restore(scope, input) {
    const value = validateBackup(scope, input.backup);
    const plan = preview(scope, value);
    if (
      input.digest !== plan.digest ||
      input.currentDigest !== plan.currentDigest ||
      !['keep', 'replace'].includes(input.conflicts)
    ) {
      throw createPublicError('恢复预览已变化，请重新核对并选择冲突处理方式。');
    }
    const conflicts = new Set(plan.conflicts.map((item) => item.incomingId));
    const profiles = value.profiles.filter((profile) => input.conflicts === 'replace' || !conflicts.has(profile.id));
    const replacedIds = new Set(input.conflicts === 'replace' ? plan.conflicts.map((item) => item.existingId) : []);
    const identityKeys = new Set(store.list(scope, { includeSuppressed: true })
      .filter((profile) => !replacedIds.has(profile.id))
      .map((profile) => identityKey(profile.identity)).filter(Boolean));
    const retainedIdentityKeys = new Set(identityKeys);
    for (const profile of profiles) {
      const key = identityKey(profile.identity);
      if (key && identityKeys.has(key)) throw createPublicError('恢复后的身份与保留档案冲突，请重新核对备份。');
      if (key) identityKeys.add(key);
    }
    const before = backup(scope);
    const retainedRecordIds = new Set();
    const retainedSourceKeys = new Set();
    const keepsSong = input.conflicts === 'keep' && retainedSongLookup(before.profiles);
    if (input.conflicts === 'keep') {
      for (const profile of before.profiles) {
        for (const record of profile.records) {
          if (record.kind === 'song') continue;
          retainedRecordIds.add(record.id);
          if (record.sourceKey) retainedSourceKeys.add(record.sourceKey);
        }
      }
    }
    const snapshotId = store.snapshot(scope, before, now());
    store.removeMany(scope, [...replacedIds]);
    for (const profile of profiles) {
      const { records, reminders, ...data } = profile;
      const restored = store.restoreProfile(scope, data, identityKey(data.identity), now());
      const retainedElsewhere = new Set();
      for (const record of restoredRecords(scope, restored.id, records, value.version)) {
        if (record.kind === 'song') {
          if (keepsSong && keepsSong(profile.id, record, value)) continue;
        } else if (retainedRecordIds.has(record.id) || retainedSourceKeys.has(record.sourceKey)) {
          retainedElsewhere.add(record.id);
          continue;
        }
        store.records.insert(scope, restored.id, record, now());
      }
      for (const state of reminders) {
        const [kind, recordId] = state.key.split(':', 2);
        if (['anniversary', 'followup', 'expiry'].includes(kind) && retainedElsewhere.has(recordId)) continue;
        store.saveState(scope, restored.id, state.key, state);
      }
    }
    for (const key of value.suppressions) {
      if (input.conflicts === 'keep' && retainedIdentityKeys.has(key)) continue;
      store.suppress(scope, key);
    }
    // Preserve the current recovery cursor. Replayed facts are independently
    // deduplicated by source key; restoring never claims newer remote coverage.
    const existing = store.getScope(scope);
    store.saveScope(scope, {
      ...existing,
      ...accompanySettings(value.settings),
      initialized: value.settings?.initialized === true || existing.initialized,
      autoUpdate: value.settings?.autoUpdate !== false,
      autoCreate: value.settings?.autoCreate !== false,
      autoSyncGuardRoster: value.settings?.autoSyncGuardRoster === true,
    });
    return {
      snapshotId,
      added: plan.added,
      updated: input.conflicts === 'replace' ? plan.updated : 0,
    };
  }

  function restoredRecords(scope, profileId, records, version) {
    for (const record of records) {
      if (record.kind === 'song' && record.sourceKey?.startsWith('request:'))
        store.markSongRequest(scope, record.sourceKey.slice('request:'.length));
    }
    return version === 1 ? [
      ...records.filter(record => record.kind !== 'song'),
      ...summarizeSongs(records.filter(record => record.kind === 'song'), now(), [scope, profileId]),
    ] : records;
  }

  function legacyPreview(scope, input) {
    const profile = requireProfile(scope, input.profileId);
    if (profile.identity?.type !== 'uid') throw createPublicError('旧点歌补录需要明确的 B 站 UID。');
    const from = dateValue(input.from, '开始日期', false);
    const to = dateValue(input.to, '结束日期', false);
    if (from > to) throw createPublicError('补录开始日期不能晚于结束日期。');
    const rows = store
      .legacy(
        scope,
        profile.identity.value,
        new Date(dayStart(from)).toISOString(),
        new Date(dayStart(to) + DAY_MS).toISOString(),
      )
      .filter((r) => !r.identityType || r.identityType === 'uid');
    return {
      count: rows.length,
      unownedCount: rows.filter((r) => !r.scope).length,
      from,
      to,
      digest: digest(rows),
      records: rows,
    };
  }

  function legacyImport(scope, input) {
    const plan = legacyPreview(scope, input);
    if (input.confirmOwnership !== true || plan.digest !== input.digest)
      throw createPublicError('请先确认旧点歌记录归属和范围。');
    for (const row of plan.records) {
      const stableId = store.claimRequest(row.id, scope);
      if (/^random(?::|$)/.test(row.source) || !store.markSongRequest(scope, stableId)) continue;
      const data = {
        songName: row.songName,
        artist: row.artist,
        category: row.category,
        excludeFromStats: /^random/.test(row.source),
        excluded: false,
        note: '',
      };
      store.records.insert(scope, input.profileId, {
        kind: 'song',
        data,
        occurredAt: row.occurredAt,
        sourceKey: `request:${stableId}`,
        original: {
          ...row,
          source: 'confirmed-local-history',
          stableId,
          ownershipConfirmedAt: now(),
        },
      }, now());
    }
    return detail(scope, input.profileId);
  }

  function exportList(scope, input) {
    const allowed = ['alias', 'platformName', 'uid', 'summary', 'birthday', 'mbti', 'notes'];
    const fields = input.fields || ['alias', 'platformName', 'uid'];
    if (!Array.isArray(fields) || !fields.length || fields.some((field) => !allowed.includes(field)))
      throw createPublicError('导出字段无效。');
    const escape = (value) => {
      const cell = String(value ?? '');
      return `"${(/^[=+\-@\t\r]/.test(cell) ? "'" : '') + cell.replace(/"/g, '""')}"`;
    };
    const rows = store
      .list(scope)
      .filter((p) => !p.archived)
      .map((p) => ({
        ...p,
        uid: p.identity?.type === 'uid' ? p.identity.value : '',
        birthday: p.birthday ? `${p.birthday.calendar === 'lunar' ? `农历${p.birthday.leapMonth ? '闰月' : ''}` : '公历'} ${p.birthday.monthDay}` : '',
      }));
    return '\uFEFF' + [fields.join(','), ...rows.map((p) => fields.map((f) => escape(p[f])).join(','))].join('\r\n');
  }

  function restoreSnapshot(scope, input) {
    const value = validateBackup(scope, store.getSnapshot(scope, input.snapshotId), { fileImport: false });
    const plan = preview(scope, value);
    if (input.confirm !== true || input.digest !== plan.digest || input.currentDigest !== plan.currentDigest) {
      throw createPublicError('恢复点预览已变化，请重新确认。');
    }
    const snapshotId = store.snapshot(scope, { ...backup(scope), reason: '恢复本机恢复点之前' }, now());
    store.removeAll(scope);
    // Restoring older data must not silently unblock an identity.
    for (const { records, reminders, ...profile } of value.profiles) {
      store.restoreProfile(scope, profile, identityKey(profile.identity), now());
      for (const record of restoredRecords(scope, profile.id, records, value.version))
        store.records.insert(scope, profile.id, record, now());
      for (const state of reminders) store.saveState(scope, profile.id, state.key, state);
    }
    for (const key of value.suppressions) store.suppress(scope, key);
    store.saveScope(scope, { ...value.settings, cursor: 0, epoch: null });
    return { snapshotId };
  }

  function execute(scope, action, input) {
    if ((action === 'preview-restore' || action === 'restore') && input.backup &&
        Buffer.byteLength(JSON.stringify(input.backup), 'utf8') > MAX_BACKUP_BYTES) {
      throw createPublicError('完整档案备份超过 16 MB，无法恢复。');
    }
    switch (action) {
      case 'backup': {
        const value = backup(scope);
        if (value.profiles.length > MAX_BACKUP_PROFILES)
          throw createPublicError('完整档案备份最多支持 10000 份档案，本次未导出。');
        if (Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8') > MAX_BACKUP_BYTES)
          throw createPublicError('完整档案备份超过 16 MB，本次未导出，以免生成无法恢复的文件。');
        return value;
      }
      case 'preview-restore':
        return preview(scope, validateBackup(scope, input.backup));
      case 'restore':
        return restore(scope, input);
      case 'snapshots':
        return store.snapshots(scope);
      case 'preview-snapshot':
        return preview(scope, validateBackup(scope, store.getSnapshot(scope, input.snapshotId), { fileImport: false }));
      case 'restore-snapshot':
        return restoreSnapshot(scope, input);
      case 'export-list':
        return exportList(scope, input);
      case 'preview-legacy':
        return legacyPreview(scope, input);
      case 'import-legacy':
        return legacyImport(scope, input);
      default:
        throw createPublicError('不支持的档案操作。');
    }
  }
  return { execute };
}

module.exports = { createFanBackupService, MAX_BACKUP_BYTES };
