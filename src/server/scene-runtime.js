'use strict';

const { createSceneStore } = require('../storage/scene-store');
const { createSceneService } = require('../scenes/scene-service');
const { createCloudDisplayBuffer } = require('../scenes/cloud-display-buffer');
const { createDisplayDemand } = require('../scenes/display-demand');
const { createElectronSecretCodec } = require('../ai/secret-codec');
const { createSceneComponentPorts } = require('./scene-components');
const { createSceneExtraDisplay } = require('./scene-extra-display');
const { createSceneGiftEvents } = require('./scene-gift-events');
const { createSceneOutputEvents } = require('./scene-output-events');
const { createDisplayNotifications } = require('./display-notifications');
const { readSceneSharedAppearances } = require('./scene-shared-appearance');

function createSceneRuntime({ songDb, runtimeOptions, getState, getContext }) {
  const getOwner = runtimeOptions.getSceneOwner || (() => null);
  const demand = createDisplayDemand();
  const cloud = createCloudDisplayBuffer({ getOwner, onRead: demand.touch });
  const gifts = createSceneGiftEvents({ getOwner });
  const getExtraDisplay = getContext ? createSceneExtraDisplay({ getContext, getOwner }) : () => null;
  function notify({ invalidateTypes, ...change } = {}) {
    if (invalidateTypes) getExtraDisplay.invalidate?.(invalidateTypes);
    events.notify(change);
  }
  const service = createSceneService({ store: createSceneStore(songDb), getOwner,
    getSharedAppearances: items => {
      const context = getContext?.() || {};
      return readSceneSharedAppearances({ ...context,
        settings: context.settings || { get: () => getState().settings },
        system: { getState, ...context.system }, readDanmakuDisplay: () => ({ config: cloud.getSettings() }) }, items);
    },
    onOutputChanged: notify,
    secretCodec: runtimeOptions.sceneSecretCodec || createElectronSecretCodec(runtimeOptions.safeStorage),
    ...createSceneComponentPorts({ getState, cloud,
      getExtraDisplay: (type, readState) => ['gift-frame', 'guard-thanks'].includes(type)
        ? gifts.getSnapshot(type) : getExtraDisplay(type, readState) }) });
  const events = createSceneOutputEvents({ getAccess: (input) => service.getOutputAccess(input) });
  const danmakuEvents = createDisplayNotifications({ getAccess() {
    const owner = getOwner();
    if (!owner) throw Object.assign(new Error('Display owner unavailable'), { statusCode: 423 });
    return { binding: JSON.stringify([owner.scope, owner.epoch]), version: 0, types: ['danmaku'] };
  } });
  return { service, events, danmakuEvents, notify, subscribeCloudDemand: demand.subscribe,
    dispose() { events.dispose(); danmakuEvents.dispose(); demand.dispose(); },
    receiveCloud(update) {
      const accepted = cloud.receive(update);
      if (accepted) {
        events.notify({ types: ['danmaku'] });
        danmakuEvents.notify({ types: ['danmaku'] });
      }
      return accepted;
    },
    receiveCloudSettings(update) {
      const accepted = cloud.receiveSettings(update);
      if (accepted) {
        events.notify({ types: ['danmaku'] });
        danmakuEvents.notify({ types: ['danmaku'] });
      }
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
