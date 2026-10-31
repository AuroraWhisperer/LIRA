'use strict';

const { createHash } = require('node:crypto');
const { profilePatch, identity, identityKey, timestamp, recordData } = require('./validation');
const { DAY_MS, dateValue, dayStart } = require('./dates');
const { normalizeGuardAccompany, accompanySettings } = require('./guard-accompany');
const { validateSongSummary } = require('./song-summary');

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

  function validateBackup(scope, input) {
    if (
      !input ||
      input.format !== 'lira-fan-profiles' ||
      ![1, 2].includes(input.version) ||
      input.scope !== scope ||
      !Array.isArray(input.profiles) ||
      input.profiles.length > 10000 ||
      !Array.isArray(input.suppressions)
    ) {
      throw new Error('备份格式无效或归属不匹配。请切换到备份所属服务器和主播账号后恢复。');
    }
    const profileIds = new Set();
    const recordIds = new Set();
    const sourceKeys = new Set();
    accompanySettings(input.settings);
    const identityKeys = new Set();
    const profiles = [];
    for (const profile of input.profiles) {
      if (typeof profile.id !== 'string' || profileIds.has(profile.id)) throw new Error('备份中有重复或无效档案。');
      profileIds.add(profile.id);
      const patch = profilePatch(profile);
      profiles.push({ ...profile, identity: patch.identity });
      if (profile.guardAccompany != null && !normalizeGuardAccompany(profile.guardAccompany))
        throw new Error('备份中的平台陪伴天数无效。');
      if (profile.guardRoster !== undefined && profile.guardRoster !== null) {
        const roster = profile.guardRoster;
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
          throw new Error('备份中的大航海名单状态无效。');
        timestamp(roster.observedAt, '大航海名单同步时间');
      }
      const key = identityKey(patch.identity);
      if (key && identityKeys.has(key)) throw new Error('备份中同一身份重复。');
      if (key) identityKeys.add(key);
      if (!Array.isArray(profile.records) || !Array.isArray(profile.reminders)) throw new Error('备份缺少完整记录。');
      for (const record of profile.records) {
        const summary = record.kind === 'song' && input.version === 2;
        recordData(record.kind, summary ? { ...record.data, note: '' } : record.data);
        if (summary && typeof record.data.note !== 'string') throw new Error('备份中的点歌说明无效。');
        if (record.kind === 'song' && input.version === 2) validateSongSummary(record.data);
        if (record.kind === 'song' && input.version === 1 && Object.hasOwn(record.data, 'count'))
          throw new Error('点歌汇总需要第 2 版备份格式。');
        timestamp(record.occurredAt);
        if (!record.original || !Array.isArray(record.revisions) || typeof record.id !== 'string')
          throw new Error('备份缺少原始依据或修订。');
        if (recordIds.has(record.id) || (record.sourceKey && sourceKeys.has(record.sourceKey)))
          throw new Error('备份中有重复记录。');
        recordIds.add(record.id);
        if (record.sourceKey) sourceKeys.add(record.sourceKey);
      }
      for (const state of profile.reminders) {
        if (typeof state.key !== 'string' || !['pending', 'handled', 'ignored', 'snoozed'].includes(state.status))
          throw new Error('备份提醒状态无效。');
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
        throw new Error('备份抑制标记无效。');
      }
    }
    return { ...input, profiles, suppressions };
  }

  function preview(scope, input) {
    const value = validateBackup(scope, input.backup);
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
    return {
      added,
      updated: conflicts.length,
      conflicts,
      scope,
      digest: digest(value),
      currentDigest: digest(store.exportScope(scope)),
    };
  }

  function restore(scope, input) {
    const plan = preview(scope, input);
    if (
      input.digest !== plan.digest ||
      input.currentDigest !== plan.currentDigest ||
      !['keep', 'replace'].includes(input.conflicts)
    ) {
      throw new Error('恢复预览已变化，请重新核对并选择冲突处理方式。');
    }
    const value = validateBackup(scope, input.backup);
    const snapshotId = store.snapshot(scope, backup(scope), now());
    for (const profile of value.profiles) {
      const conflict = plan.conflicts.find((item) => item.incomingId === profile.id);
      if (conflict && input.conflicts === 'keep') continue;
      const prior = conflict && store.get(scope, conflict.existingId);
      if (prior) store.remove(scope, prior.id, false);
      const { records, reminders, ...data } = profile;
      const restored = store.restoreProfile(scope, data, identityKey(data.identity), now());
      for (const record of records) {
        store.records.insert(scope, restored.id, record, now());
        if (record.kind === 'song' && record.sourceKey?.startsWith('request:'))
          store.markSongRequest(scope, record.sourceKey.slice('request:'.length));
      }
      for (const state of reminders) {
        store.saveState(scope, restored.id, state.key, state);
      }
    }
    for (const key of value.suppressions) store.suppress(scope, key);
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

  function legacyPreview(scope, input) {
    const profile = requireProfile(scope, input.profileId);
    if (profile.identity?.type !== 'uid') throw new Error('旧点歌补录需要明确的 B 站 UID。');
    const from = dateValue(input.from, '开始日期', false);
    const to = dateValue(input.to, '结束日期', false);
    if (from > to) throw new Error('补录开始日期不能晚于结束日期。');
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
      throw new Error('请先确认旧点歌记录归属和范围。');
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
      throw new Error('导出字段无效。');
    const escape = (value) => {
      const cell = String(value ?? '');
      return `"${(/^[=+\-@\t\r]/.test(cell) ? "'" : '') + cell.replace(/"/g, '""')}"`;
    };
    const rows = store
      .list(scope)
      .filter((p) => !p.archived)
      .map((p) => ({
        ...p,
        uid: p.identity?.value || '',
        birthday: p.birthday?.monthDay || '',
      }));
    return '\uFEFF' + [fields.join(','), ...rows.map((p) => fields.map((f) => escape(p[f])).join(','))].join('\r\n');
  }

  function restoreSnapshot(scope, input) {
    const value = validateBackup(scope, store.getSnapshot(scope, input.snapshotId));
    const plan = preview(scope, { backup: value });
    if (input.confirm !== true || input.digest !== plan.digest || input.currentDigest !== plan.currentDigest) {
      throw new Error('恢复点预览已变化，请重新确认。');
    }
    const snapshotId = store.snapshot(scope, { ...backup(scope), reason: '恢复本机恢复点之前' }, now());
    for (const profile of store.list(scope, { includeSuppressed: true })) store.remove(scope, profile.id, false);
    // Restoring older data must not silently unblock an identity.
    for (const { records, reminders, ...profile } of value.profiles) {
      store.restoreProfile(scope, profile, identityKey(profile.identity), now());
      for (const record of records) {
        store.records.insert(scope, profile.id, record, now());
        if (record.kind === 'song' && record.sourceKey?.startsWith('request:'))
          store.markSongRequest(scope, record.sourceKey.slice('request:'.length));
      }
      for (const state of reminders) store.saveState(scope, profile.id, state.key, state);
    }
    for (const key of value.suppressions) store.suppress(scope, key);
    store.saveScope(scope, { ...value.settings, cursor: 0, epoch: null });
    return { snapshotId };
  }

  function execute(scope, action, input) {
    switch (action) {
      case 'backup':
        return backup(scope);
      case 'preview-restore':
        return preview(scope, input);
      case 'restore':
        return restore(scope, input);
      case 'snapshots':
        return store.snapshots(scope);
      case 'preview-snapshot':
        return preview(scope, {
          backup: store.getSnapshot(scope, input.snapshotId),
        });
      case 'restore-snapshot':
        return restoreSnapshot(scope, input);
      case 'export-list':
        return exportList(scope, input);
      case 'preview-legacy':
        return legacyPreview(scope, input);
      case 'import-legacy':
        return legacyImport(scope, input);
      default:
        throw new Error('不支持的档案操作。');
    }
  }
  return { execute };
}

module.exports = { createFanBackupService };
