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
const { createDanmakuAppearanceStore } = require('../storage/danmaku-appearance-store');
const { createDanmakuAppearance } = require('./danmaku-appearance');
const { createSceneRoomProfile } = require('./scene-room-profile');
const { createLiveRankProvider } = require('../bilibili/live-rank-provider');
const { createLiveRankService } = require('../bilibili/live-rank-service');

function createSceneRuntime({ songDb, runtimeOptions, displayPorts }) {
  const getState = displayPorts.system.getState;
  const getOwner = runtimeOptions.getSceneOwner || (() => null);
  const getAppearanceOwner = runtimeOptions.getPreviewOwner || getOwner;
  const demand = createDisplayDemand();
  const liveRankings = createLiveRankService({
    provider: runtimeOptions.liveRankProvider || createLiveRankProvider(), demand: createDisplayDemand({ idleTimeoutMs: 3000 }),
    getScope: () => ({ owner: getOwner(), roomId: String(displayPorts.settings.get().roomId || '') }),
    getRoomProfile: () => displayPorts.bilibili.getRoomProfile(),
    onUpdate: () => notify({ types: ['live-rankings'] }),
  });
  const cloud = createCloudDisplayBuffer({ getOwner, onRead: demand.touch });
  function readCloud(request) {
    const snapshot = cloud.getSnapshot(request);
    const resources = displayPorts.giftImages;
    if (resources) snapshot.events = snapshot.events.map(event => event.type === 'gift'
      ? { ...event, giftImageUrl: [1, 2, 3].includes(Number(event.giftGuardLevel))
        ? '' : resources.resolveSource(event.giftImageUrl) } : event);
    return snapshot;
  }
  const roomProfile = createSceneRoomProfile({
    getOwner,
    getRoomId: () => displayPorts.settings.get().roomId,
    getRoomRevision: displayPorts.settings.getRoomRevision,
    loadProfile: displayPorts.bilibili?.getRoomProfile,
    onUpdate: () => events.notify({ types: ['danmaku'] }),
  });
  const sceneCloud = { getSnapshot(request) {
    const snapshot = readCloud(request);
    return { ...snapshot, roomProfile: roomProfile.getSnapshot(snapshot.state?.roomGuard?.roomId) };
  } };
  const appearance = createDanmakuAppearance({ store: createDanmakuAppearanceStore(songDb), getOwner: getAppearanceOwner,
    loadLegacy: runtimeOptions.loadDanmakuAppearance || (async () => ({ style: 'signal', fullscreenDurationSeconds: 6 })),
    onChanged: () => {
      events.notify({ types: ['danmaku'] });
      danmakuEvents.notify({ types: ['danmaku'] });
    } });
  const gifts = createSceneGiftEvents({ getOwner });
  const getExtraDisplay = createSceneExtraDisplay({ displayPorts: { ...displayPorts, liveRankings }, getOwner });
  const componentPorts = createSceneComponentPorts({ getState, getOwner, cloud: sceneCloud, getDanmakuConfig: () => {
    const config = appearance.getSettings();
    if (!config) demand.touch();
    return config;
  },
  getExtraDisplay: (type, readState, request) => ['gift-frame', 'guard-thanks'].includes(type)
    ? gifts.getSnapshot(type, request) : getExtraDisplay(type, readState, request) });
  function notify({ invalidateTypes, ...change } = {}) {
    if (invalidateTypes) getExtraDisplay.invalidate?.(invalidateTypes);
    componentPorts.invalidateDisplay(change.types);
    events.notify(change);
  }
  const service = createSceneService({ store: createSceneStore(songDb), getOwner,
    getSharedAppearances: (items, displayContext) => readSceneSharedAppearances({
      settings: displayPorts.settings,
      system: displayPorts.system,
      readState: displayContext?.readState,
      readDanmakuDisplay: () => ({ config: appearance.getSettings() }),
    }, items),
    onOutputChanged: notify,
    secretCodec: runtimeOptions.sceneSecretCodec || createElectronSecretCodec(runtimeOptions.safeStorage),
    ...componentPorts });
  const renewDemand = ({ types }) => {
    if (types.includes('danmaku')) demand.touch();
    if (types.includes('live-rankings')) liveRankings.touch();
  };
  const events = createSceneOutputEvents({ getAccess: (input) => service.getOutputAccess(input), onActivity: renewDemand });
  const danmakuEvents = createDisplayNotifications({ getAccess() {
    const owner = getOwner();
    if (!owner) throw Object.assign(new Error('Display owner unavailable'), { statusCode: 423 });
    return { binding: JSON.stringify([owner.scope, owner.epoch]), version: 0, types: ['danmaku'] };
  }, onActivity: renewDemand });
  return { service, events, danmakuEvents, appearance, liveRankings, notify, subscribeCloudDemand: demand.subscribe,
    dispose() { roomProfile.dispose(); liveRankings.dispose(); events.dispose(); danmakuEvents.dispose(); demand.dispose(); },
    receiveCloud(update) {
      const accepted = cloud.receive(update);
      if (accepted) {
        events.notify({ types: ['danmaku'] });
        danmakuEvents.notify({ types: ['danmaku'] });
      }
      return accepted;
    },
    receiveCloudSettings(update) {
      // Legacy settings may initialize an account once; they never replace local edits.
      const owner = getOwner();
      if (!owner || update?.ownerScope !== owner.scope || update.authorizationEpoch !== owner.epoch) return false;
      try { return appearance.seed({ ...update, authorizationEpoch: getAppearanceOwner()?.epoch }); } catch { return false; }
    },
    receiveGift(payload) {
      const accepted = gifts.receive(payload);
      if (accepted) events.notify({ types: [payload.type === 'gift:frame' ? 'gift-frame' : 'guard-thanks'] });
      return accepted;
    },
    readDanmakuDisplay: (request) => ({ config: appearance.getSettings(), data: readCloud(request) }) };
}

module.exports = { createSceneRuntime };
