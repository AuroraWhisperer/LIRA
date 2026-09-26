'use strict';

const { profilePatch, identityKey, recentNameHistory } = require('./validation');

function createFanMergeService({ store, now, detail, requireProfile }) {
  function preview(scope, input) {
    const source = requireProfile(scope, input.id);
    const target = requireProfile(scope, input.targetId);
    if (source.id === target.id || source.identity || !target.identity)
      throw new Error('只能将未绑定草稿合并到已有身份档案。');
    if (source.revision !== input.revision || (input.targetRevision && target.revision !== input.targetRevision)) {
      throw new Error('档案已更新，请重新核对合并预览。');
    }
    const patch = profilePatch(input.patch || {});
    if (patch.identity && identityKey(patch.identity) !== identityKey(target.identity))
      throw new Error('待绑定身份与目标档案不一致。');
    return {
      source: { ...source, ...patch, identity: null },
      target,
      recordCount: store.records.list(scope, source.id).length,
    };
  }

  function merge(scope, input) {
    const plan = preview(scope, input);
    if (!['source', 'target'].includes(input.prefer) || input.targetRevision !== plan.target.revision)
      throw new Error('请确认合并时采用哪份资料。');
    const at = now();
    const snapshotId = store.snapshot(
      scope,
      {
        format: 'lira-fan-profiles',
        version: 1,
        scope,
        exportedAt: at,
        reason: '合并未绑定草稿之前',
        ...store.exportScope(scope),
      },
      at,
    );
    const patch = profilePatch(plan.source);
    patch.nameHistory = recentNameHistory(plan.source.nameHistory, plan.target.platformName);
    delete patch.identity;
    const mergedProfile = { ...plan.target };
    const isEmpty = (value) => value == null || value === '' || (Array.isArray(value) && !value.length);
    for (const [key, incoming] of Object.entries(patch)) {
      if (!isEmpty(incoming) && (isEmpty(mergedProfile[key]) || input.prefer === 'source')) mergedProfile[key] = incoming;
    }
    mergedProfile.merges = [...(mergedProfile.merges || []), { sourceId: plan.source.id, mergedAt: at, snapshotId }];
    store.save(scope, mergedProfile, identityKey(mergedProfile.identity), at);
    store.moveRecords(scope, plan.source.id, plan.target.id);
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
