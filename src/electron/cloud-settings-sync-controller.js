'use strict';

function createCloudSettingsSyncController({
  runtime,
  licenseManager,
  isCurrent,
  shouldApply,
  seedScope,
  getDirtyGeneration,
  recordRevision,
  confirmState,
}) {
  let lastMenuUploadSignature = null;

  function getPending(accountKey) {
    return runtime.getPendingCloudSettings?.(accountKey) || null;
  }

  function uploadValues(pending) {
    const current = runtime.getCloudSettingsSnapshot();
    if (Array.isArray(current.menuCommands)) lastMenuUploadSignature = JSON.stringify(current.menuCommands);
    if (!pending) return current;
    return {
      ...pending.values,
      ...(current.menuCommands === undefined ? {} : { menuCommands: current.menuCommands }),
    };
  }

  async function acceptUpload(result, pending, generation, work) {
    runtime.applyCloudFixedReplySettingsSnapshot?.(result?.values, result?.revision);
    const unchanged = generation === getDirtyGeneration()
      && getPending(work.accountKey)?.mutationId === pending?.mutationId;
    const applied = unchanged && Boolean(result?.values);
    if (applied) {
      await runtime.applyCloudSettingsSnapshot(result.values);
      if (!isCurrent(work)) return false;
    }
    if (pending) runtime.acknowledgePendingCloudSettings(work.accountKey, pending.mutationId);
    return applied;
  }

  async function upload(values, pending, generation, work) {
    const requestOptions = { signal: work.signal };
    try {
      return await licenseManager.updateCloudSettings(values, requestOptions);
    } catch (error) {
      if (error?.code !== 'INVALID_GIFT_BLIND_BOX_CONFIG' || !isCurrent(work)) throw error;
      const state = await licenseManager.getCloudState(requestOptions);
      if (!isCurrent(work) || generation !== getDirtyGeneration()
        || pending?.mutationId !== getPending(work.accountKey)?.mutationId) throw error;
      const remote = state?.settings?.values?.giftBlindBoxCustomConfigV2;
      const local = values.giftBlindBoxCustomConfigV2;
      if (!state?.settings?.initialized || !Array.isArray(remote) || !Array.isArray(local)) throw error;
      const activeIds = new Set(remote.map(box => box.customId));
      // Retired server identities cannot be recreated. Keep current edits and new drafts.
      const repaired = local.filter(box => !box.customId || activeIds.has(box.customId));
      if (repaired.length === local.length) throw error;
      return licenseManager.updateCloudSettings({ ...values, giftBlindBoxCustomConfigV2: repaired }, requestOptions);
    }
  }

  async function reconcile(state, work) {
    if (!isCurrent(work)) return;
    runtime.applyCloudFixedReplySettingsSnapshot?.(state?.values, state?.revision);
    if (state?.initialized) confirmState(state.values);
    if (!state?.initialized) {
      await seedScope('settings', work);
      return;
    }
    if (!shouldApply('settings', state.revision, work)) return;
    const values = state.values || {};
    const isMissingBlindBoxConfig = !Object.prototype.hasOwnProperty.call(values, 'giftBlindBoxConfig');
    await runtime.applyCloudSettingsSnapshot(values);
    if (!isCurrent(work)) return;
    runtime.setBlindBoxMappingState?.(state.blindBoxMapping || null);
    recordRevision(Number(state.revision) || 0);
    const menuCommands = runtime.getCloudSettingsSnapshot().menuCommands;
    const menuSignature = Array.isArray(menuCommands) ? JSON.stringify(menuCommands) : null;
    const menuChanged = menuSignature !== null && menuSignature !== JSON.stringify(values.menuCommands)
      && menuSignature !== lastMenuUploadSignature;
    if (isMissingBlindBoxConfig || menuChanged) await seedScope('settings', work);
  }

  return {
    getPending,
    uploadValues,
    acceptUpload,
    upload,
    reconcile,
    reset() { lastMenuUploadSignature = null; },
  };
}

module.exports = { createCloudSettingsSyncController };
