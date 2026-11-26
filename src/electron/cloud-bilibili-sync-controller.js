'use strict';

function createCloudBilibiliSyncController({ runtime, licenseManager, bilibiliAuth, isCurrent, shouldApply, recordRevision }) {
  const getPendingLogout = (accountKey) => runtime.getPendingCloudBilibiliLogout?.(accountKey) || null;
  let localCleanup = null;

  async function clearLocalLogout(work, pending, options = { signal: work.signal }) {
    const cleanup = {
      accountKey: work.accountKey, generation: work.generation, mutationId: pending.mutationId, running: true, revision: null,
    };
    localCleanup = cleanup;
    const before = bilibiliAuth.getSessionRevision?.();
    try {
      const operation = bilibiliAuth.logout(options);
      // Desktop reserves a user operation's revision immediately. A guarded recovery
      // takes its single revision increment when it reaches the auth queue.
      const submitted = bilibiliAuth.getSessionRevision?.();
      const state = await operation;
      const revision = bilibiliAuth.getSessionRevision?.();
      if (state?.loggedIn === false && Number.isSafeInteger(revision)
        && (revision === submitted || (options.isCurrent && revision === before + 1))) {
        cleanup.revision = revision;
      }
      return state;
    } finally {
      cleanup.running = false;
    }
  }

  async function uploadLogout(work, pending) {
    const isPending = () => isCurrent(work) && getPendingLogout(work.accountKey)?.mutationId === pending.mutationId;
    const sameIntent = localCleanup && localCleanup.accountKey === work.accountKey
      && localCleanup.generation === work.generation && localCleanup.mutationId === pending.mutationId;
    // The explicit operation schedules another flush when it finishes.
    if (sameIntent && localCleanup.running) return false;
    const revision = sameIntent ? localCleanup.revision : null;
    let reuse = false;
    if (revision !== null && revision === bilibiliAuth.getSessionRevision?.()) {
      const state = await bilibiliAuth.getAuthState();
      if (!isPending() || revision !== bilibiliAuth.getSessionRevision?.()) return false;
      reuse = state?.loggedIn === false && !state.uid && !state.hasSessdata;
    }
    if (!reuse) {
      const state = await clearLocalLogout(work, pending, { isCurrent: isPending });
      if (state?.loggedIn !== false || !isPending()) return false;
      const currentRevision = bilibiliAuth.getSessionRevision?.();
      if (Number.isSafeInteger(currentRevision) && localCleanup.revision !== currentRevision) return false;
    }
    const clearedRevision = localCleanup.revision;
    const result = await licenseManager.clearBilibiliCredentialsInternal({ signal: work.signal });
    if (isPending() && (clearedRevision === null || clearedRevision === bilibiliAuth.getSessionRevision?.())) {
      runtime.acknowledgePendingCloudBilibiliLogout(work.accountKey, pending.mutationId);
      localCleanup = null;
    }
    return result;
  }

  async function upload(work) {
    const requestOptions = { signal: work.signal };
    const pending = getPendingLogout(work.accountKey);
    if (pending) return uploadLogout(work, pending);
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

  return { upload, reconcile, getPendingLogout, clearLocalLogout };
}

module.exports = { createCloudBilibiliSyncController };
