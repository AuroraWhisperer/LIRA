'use strict';

const { createGameSessionService } = require('../games/game-session-service');
const { createInteractionSessionService } = require('../games/interaction-session-service');

// Wire the two collecting gates without sharing their private session state.
function createGameRuntime({ broadcast, getSourceState, subscribe }) {
  let interactions;
  const games = createGameSessionService({
    broadcast,
    getSourceState,
    isInteractionCollecting: () => interactions?.isCollecting(),
  });
  interactions = createInteractionSessionService({
    broadcast,
    getSourceState,
    subscribe,
    isGameActive: () => games.isActive(),
    onCollectingChanged: () => games.refreshAvailability(),
  });
  return { games, interactions };
}

function createGameAudience({
  service,
  listOnlineViewers = () => [],
  refreshViewers = async () => {},
  getWinnerProfile = async () => ({ avatarUrl: '', name: '' }),
}) {
  return {
    listViewers: () => mergeViewerCandidates(listOnlineViewers(), service?.listViewers() || []),
    refreshViewers: () => refreshViewers(),
    getWinnerProfile: () => getWinnerProfile(service?.getSession()?.winner),
  };
}

function mergeViewerCandidates(...groups) {
  const byKey = new Map();
  for (const viewer of groups.flat()) {
    const uid = String(viewer?.uid || '').trim();
    const name = String(viewer?.name || viewer?.userName || '观众').trim() || '观众';
    const key = uid || `name:${name}`;
    const previous = byKey.get(key);
    byKey.set(key, {
      uid,
      name,
      lastSeenAt: Math.max(Number(previous?.lastSeenAt) || 0, Number(viewer?.lastSeenAt || viewer?.seenAt) || 0),
    });
  }
  return [...byKey.values()].filter((viewer) => viewer.uid).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

module.exports = { createGameRuntime, createGameAudience };
