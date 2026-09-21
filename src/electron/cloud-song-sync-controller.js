'use strict';

const { mapSongForSync } = require('./license/license-response-utils');

function comparableSongs(songs) {
  return JSON.stringify(songs.map((song) => JSON.stringify(mapSongForSync(song))).sort());
}

function createCloudSongSyncController({ runtime, licenseManager, isCurrent, shouldApply, seedScope }) {
  const readPending = (accountKey) => runtime.getPendingCloudSongs?.(accountKey) || null;

  return {
    hasPending: (accountKey) => Boolean(readPending(accountKey)),

    restorePending(accountKey) {
      const pending = readPending(accountKey);
      if (!pending) return false;
      // Account preparation and the runtime's SQLite replacement are synchronous.
      // Avoid replacing an unchanged library: it would detach queue/history IDs.
      if (comparableSongs(pending.songs) !== comparableSongs(runtime.getCloudSongsSnapshot())) {
        runtime.replaceCloudSongsSnapshot(pending.songs.map(mapSongForSync));
      }
      return true;
    },

    async upload(work) {
      const pending = readPending(work.accountKey);
      const result = await licenseManager.syncSongs(
        pending ? pending.songs : runtime.getCloudSongsSnapshot(),
        { signal: work.signal },
      );
      if (pending && isCurrent(work)) {
        runtime.acknowledgePendingCloudSongs(work.accountKey, pending.mutationId);
      }
      return result;
    },

    async reconcile(state, work) {
      if (!isCurrent(work)) return null;
      if (!state?.initialized) {
        await seedScope('songs', work);
        return null;
      }
      if (!shouldApply('songs', state.revision, work)) return null;
      const result = await licenseManager.getCloudSongs({ signal: work.signal });
      const cloudRevision = Math.max(Number(state.revision) || 0, Number(result?.revision) || 0);
      if (!shouldApply('songs', cloudRevision, work)) return null;
      if (!Array.isArray(result?.songs)) {
        throw Object.assign(new Error('Invalid cloud song snapshot.'), { code: 'INVALID_RESPONSE' });
      }
      await runtime.replaceCloudSongsSnapshot(result.songs);
      return isCurrent(work) ? cloudRevision : null;
    },
  };
}

module.exports = { createCloudSongSyncController };
