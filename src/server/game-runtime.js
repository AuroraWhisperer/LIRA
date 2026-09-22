'use strict';

const { createGameSessionService } = require('../games/game-session-service');
const { createInteractionSessionService } = require('../games/interaction-session-service');

// Wire the two collecting gates without sharing their private session state.
function createGameRuntime({ broadcast, getSourceState, subscribe }) {
  let interactions;
  const games = createGameSessionService({
    broadcast,
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

module.exports = { createGameRuntime };
