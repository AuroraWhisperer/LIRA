'use strict';

const { randomUUID } = require('node:crypto');
const { text, timestamp, identity, identityKey, profilePatch, recordData, recentNameHistory } = require('./validation');
const { DAY_MS, dayOf, addDays, zodiacFor } = require('./dates');
const { summarizeMembership, membershipConflicts, cycleForNewRecord } = require('./membership');
const { buildReminders } = require('./reminders');
const { createFanBackupService } = require('./profile-transfer');
const { createFanFactConsumer } = require('./profile-facts');
const { createFanMergeService } = require('./profile-merge');
const { createGuardRosterImporter, getGuardRoster } = require('./guard-roster-import');
const { accompanySettings, getGuardAccompany } = require('./guard-accompany');

function createFanProfileService({ store, now = () => new Date().toISOString() }) {
  function requireProfile(scope, id) {
    const profile = store.get(scope, text(id, '档案 ID', 100));
    if (!profile) throw new Error('档案不存在或不属于当前账号。');
    requireAllowedIdentity(scope, profile.identity);
    return profile;
  }

  function requireAllowedIdentity(scope, person) {
    if (person && store.suppressed(scope, identityKey(person)))
      throw new Error('该粉丝已加入黑名单，请先在档案设置中解除屏蔽。');
  }

  function create(scope, input, automatic = false) {
    const patch = profilePatch(input);
    requireAllowedIdentity(scope, patch.identity);
    if (!patch.alias && !automatic) throw new Error('请填写常用称呼。');
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
    const records = store.records.list(scope, id);
    const membership = summarizeMembership(records, now());
    const guardRoster = getGuardRoster(profile, records);
    const songs = records.filter((record) => record.kind === 'song' && !record.data.excluded);
    const preferences = records.filter((record) => record.kind === 'preference' && !record.data.archived);
    const recentSongs = songs.filter((record) => Date.parse(record.occurredAt) >= Date.parse(now()) - 90 * DAY_MS);
    const countedSongs = recentSongs.filter((record) => !record.data.excludeFromStats);
    const categories = Object.create(null);
    for (const song of countedSongs) {
      const key = song.data.category || '未分类';
      categories[key] = (categories[key] || 0) + 1;
    }
    return {
      ...profile,
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
        days: 90,
        count: countedSongs.length,
        categories,
      },
      reminders: buildReminders(profile, records, store.states(scope, id), Date.parse(now()), store.getScope(scope)),
    };
  }

  function saveRecord(scope, input) {
    let profile = requireProfile(scope, input.profileId);
    const records = store.records.list(scope, profile.id);
    const previous = input.id ? records.find((r) => r.id === input.id) : null;
    if (input.id && !previous) throw new Error('记录不存在。');
    if (previous && previous.revision !== input.revision) throw new Error('记录已更新，请重新打开后核对。');
    const kind = previous?.kind || input.kind;
    const data = recordData(kind, input.data || {});
    if (kind === 'song') data.state = previous?.data.state || '已点歌';
    const occurredAt = timestamp(input.occurredAt || now());
    let record = {
      id: previous?.id,
      kind,
      data,
      occurredAt,
      revision: previous?.revision,
      original: previous?.original || { ...data, occurredAt, source: 'manual' },
    };
    if (kind === 'membership') {
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
          throw new Error('同一截至日期的累计天数不能少于连续天数。');
        }
        if (!previous) {
          data.totalDays = confirmedTotal ?? null;
          data.continuousDays = confirmedContinuous ?? null;
        }
      }
      data.cycleId = previous?.data.cycleId || cycleForNewRecord(profile, records, data) || randomUUID();
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
      if (data.decision === 'adopted' && data.cycleId !== profile.cycleId) {
        profile = store.save(scope, { ...profile, cycleId: data.cycleId }, identityKey(profile.identity), now());
      }
    }
    const saved = record.id
      ? store.records.update(scope, profile.id, record, now())
      : store.records.insert(scope, profile.id, record);
    return { record: saved, profile: detail(scope, profile.id) };
  }

  function resolveMembership(scope, input) {
    const profile = requireProfile(scope, input.profileId);
    const records = store.records.list(scope, profile.id);
    const pending = records.find((r) => r.id === input.id && r.kind === 'membership' && r.data.decision === 'pending');
    if (!pending || !['adopt', 'keep'].includes(input.choice)) throw new Error('请选择待核实的依据和采用方式。');
    if (input.choice === 'adopt') {
      for (const old of records.filter((r) => pending.data.conflicts.includes(r.id))) {
        store.records.update(scope, profile.id, { ...old, data: { ...old.data, decision: 'superseded' } }, now());
      }
    }
    store.records.update(
      scope,
      profile.id,
      {
        ...pending,
        data: {
          ...pending.data,
          decision: input.choice === 'adopt' ? 'adopted' : 'rejected',
          resolvedAt: now(),
        },
      },
      now(),
    );
    if (input.choice === 'adopt' && pending.data.cycleId) {
      store.save(scope, { ...profile, cycleId: pending.data.cycleId }, identityKey(profile.identity), now());
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

  function list(scope, input) {
    const settings = store.getScope(scope);
    const query = text(input.query, '搜索', 300).toLocaleLowerCase();
    const filters = Array.isArray(input.filters) ? input.filters : [];
    const at = now();
    const candidates = store
      .list(scope)
      .filter((p) => (input.archived ? p.archived : !p.archived))
      .filter((profile) => {
        const searchable = [
          profile.alias,
          profile.platformName,
          profile.identity?.value,
          profile.summary,
          ...recentNameHistory(profile.nameHistory, profile.platformName).map((item) => item.name),
          ...(profile.tags || []),
        ]
          .join(' ')
          .toLocaleLowerCase();
        return (
          (!query || searchable.includes(query)) &&
          (!filters.includes('favorite') || profile.favorite) &&
          (!filters.includes('incomplete') || !profile.birthday || !profile.summary)
        );
      });
    const ids = candidates.map((profile) => profile.id);
    const recordsByProfile = store.records.listForProfiles(scope, ids);
    const statesByProfile = store.statesForProfiles(scope, ids);
    return candidates
      .map((profile) => {
        const records = recordsByProfile.get(profile.id) || [];
        const membership = summarizeMembership(records, at);
        const guardRoster = getGuardRoster(profile, records);
        const medalLevel = records
          .filter((r) => r.original.evidence === 'guard-roster')
          .sort((a, b) => b.original.observedAt.localeCompare(a.original.observedAt))[0]?.original.medalLevel;
        const reminders = buildReminders(profile, records, statesByProfile.get(profile.id) || [], Date.parse(at), settings);
        return {
          ...profile,
          formerNames: recentNameHistory(profile.nameHistory, profile.platformName)
            .reverse()
            .map((item) => item.name),
          membership,
          guardRoster,
          guardAccompany: getGuardAccompany(profile, Date.parse(at)),
          currentGuardLevel: guardRoster ? guardRoster.level : membership.level,
          medalLevel: Number.isSafeInteger(medalLevel) && medalLevel >= 0 ? medalLevel : null,
          lastInteraction: records.filter((r) => ['note', 'song', 'membership'].includes(r.kind))[0]?.occurredAt || '',
          nextReminder:
            reminders.find((r) => ['today', 'week'].includes(r.group) && r.status === 'pending') || null,
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
    if (typeof scope !== 'string' || !scope) throw new Error('请先登录主播账号。');
    if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 16 * 1024 * 1024)
      throw new Error('档案请求格式无效或过大。');
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
            throw new Error('请选择自动更新方式。');
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
            throw new Error('档案已更新，请重新打开后核对；未保存的输入仍保留。');
          const patch = profilePatch(input);
          requireAllowedIdentity(scope, patch.identity);
          if (!patch.alias && !previous.alias && !previous.platformName) throw new Error('请填写常用称呼。');
          const profile = { ...previous, ...patch };
          if (identityKey(profile.identity) !== identityKey(previous.identity)) delete profile.guardAccompany;
          if (patch.nameHistory) {
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
        case 'merge':
          return merge.merge(scope, input);
        case 'suppress': {
          const profile = requireProfile(scope, input.id);
          if (profile.revision !== input.revision) throw new Error('档案已更新，请重新打开后核对。');
          const key = identityKey(profile.identity);
          if (!key) throw new Error('请先绑定 B 站账号，再加入黑名单。');
          store.suppress(scope, key);
          return true;
        }
        case 'suppression-list':
          return store.suppressions(scope).map((key) => {
            const profile = store.byIdentity(scope, key);
            return { key, identity: JSON.parse(key), name: profile?.platformName || profile?.alias || '' };
          });
        case 'unsuppress':
          if (input.confirm !== true) throw new Error('请确认解除该粉丝的屏蔽。');
          store.unsuppress(scope, identityKey(identity(input.identity)));
          return true;
        case 'resolve-membership':
          return resolveMembership(scope, input);
        case 'reminders':
        case 'calendar': {
          const settings = store.getScope(scope);
          const today = dayOf(now());
          const profiles = store.list(scope).filter((profile) => !profile.archived);
          const ids = profiles.map((profile) => profile.id);
          const records = store.records.listForProfiles(scope, ids);
          const states = store.statesForProfiles(scope, ids);
          const reminders = profiles.flatMap((profile) => buildReminders(
            profile, records.get(profile.id) || [], states.get(profile.id) || [], Date.parse(now()), settings,
          ));
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
            throw new Error('提醒事项或处理方式无效。');
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
            throw new Error('请确认删除和自动建档选项。');
          store.remove(scope, input.id, input.suppress);
          return true;
        case 'delete-all':
          if (input.confirm !== true) throw new Error('请确认清除全部档案。');
          return { deletedCount: store.removeAll(scope) };
        default:
          return transfer.execute(scope, action, input);
      }
    });
  }

  return {
    execute,
    importGuardRoster: createGuardRosterImporter({
      store,
      create,
      observe: facts.observe,
    }),
    consumeFacts: facts.consume,
    observeIdentity: facts.observe,
    archiveAccepted: facts.archiveAccepted,
    archiveQueueState: facts.archiveQueueState,
  };
}

module.exports = { createFanProfileService };
