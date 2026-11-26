'use strict';

const { createPublicError } = require('../shared/public-error');

const { profilePatch, identityKey, recentNameHistory } = require('./validation');
const { membershipConflicts } = require('./membership');

function mergeBirthday(preferred, other) {
  if (!preferred || !other) return preferred || other;
  if (preferred.calendar !== other.calendar || preferred.monthDay !== other.monthDay ||
      (preferred.calendar === 'lunar' && Boolean(preferred.leapMonth) !== Boolean(other.leapMonth))) return preferred;
  return {
    ...preferred,
    year: preferred.year ?? other.year,
    thisYearDate: preferred.thisYearDate || other.thisYearDate,
  };
}

function createFanMergeService({ store, now, detail, requireProfile }) {
  function preview(scope, input) {
    const source = requireProfile(scope, input.id);
    const target = requireProfile(scope, input.targetId);
    if (source.id === target.id || source.identity || !target.identity)
      throw createPublicError('只能将未绑定草稿合并到已有身份档案。');
    if (source.revision !== input.revision || (input.targetRevision && target.revision !== input.targetRevision)) {
      throw createPublicError('档案已更新，请重新核对合并预览。');
    }
    const patch = profilePatch(input.patch || {});
    if (patch.identity && identityKey(patch.identity) !== identityKey(target.identity))
      throw createPublicError('待绑定身份与目标档案不一致。');
    return {
      source: { ...source, ...patch, identity: null },
      target,
      recordCount: store.records.list(scope, source.id).length,
    };
  }

  function merge(scope, input) {
    const plan = preview(scope, input);
    if (!['source', 'target'].includes(input.prefer) || input.targetRevision !== plan.target.revision)
      throw createPublicError('请确认合并时采用哪份资料。');
    const at = now();
    const before = store.exportScope(scope);
    const snapshotId = store.snapshot(
      scope,
      {
        format: 'lira-fan-profiles',
        version: 2,
        scope,
        exportedAt: at,
        reason: '合并未绑定草稿之前',
        ...before,
      },
      at,
    );
    const { birthday, ...patch } = profilePatch(plan.source);
    patch.nameHistory = recentNameHistory(plan.source.nameHistory, plan.target.platformName);
    delete patch.identity;
    const mergedProfile = {
      ...plan.target,
      birthday: input.prefer === 'source'
        ? mergeBirthday(birthday, plan.target.birthday)
        : mergeBirthday(plan.target.birthday, birthday),
    };
    const isEmpty = (value) => value == null || value === '' || (Array.isArray(value) && !value.length);
    for (const [key, incoming] of Object.entries(patch)) {
      if (!isEmpty(incoming) && (isEmpty(mergedProfile[key]) || input.prefer === 'source'))
        mergedProfile[key] = incoming;
    }
    mergedProfile.merges = [...(mergedProfile.merges || []), ...(plan.source.merges || []),
      { sourceId: plan.source.id, mergedAt: at, snapshotId, songsTracked: true }];
    store.save(scope, mergedProfile, identityKey(mergedProfile.identity), at);
    store.moveRecords(scope, plan.source.id, plan.target.id, at);
    const adopted = record => record.kind === 'membership' && record.data.decision === 'adopted' && !record.data.excluded;
    const confirmed = before.profiles.find(p => p.id === plan.target.id).records.filter(adopted);
    if (confirmed.length) {
      for (const record of before.profiles.find(p => p.id === plan.source.id).records.filter(adopted)) {
        const conflicts = membershipConflicts(record, confirmed, undefined, { independentBaselines: true });
        if (conflicts.length) {
          store.records.update(scope, plan.target.id, {
            ...record, data: { ...record.data, decision: 'pending', conflicts },
          }, at);
        } else confirmed.push(record);
      }
    }
    const targetStates = new Map(store.states(scope, plan.target.id).map((item) => [item.key, item]));
    for (const state of store.states(scope, plan.source.id)) {
      const prior = targetStates.get(state.key);
      if (!prior || (!['handled', 'ignored'].includes(prior.status) && ['handled', 'ignored'].includes(state.status))) {
        store.saveState(scope, plan.target.id, state.key, {
          ...state,
          profileId: plan.target.id,
        });
      }
    }
    store.remove(scope, plan.source.id, false);
    return { profile: detail(scope, plan.target.id), snapshotId };
  }
  return { preview, merge };
}

module.exports = { createFanMergeService };
