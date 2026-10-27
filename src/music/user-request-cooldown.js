'use strict';

function createUserRequestCooldown(store) {
  const lastRequests = new Map();

  return {
    restore() {
      return store.loadInto(lastRequests);
    },
    getLastRequestAt(key) {
      const at = Date.now();
      store.pruneMap(lastRequests, at);
      const lastAt = Number(lastRequests.get(key)) || 0;
      if (lastAt > at) {
        lastRequests.delete(key);
        return 0;
      }
      return lastAt;
    },
    recordAccepted(key, { uid, userName }) {
      const at = Date.now();
      // Head pruning relies on insertion order following the last accepted request.
      lastRequests.delete(key);
      lastRequests.set(key, at);
      try {
        store.touch(key, { uid, userName, at });
      } catch (error) {
        console.warn(`[Cooldown] persist failed: key=${key} error=${error.message}`);
      }
    },
    reset() {
      lastRequests.clear();
    },
  };
}

module.exports = { createUserRequestCooldown };
