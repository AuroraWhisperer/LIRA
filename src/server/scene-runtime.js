'use strict';

const { createSceneStore } = require('../storage/scene-store');
const { createSceneService } = require('../scenes/scene-service');
const { createCloudDisplayBuffer } = require('../scenes/cloud-display-buffer');
const { createElectronSecretCodec } = require('../ai/secret-codec');
const { createSceneComponentPorts } = require('./scene-components');
const { createSceneExtraDisplay } = require('./scene-extra-display');
const { createSceneGiftEvents } = require('./scene-gift-events');
const { createSceneOutputEvents } = require('./scene-output-events');

function createSceneRuntime({ songDb, runtimeOptions, getState, getContext }) {
  const getOwner = runtimeOptions.getSceneOwner || (() => null);
  const cloud = createCloudDisplayBuffer({ getOwner });
  const gifts = createSceneGiftEvents({ getOwner });
  const getExtraDisplay = getContext ? createSceneExtraDisplay({ getContext, getOwner }) : () => null;
  function notify({ invalidateTypes, ...change } = {}) {
    if (invalidateTypes) getExtraDisplay.invalidate?.(invalidateTypes);
    events.notify(change);
  }
  const service = createSceneService({ store: createSceneStore(songDb), getOwner,
    onOutputChanged: notify,
    secretCodec: runtimeOptions.sceneSecretCodec || createElectronSecretCodec(runtimeOptions.safeStorage),
    ...createSceneComponentPorts({ getState, cloud,
      getExtraDisplay: (type) => ['gift-frame', 'guard-thanks'].includes(type) ? gifts.getSnapshot(type) : getExtraDisplay(type) }) });
  const events = createSceneOutputEvents({ getAccess: (input) => service.getOutputAccess(input) });
  return { service, events, notify,
    dispose: () => events.dispose(),
    receiveCloud(update) {
      const accepted = cloud.receive(update);
      if (accepted) events.notify({ types: ['danmaku'] });
      return accepted;
    },
    receiveGift(payload) {
      const accepted = gifts.receive(payload);
      if (accepted) events.notify({ types: [payload.type === 'gift:frame' ? 'gift-frame' : 'guard-thanks'] });
      return accepted;
    },
    readDanmakuDisplay: (request) => ({ config: cloud.getSettings(), data: cloud.getSnapshot(request) }) };
}

module.exports = { createSceneRuntime };
