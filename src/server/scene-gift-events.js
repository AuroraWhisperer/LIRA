'use strict';

const { randomUUID } = require('node:crypto');
const { projectWebSocketPayload } = require('./overlay-projection');
const EVENT_TYPES = { 'gift-frame': 'gift:frame', 'guard-thanks': 'gift:guard-thanks' };
const MAX_EVENTS = 200;

// A display window only: business eligibility and event identity remain with gifts.
function createSceneGiftEvents({ getOwner }) {
  let ownerKey;
  let epoch;
  let sequence = 0;
  let events = [];
  function syncOwner() {
    const owner = getOwner();
    const key = JSON.stringify([owner?.scope, owner?.epoch]);
    if (key !== ownerKey) {
      ownerKey = key;
      epoch = randomUUID();
      sequence = 0;
      events = [];
    }
    return Boolean(owner?.scope);
  }
  return {
    receive(payload) {
      if (!syncOwner() || !Object.values(EVENT_TYPES).includes(payload?.type)) return false;
      if (events.some((event) => event.payload.eventId === payload.eventId)) return false;
      const projected = projectWebSocketPayload({ type: 'overlay', scope: 'gift-effects' }, payload);
      events.push({ sequence: ++sequence, payload: projected });
      if (events.length > MAX_EVENTS) events.shift();
      return true;
    },
    getSnapshot(type) {
      syncOwner();
      return { epoch, sequence, events: structuredClone(events.filter((event) => event.payload.type === EVENT_TYPES[type])) };
    },
  };
}

module.exports = { createSceneGiftEvents };
