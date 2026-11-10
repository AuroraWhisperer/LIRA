'use strict';

const { projectOverlayResponse } = require('./overlay-projection');

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
    if (!key || !loadProfile) return null;
    if (cache?.key !== key || !cache.pending && Date.now() - cache.at >= 30000) {
      const entry = { key, pending: true, at: Date.now() };
      cache = entry;
      void Promise.resolve().then(() => {
        if (disposed || cache !== entry || currentKey() !== key) return null;
        return loadProfile({ expectedRoomId: roomId });
      }).then(profile =>
        profile ? projectOverlayResponse('danmaku', '/api/bilibili/room/profile', profile) : null,
      ).catch(() => null).then(profile => {
        if (disposed || cache !== entry || currentKey() !== key) return;
        entry.pending = false;
        entry.at = Date.now();
        entry.value = profile;
        onUpdate();
      });
    }
    return cache.value ?? null;
  }

  return { getSnapshot, dispose() { disposed = true; cache = null; } };
}

module.exports = { createSceneRoomProfile };
