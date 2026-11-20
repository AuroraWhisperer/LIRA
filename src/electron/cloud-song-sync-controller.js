'use strict';

const { mapSongForSync } = require('../shared/cloud-song-snapshot');

function createCloudSongSyncController({ runtime, licenseManager, isCurrent, shouldApply, seedScope }) {
  const readPending = (accountKey) => runtime.getPendingCloudSongs?.(accountKey) || null;

  return {
    hasPending: (accountKey) => Boolean(runtime.hasPendingCloudSongs?.(accountKey)),

    restorePending(accountKey) {
      const pending = readPending(accountKey);
      if (!pending) return false;
      runtime.replaceCloudSongsSnapshot(pending.songs.map(mapSongForSync), accountKey);
      return true;
    },

    async upload(work) {
      const pending = readPending(work.accountKey);
      const result = await licenseManager.syncSongs(pending ? pending.songs : runtime.getCloudSongsSnapshot(work.accountKey), {
        signal: work.signal,
      });
      if (pending && isCurrent(work)) {
        runtime.acknowledgePendingCloudSongs(work.accountKey, pending.mutationId);
      }
      return result;
    },

    async reconcile(state, work) {
      if (!isCurrent(work)) return null;
      if (!state?.initialized) {
        runtime.acceptCloudSongsAccount?.(work.accountKey);
        await seedScope('songs', work);
        return null;
      }
      if (!shouldApply('songs', state.revision, work, state.updatedAt)) return null;
      const result = await licenseManager.getCloudSongs({ signal: work.signal });
      const revision = result?.revision ?? state.revision;
      const updatedAt = result?.updatedAt === undefined && revision === state.revision
        ? state.updatedAt
        : result?.updatedAt;
      if (!shouldApply('songs', revision, work, updatedAt)) return null;
      if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(result?.songs)) {
        throw Object.assign(new Error('Invalid cloud song snapshot.'), { code: 'INVALID_RESPONSE' });
      }
      await runtime.replaceCloudSongsSnapshot(result.songs, work.accountKey);
      return isCurrent(work) ? { revision, updatedAt } : null;
    },
  };
}

module.exports = { createCloudSongSyncController };
