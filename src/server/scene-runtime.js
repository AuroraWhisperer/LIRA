'use strict';

const { createSceneStore } = require('../storage/scene-store');
const { createSceneService } = require('../scenes/scene-service');
const { createCloudDisplayBuffer } = require('../scenes/cloud-display-buffer');
const { createElectronSecretCodec } = require('../ai/secret-codec');
const { createSceneComponentPorts } = require('./scene-components');
const { createSceneExtraDisplay } = require('./scene-extra-display');

function createSceneRuntime({ songDb, runtimeOptions, getState, getContext }) {
  const getOwner = runtimeOptions.getSceneOwner || (() => null);
  const cloud = createCloudDisplayBuffer({ getOwner });
  const service = createSceneService({ store: createSceneStore(songDb), getOwner,
    secretCodec: runtimeOptions.sceneSecretCodec || createElectronSecretCodec(runtimeOptions.safeStorage),
    ...createSceneComponentPorts({ getState, cloud,
      getExtraDisplay: getContext ? createSceneExtraDisplay({ getContext, getOwner }) : undefined }) });
  return { service, receiveCloud: cloud.receive,
    readDanmakuDisplay: (request) => ({ config: cloud.getSettings(), data: cloud.getSnapshot(request) }) };
}

module.exports = { createSceneRuntime };
