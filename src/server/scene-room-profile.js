'use strict';

const { projectOverlayResponse } = require('./overlay-projection');
const { isDeepStrictEqual } = require('node:util');

const PROFILE_TTL_MS = 10 * 60 * 1000;
const FIRST_RETRY_MS = 30000;

function createSceneRoomProfile({ getOwner, getRoomId, getRoomRevision = () => undefined, loadProfile, onUpdate }) {
  let cache = null;
  let disposed = false;

  function getSnapshot(inputRoomId) {
    if (disposed) return null;
    const roomId = String(inputRoomId || '');
    const currentKey = () => {
      const owner = getOwner();
      const localRoomId = String(getRoomId() || '');
      return owner && roomId && localRoomId
        ? JSON.stringify([owner.scope, owner.epoch, localRoomId, getRoomRevision(), roomId]) : '';
    };
    const key = currentKey();
    if (!key || !loadProfile) { cache = null; return null; }
    if (cache?.key !== key) cache = { key, value: null, pending: false, nextCheck: 0, retryDelay: FIRST_RETRY_MS };
    const entry = cache;
    if (!entry.pending && Date.now() >= entry.nextCheck) {
      entry.pending = true;
      void Promise.resolve().then(() => {
        if (disposed || cache !== entry || currentKey() !== key) return null;
        return loadProfile({ expectedRoomId: roomId });
      }).then(profile =>
        profile ? projectOverlayResponse('danmaku', '/api/bilibili/room/profile', profile) : null,
      ).then(profile => {
        if (disposed || cache !== entry || currentKey() !== key) return;
        entry.pending = false;
        entry.nextCheck = Date.now() + PROFILE_TTL_MS;
        entry.retryDelay = FIRST_RETRY_MS;
        if (!isDeepStrictEqual(entry.value, profile)) {
          entry.value = profile;
          onUpdate();
        }
      }, () => {
        if (disposed || cache !== entry || currentKey() !== key) return;
        entry.pending = false;
        entry.nextCheck = Date.now() + entry.retryDelay;
        entry.retryDelay = Math.min(entry.retryDelay * 2, PROFILE_TTL_MS);
      });
    }
    return cache.value ?? null;
  }

  return { getSnapshot, dispose() { disposed = true; cache = null; } };
}

module.exports = { createSceneRoomProfile };
