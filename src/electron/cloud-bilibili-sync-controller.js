'use strict';

function createCloudBilibiliSyncController({ runtime, licenseManager, bilibiliAuth, isCurrent, shouldApply, recordRevision }) {
  const getPendingLogout = (accountKey) => runtime.getPendingCloudBilibiliLogout?.(accountKey) || null;

  async function upload(work) {
    const requestOptions = { signal: work.signal };
    const pending = getPendingLogout(work.accountKey);
    if (pending) {
      const cleared = await bilibiliAuth.logout({ isCurrent: () => isCurrent(work)
        && getPendingLogout(work.accountKey)?.mutationId === pending.mutationId });
      if (cleared === null || !isCurrent(work)) return false;
      const result = await licenseManager.clearBilibiliCredentialsInternal(requestOptions);
      if (isCurrent(work)) runtime.acknowledgePendingCloudBilibiliLogout(work.accountKey, pending.mutationId);
      return result;
    }
    const state = await bilibiliAuth.getAuthState();
    if (!isCurrent(work)) return false;
    if (state?.loggedIn) {
      const cookie = await bilibiliAuth.getCookieHeader();
      if (!isCurrent(work)) return false;
      return licenseManager.setBilibiliCredentialsInternal(cookie, requestOptions);
    }
    return licenseManager.clearBilibiliCredentialsInternal(requestOptions);
  }

  async function reconcile(state, work) {
    if (!isCurrent(work)) return;
    const sessionRevision = bilibiliAuth.getSessionRevision?.();
    const canWrite = () => shouldApply('bilibili', state?.revision, work)
      && sessionRevision === bilibiliAuth.getSessionRevision?.();
    if (!state?.initialized) {
      if (!shouldApply('bilibili', 0, work)) return;
      // An unowned local Cookie must never seed a newly authorized account.
      const result = await bilibiliAuth.logout({ isCurrent: canWrite });
      if (result !== null && isCurrent(work)) recordRevision(0);
      return;
    }
    if (!shouldApply('bilibili', state.revision, work)) return;
    const result = await licenseManager.getBilibiliCredentialsInternal({
      signal: work.signal,
    });
    if (!isCurrent(work)) return;
    if (
      typeof result?.loggedIn !== 'boolean' ||
      !Number.isSafeInteger(result.revision) ||
      result.revision < 0 ||
      (result.loggedIn && (typeof result.cookie !== 'string' || !result.cookie.trim()))
    ) {
      throw Object.assign(new Error('Invalid cloud credential snapshot.'), { code: 'INVALID_RESPONSE' });
    }
    const cloudRevision = Math.max(Number(state.revision) || 0, Number(result?.revision) || 0);
    if (!shouldApply('bilibili', cloudRevision, work)) return;
    const applied = result.loggedIn
      ? await bilibiliAuth.replaceCookieHeader(result.cookie, { isCurrent: canWrite })
      : await bilibiliAuth.logout({ isCurrent: canWrite });
    if (applied !== null && isCurrent(work)) recordRevision(cloudRevision);
  }

  return { upload, reconcile, getPendingLogout };
}

module.exports = { createCloudBilibiliSyncController };
