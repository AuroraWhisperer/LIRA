'use strict';

const { createPublicError } = require('../shared/public-error');

const { randomUUID } = require('node:crypto');
const { text, timestamp, identity, identityKey, profilePatch, recordData, recentNameHistory } = require('./validation');
const { DAY_MS, dayOf, dayStart, addDays, zodiacFor } = require('./dates');
const { REMINDER_HISTORY_DAYS } = require('./reminders');
const { membershipConflicts, cycleForNewRecord, intervalCycleOnDate, updatesCurrentCycle } = require('./membership');
const { createFanProfileProjection } = require('./profile-projection');
const { createFanBackupService, MAX_BACKUP_BYTES } = require('./profile-transfer');
const { createFanFactConsumer } = require('./profile-facts');
const { createFanMergeService } = require('./profile-merge');
const { createGuardRosterImporter, getGuardRoster, getLatestGuardRosterObservation } = require('./guard-roster-import');
const { accompanySettings, getGuardAccompany } = require('./guard-accompany');
const { SONG_STATS_DAYS, recentSongCounts } = require('./song-summary');

function createFanProfileService({ store, now = () => new Date().toISOString() }) {
  const project = createFanProfileProjection();
  function requireProfile(scope, id) {
    const profile = store.get(scope, text(id, '档案 ID', 100));
    if (!profile) throw createPublicError('档案不存在或不属于当前账号。');
    requireAllowedIdentity(scope, profile.identity);
    return profile;
  }

  function requireAllowedIdentity(scope, person) {
    if (person && store.suppressed(scope, identityKey(person)))
      throw createPublicError('该粉丝已加入黑名单，请先在档案设置中解除屏蔽。');
  }

  function create(scope, input, automatic = false) {
    const patch = profilePatch(input);
    requireAllowedIdentity(scope, patch.identity);
    if (!patch.alias && !automatic) throw createPublicError('请填写常用称呼。');
    const at = now();
    return store.save(
      scope,
      {
        alias: '',
        summary: '',
        notes: '',
        tags: [],
        birthday: null,
        mbti: '',
        favorite: false,
        archived: false,
        milestoneReminders: true,
        expiryReminders: false,
        platformName: '',
        platformObservedAt: '',
        nameHistory: [],
        avatar: '',
        cycleId: randomUUID(),
        createdAt: at,
        ...patch,
      },
      identityKey(patch.identity),
      at,
    );
  }

  function detail(scope, id) {
    const profile = requireProfile(scope, id);
    store.records.pruneSongCounts(now(), scope, id);
    const records = store.records.list(scope, id);
    const { membership, reminders } = project(scope, profile, records, store.states(scope, id),
      Date.parse(now()), store.getScope(scope), 366);
    const guardRoster = getGuardRoster(profile, records);
    const songs = records.filter((record) => record.kind === 'song' && record.data.count > 0);
    const preferences = records.filter((record) => record.kind === 'preference' && !record.data.archived);
    const categories = Object.create(null);
    let songCount = 0;
    for (const song of songs) {
      for (const item of recentSongCounts(song.data.dailyCounts, now())) {
        categories[item.category] = (categories[item.category] || 0) + item.count;
        songCount += item.count;
      }
    }
    return {
      ...profile,
      formerName: profile.preferredFormerName || profile.lastEntry?.name || '',
      formerNames: recentNameHistory(profile.nameHistory, profile.platformName)
        .reverse()
        .map((item) => item.name),
      zodiacHint: profile.zodiac || zodiacFor(profile.birthday),
      records,
      songs,
      preferences,
      membership,
      guardRoster,
      guardAccompany: getGuardAccompany(profile, Date.parse(now())),
      currentGuardLevel: guardRoster ? guardRoster.level : membership.level,
      musicSummary: preferences.length
        ? preferences
            .map((r) => `${r.data.sentiment === 'like' ? '喜欢' : '不喜欢'}${r.data.label}`)
            .slice(0, 2)
            .join('；')
        : songs.length
          ? `最近点歌《${songs[0].data.songName}》`
          : '',
      musicStats: {
        days: SONG_STATS_DAYS,
        count: songCount,
        categories,
      },
      reminders,
    };
  }

  function saveRecord(scope, input) {
    let profile = requireProfile(scope, input.profileId);
    const records = store.records.list(scope, profile.id);
    const previous = input.id ? records.find((r) => r.id === input.id) : null;
    if (input.id && !previous) throw createPublicError('记录不存在。');
    if (previous && previous.revision !== input.revision) throw createPublicError('记录已更新，请重新打开后核对。');
    const kind = previous?.kind || input.kind;
    if (kind === 'song' && previous) throw createPublicError('点歌已合并为汇总，不再保存或编辑逐次记录。');
    const data = recordData(kind, input.data || {});
    if (kind === 'membership') {
      const excluded = input.data?.excluded ?? previous?.data.excluded;
      if (excluded !== undefined) data.excluded = excluded === true;
    }
    const occurredAt = timestamp(input.occurredAt || (kind === 'membership' && previous?.occurredAt) || now());
    let record = {
      id: previous?.id,
      kind,
      data,
      occurredAt,
      revision: previous?.revision,
      original: previous?.original || { ...data, occurredAt, source: 'manual' },
    };
    if (kind === 'membership' && previous &&
        Object.keys(data).every(key => key === 'decision' || key === 'reason' || data[key] === previous.data[key])) {
      record.data = { ...previous.data, reason: data.reason };
    } else if (kind === 'membership' && (data.excluded || ['superseded', 'rejected'].includes(previous?.data.decision))) {
      // Keep excluded and historical evidence out of adoption when it is edited.
      data.decision = previous?.data.decision || data.decision;
      data.cycleId = previous?.data.cycleId || profile.cycleId;
      data.conflicts = previous?.data.conflicts || [];
      if (previous?.data.resolvedAt) data.resolvedAt = previous.data.resolvedAt;
    } else if (kind === 'membership') {
      if (data.type === 'baseline') {
        const sameDate = records.filter(
          (r) =>
            r.id !== previous?.id &&
            r.kind === 'membership' &&
            r.data.type === 'baseline' &&
            r.data.decision === 'adopted' &&
            r.data.asOf === data.asOf,
        );
        const confirmedTotal = data.totalDays ?? sameDate.find((r) => r.data.totalDays !== null)?.data.totalDays;
        const confirmedContinuous =
          data.continuousDays ?? sameDate.find((r) => r.data.continuousDays !== null)?.data.continuousDays;
        if (confirmedTotal != null && confirmedContinuous != null && confirmedTotal < confirmedContinuous) {
          throw createPublicError('同一截至日期的累计天数不能少于连续天数。');
        }
        if (!previous) {
          data.totalDays = confirmedTotal ?? null;
          data.continuousDays = confirmedContinuous ?? null;
        }
        data.cycleId = intervalCycleOnDate(records, data.asOf);
      }
      data.cycleId ||= previous?.data.cycleId || cycleForNewRecord(profile, records, data) || randomUUID();
      data.conflicts = membershipConflicts(record, records, previous?.id);
      if (data.conflicts.length) {
        data.decision = 'pending';
        if (previous) {
          data.conflicts.push(previous.id);
          record = {
            ...record,
            id: undefined,
            revision: undefined,
            original: {
              ...data,
              occurredAt,
              source: 'manual',
              revises: previous.id,
            },
          };
        }
      }
      // A new baseline supersedes only the same human baseline after explicit adoption.
      if (!previous && data.type === 'baseline' && data.decision === 'adopted') {
        for (const old of records.filter(
          (r) =>
            r.kind === 'membership' &&
            r.data.type === 'baseline' &&
            r.data.asOf === data.asOf &&
            r.data.decision === 'adopted',
        )) {
          store.records.update(scope, profile.id, { ...old, data: { ...old.data, decision: 'superseded' } }, now());
        }
      }
      if (data.decision === 'adopted' && data.cycleId !== profile.cycleId && updatesCurrentCycle(data, records)) {
        profile = store.save(scope, { ...profile, cycleId: data.cycleId }, identityKey(profile.identity), now());
      }
    }
    const saved = record.id
      ? store.records.update(scope, profile.id, record, now())
      : store.records.insert(scope, profile.id, record, now());
    return { record: saved, profile: detail(scope, profile.id) };
  }

  function resolveMembership(scope, input) {
    const profile = requireProfile(scope, input.profileId);
    const records = store.records.list(scope, profile.id);
    const pending = records.find((r) => r.id === input.id && r.kind === 'membership' && r.data.decision === 'pending');
    if (!pending || !['adopt', 'keep'].includes(input.choice)) throw createPublicError('请选择待核实的依据和采用方式。');
    const data = { ...pending.data };
    let retained = records;
    if (input.choice === 'adopt') {
      const revises = pending.original.revises;
      const conflicts = membershipConflicts(pending, records, revises, { independentBaselines: true });
      if (revises && records.some(r => r.id === revises && ['adopted', 'pending'].includes(r.data.decision))) conflicts.push(revises);
      if (conflicts.length !== data.conflicts.length || conflicts.some(id => !data.conflicts.includes(id))) {
        store.records.update(scope, profile.id, { ...pending, data: { ...data, conflicts } }, now());
        return detail(scope, profile.id);
      }
      if (data.type === 'interval' && !revises) data.cycleId = cycleForNewRecord(profile, records, data) || randomUUID();
      for (const old of records.filter(r => conflicts.includes(r.id))) {
        if (data.type === 'baseline' && old.data.type === 'baseline' && old.data.asOf === data.asOf && old.id !== revises) {
          if (data.totalDays == null && old.data.totalDays != null && old.data.totalDays >= data.continuousDays)
            data.totalDays = old.data.totalDays;
          if (data.continuousDays == null && old.data.continuousDays != null && old.data.continuousDays <= data.totalDays) {
            data.continuousDays = old.data.continuousDays;
            data.cycleId = old.data.cycleId;
          }
        }
        store.records.update(scope, profile.id, { ...old, data: { ...old.data, decision: 'superseded' } }, now());
      }
      retained = records.filter(r => !conflicts.includes(r.id));
      if (data.type === 'baseline') data.cycleId = intervalCycleOnDate(retained, data.asOf) || data.cycleId;
    }
    store.records.update(
      scope,
      profile.id,
      {
        ...pending,
        data: {
          ...data,
          decision: input.choice === 'adopt' ? 'adopted' : 'rejected',
          resolvedAt: now(),
        },
      },
      now(),
    );
    if (input.choice === 'adopt' && data.cycleId && updatesCurrentCycle(data, retained)) {
      store.save(scope, { ...profile, cycleId: data.cycleId }, identityKey(profile.identity), now());
    }
    return detail(scope, profile.id);
  }

  const transfer = createFanBackupService({
    store,
    now,
    create,
    detail,
    requireProfile,
  });
  const facts = createFanFactConsumer({ store, now, create });
  const merge = createFanMergeService({ store, now, detail, requireProfile });

  function readProjectionBatch(scope, profiles, at) {
    const ids = profiles.map(profile => profile.id);
    // Milestones also compare the day before the first visible reminder. A restored
    // roster snapshot can need an even earlier observation to verify its bound UID.
    const historyStart = new Date(dayStart(dayOf(at)) - (REMINDER_HISTORY_DAYS + 1) * DAY_MS).toISOString();
    const before = new Map(profiles.map(({ id, guardRoster }) => {
      const rosterAt = guardRoster?.level != null ? guardRoster.observedAt : undefined;
      return [id, rosterAt && rosterAt < historyStart ? rosterAt : historyStart];
    }));
    return {
      records: store.records.listProjectionInputs(scope, ids, before),
      states: store.statesForProfiles(scope, ids),
    };
  }

  function list(scope, input) {
    const settings = store.getScope(scope);
    const query = text(input.query, '搜索', 300).toLocaleLowerCase();
    const filters = Array.isArray(input.filters) ? input.filters : [];
    const at = now();
    const today = dayOf(at);
    const earliest = addDays(today, -REMINDER_HISTORY_DAYS);
    const profiles = store.list(scope);
    project.retain(scope, profiles);
    const candidates = profiles
      .filter((p) => (input.archived ? p.archived : !p.archived))
      .filter((profile) => {
        if (filters.includes('favorite') && !profile.favorite) return false;
        if (filters.includes('incomplete') && profile.birthday && profile.summary) return false;
        return !query || [
          profile.alias,
          profile.platformName,
          profile.identity?.value,
          profile.summary,
          profile.preferredFormerName,
          profile.lastEntry?.name,
          ...recentNameHistory(profile.nameHistory, profile.platformName).map((item) => item.name),
          ...(profile.tags || []),
        ]
          .join(' ')
          .toLocaleLowerCase().includes(query);
      });
    const { records: recordsByProfile, states: statesByProfile } = readProjectionBatch(scope, candidates, at);
    return candidates
      .map((profile) => {
        const records = recordsByProfile.get(profile.id) || [];
        const { membership, reminders } = project(scope, profile, records, statesByProfile.get(profile.id) || [],
          Date.parse(at), settings);
        const guardRoster = getGuardRoster(profile, records);
        const medalLevel = getLatestGuardRosterObservation(profile, records)?.medalLevel;
        return {
          ...profile,
          formerName: profile.preferredFormerName || profile.lastEntry?.name || '',
          formerNames: recentNameHistory(profile.nameHistory, profile.platformName)
            .reverse()
            .map((item) => item.name),
          membership,
          guardRoster,
          guardAccompany: getGuardAccompany(profile, Date.parse(at)),
          currentGuardLevel: guardRoster ? guardRoster.level : membership.level,
          medalLevel: Number.isSafeInteger(medalLevel) && medalLevel >= 0 ? medalLevel : null,
          lastInteraction: records.filter((r) => ['note', 'song', 'membership'].includes(r.kind))[0]?.occurredAt || '',
          nextReminder: reminders.find((r) => {
            if (r.group === 'missed') return r.status === 'snoozed' && r.actionable && r.until >= earliest;
            return ['today', 'week'].includes(r.group) &&
              (r.status === 'pending' || (r.status === 'snoozed' && r.until <= today));
          }) || null,
        };
      })
      .filter((profile) => {
        return filters.every((filter) => {
          if (filter === 'active') return Boolean(profile.currentGuardLevel);
          if (filter === 'past') return profile.membership.hasHistory && !profile.currentGuardLevel;
          if (filter === 'unknown')
            return (
              profile.membership.status === 'pending' ||
              (!profile.guardRoster && profile.membership.status === 'unknown')
            );
          return true;
        });
      })
      .sort(
        (a, b) =>
          Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
          (a.currentGuardLevel ?? 4) - (b.currentGuardLevel ?? 4) ||
          (b.medalLevel ?? -1) - (a.medalLevel ?? -1) ||
          (b.lastInteraction || b.updatedAt).localeCompare(a.lastInteraction || a.updatedAt),
      );
  }

  function execute(scope, action, input = {}) {
    if (typeof scope !== 'string' || !scope) throw createPublicError('请先登录主播账号。');
    // A full-size backup still needs room for its restore digests and conflict choice.
    const maxInputBytes = MAX_BACKUP_BYTES + (action === 'preview-restore' || action === 'restore' ? 1024 : 0);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input), 'utf8') > maxInputBytes)
      throw createPublicError('档案请求格式无效或过大。');
    return store.transaction(() => {
      switch (action) {
        case 'settings':
          return { ...store.getScope(scope), ...accompanySettings(store.getScope(scope)) };
        case 'configure': {
          if (
            typeof input.autoCreate !== 'boolean' ||
            typeof input.autoUpdate !== 'boolean' ||
            (input.autoSyncGuardRoster !== undefined && typeof input.autoSyncGuardRoster !== 'boolean')
          )
            throw createPublicError('请选择自动更新方式。');
          const settings = {
            ...store.getScope(scope),
            ...accompanySettings({ ...store.getScope(scope), ...input }),
            initialized: true,
            autoCreate: input.autoCreate,
            autoUpdate: input.autoUpdate,
            autoSyncGuardRoster: input.autoSyncGuardRoster ?? store.getScope(scope).autoSyncGuardRoster === true,
          };
          store.saveScope(scope, settings);
          return settings;
        }
        case 'list':
          return {
            profiles: list(scope, input),
            settings: { ...store.getScope(scope), ...accompanySettings(store.getScope(scope)) },
          };
        case 'former-name-targets':
          return { ids: store.list(scope).filter(profile => !profile.archived && profile.identity?.type === 'uid')
            .map(profile => profile.id) };
        case 'detail':
          return detail(scope, input.id);
        case 'find': {
          const value = identity(input.identity);
          const found = value ? store.byIdentity(scope, identityKey(value)) : null;
          return found && !store.suppressed(scope, identityKey(value)) ? detail(scope, found.id) : null;
        }
        case 'create':
          return detail(scope, create(scope, input).id);
        case 'save': {
          const previous = requireProfile(scope, input.id);
          if (previous.revision !== input.revision)
            throw createPublicError('档案已更新，请重新打开后核对；未保存的输入仍保留。');
          const patch = profilePatch(input);
          requireAllowedIdentity(scope, patch.identity);
          const profile = { ...previous, ...patch };
          if (identityKey(profile.identity) !== identityKey(previous.identity)) {
            delete profile.guardRoster;
            delete profile.guardAccompany;
            delete profile.lastEntry;
            delete profile.firstObservedAt;
            delete profile.lastObservedAt;
            profile.platformName = '';
            profile.platformObservedAt = '';
            profile.avatar = '';
          }
          if (!profile.alias && !profile.platformName) throw createPublicError('请填写常用称呼。');
          if (patch.nameHistory) {
            const retained = new Set(patch.nameHistory.map(item => item.name));
            profile.excludedFormerNames = [...new Set([
              ...(previous.excludedFormerNames || []),
              ...(previous.nameHistory || []).filter(item => !retained.has(item.name)).map(item => item.name),
            ])].filter(name => !retained.has(name));
            profile.nameHistory = recentNameHistory(patch.nameHistory, profile.platformName).map(
              (item) => previous.nameHistory?.findLast((old) => old.name === item.name) || item,
            );
          }
          const saved = store.save(scope, profile, identityKey(profile.identity), now());
          return detail(scope, saved.id);
        }
        case 'save-record':
          return saveRecord(scope, input);
        case 'preview-merge':
          return merge.preview(scope, input);
        case 'merge': {
          const result = merge.merge(scope, input);
          project.drop(scope, input.id);
          return result;
        }
        case 'suppress': {
          const profile = requireProfile(scope, input.id);
          if (profile.revision !== input.revision) throw createPublicError('档案已更新，请重新打开后核对。');
          const key = identityKey(profile.identity);
          if (!key) throw createPublicError('请先绑定 B 站账号，再加入黑名单。');
          store.suppress(scope, key);
          project.drop(scope, profile.id);
          return true;
        }
        case 'suppression-list':
          return store.suppressions(scope).map((key) => {
            const profile = store.byIdentity(scope, key);
            return { key, identity: JSON.parse(key), name: profile?.platformName || profile?.alias || '' };
          });
        case 'unsuppress':
          if (input.confirm !== true) throw createPublicError('请确认解除该粉丝的屏蔽。');
          store.unsuppress(scope, identityKey(identity(input.identity)));
          return true;
        case 'resolve-membership':
          return resolveMembership(scope, input);
        case 'reminders':
        case 'calendar': {
          const settings = store.getScope(scope);
          const at = Date.parse(now());
          const today = dayOf(at);
          const allProfiles = store.list(scope);
          project.retain(scope, allProfiles);
          const profiles = allProfiles.filter((profile) => !profile.archived);
          const { records, states } = readProjectionBatch(scope, profiles, at);
          const reminders = profiles.flatMap((profile) => project(
            scope, profile, records.get(profile.id) || [], states.get(profile.id) || [], at, settings,
          ).reminders);
          if (action === 'reminders') return reminders.filter((item) => item.group !== 'later');
          return reminders.filter((item) =>
            item.group !== 'history' && item.date >= today && addDays(item.date, -3) <= today &&
            !(item.status === 'snoozed' && item.until > today) &&
            (item.metric !== 'accompany' || accompanySettings(settings).showAccompanyInCalendar),
          ).map((item) => ({
            id: `fan:${item.profileId}:${item.key}`, profileId: item.profileId, key: item.key,
            title: `${item.name} · ${item.title}${item.predicted ? '（预计）' : ''}`,
            date: item.date, time: '', type: 'personal',
            detail: item.basis, readonly: true,
          }));
        }
        case 'reminder-state': {
          const profile = detail(scope, input.profileId);
          const item = profile.reminders.find((r) => r.key === input.key);
          if (!item || !['handled', 'ignored', 'snoozed'].includes(input.status))
            throw createPublicError('提醒事项或处理方式无效。');
          store.saveState(scope, profile.id, item.key, {
            ...item,
            status: input.status,
            handledAt: now(),
            until: input.status === 'snoozed' ? dayOf(Date.parse(now()) + DAY_MS) : '',
          });
          return true;
        }
        case 'delete':
          if (input.confirm !== true || typeof input.suppress !== 'boolean')
            throw createPublicError('请确认删除和自动建档选项。');
          store.remove(scope, input.id, input.suppress);
          project.drop(scope, input.id);
          return true;
        case 'delete-all': {
          if (input.confirm !== true) throw createPublicError('请确认清除全部档案。');
          const deletedCount = store.removeAll(scope);
          project.retain(scope, []);
          return { deletedCount };
        }
        case 'restore':
        case 'restore-snapshot': {
          const result = transfer.execute(scope, action, input);
          project.retain(scope, []);
          return result;
        }
        default:
          return transfer.execute(scope, action, input);
      }
    });
  }

  return {
    execute,
    profileRefreshTargets(scope, members) {
      const rosterUids = new Set(members.map((member) => member.uid));
      return store.list(scope)
        .filter((profile) => !profile.archived && profile.identity?.platform === 'bilibili' &&
          profile.identity.type === 'uid' && !rosterUids.has(profile.identity.value))
        .map((profile) => ({ id: profile.id, identity: profile.identity }));
    },
    importGuardRoster: createGuardRosterImporter({
      store,
      create,
      observedProfile: facts.observedProfile,
      saveObservation: facts.saveObservation,
    }),
    consumeFacts: facts.consume,
    observeIdentity: facts.observe,
    supplementFormerNames(scope, { id, identity: person, names }) {
      return store.transaction(() => {
        const profile = requireProfile(scope, id);
        if (profile.archived || profile.identity?.type !== 'uid' || identityKey(person) !== identityKey(profile.identity))
          throw createPublicError('档案身份或状态已变化，请重新打开后补充。');
        if (!Array.isArray(names)) throw createPublicError('曾用名格式无效。');
        const seen = new Set([profile.platformName, ...(profile.excludedFormerNames || []),
          ...(profile.nameHistory || []).map(item => item.name)]);
        const added = [];
        for (const value of names) {
          const name = text(value, '曾用名', 200);
          if (!name || seen.has(name)) continue;
          seen.add(name);
          added.push({ name, observedAt: '' });
        }
        if (added.length) store.save(scope, {
          ...profile, nameHistory: [...added.reverse(), ...(profile.nameHistory || [])],
        }, identityKey(profile.identity), now());
        return { added: added.length, profile: detail(scope, id) };
      });
    },
    archiveAccepted: facts.archiveAccepted,
  };
}

module.exports = { createFanProfileService };
