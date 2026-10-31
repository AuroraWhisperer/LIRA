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
const { projectOverlayResponse } = require('./overlay-projection');

function createSceneRuntime({ songDb, runtimeOptions, displayPorts }) {
  const getState = displayPorts.system.getState;
  const getOwner = runtimeOptions.getSceneOwner || (() => null);
  const getAppearanceOwner = runtimeOptions.getPreviewOwner || getOwner;
  const demand = createDisplayDemand();
  const cloud = createCloudDisplayBuffer({ getOwner, onRead: demand.touch });
  let roomProfileCache;
  const sceneCloud = { getSnapshot(request) {
    const snapshot = cloud.getSnapshot(request);
    const roomId = String(snapshot.state?.roomGuard?.roomId || '');
    const currentKey = () => {
      const owner = getOwner();
      const localRoomId = String(getState(['liveStatus']).liveStatus?.roomId || '');
      return owner && roomId && localRoomId === roomId ? JSON.stringify([owner.scope, owner.epoch, roomId]) : '';
    };
    const key = currentKey();
    if (!key || !displayPorts.bilibili?.getRoomProfile) return { ...snapshot, roomProfile: null };
    if (roomProfileCache?.key !== key || !roomProfileCache.pending && Date.now() - roomProfileCache.at >= 30000) {
      const entry = { key, pending: true, at: Date.now() };
      void Promise.resolve().then(() => displayPorts.bilibili.getRoomProfile()).then(profile =>
        String(profile?.roomId || '') === roomId ? projectOverlayResponse('danmaku', '/api/bilibili/room/profile', profile) : null,
      ).catch(() => null).then(profile => {
        entry.pending = false; entry.at = Date.now(); entry.value = profile;
        if (roomProfileCache === entry && currentKey() === key) events.notify({ types: ['danmaku'] });
      });
      roomProfileCache = entry;
    }
    return { ...snapshot, roomProfile: roomProfileCache.value ?? null };
  } };
  const appearance = createDanmakuAppearance({ store: createDanmakuAppearanceStore(songDb), getOwner: getAppearanceOwner,
    loadLegacy: runtimeOptions.loadDanmakuAppearance || (async () => ({ style: 'signal', fullscreenDurationSeconds: 6 })),
    onChanged: () => {
      events.notify({ types: ['danmaku'] });
      danmakuEvents.notify({ types: ['danmaku'] });
    } });
  const gifts = createSceneGiftEvents({ getOwner });
  const getExtraDisplay = createSceneExtraDisplay({ displayPorts, getOwner });
  function notify({ invalidateTypes, ...change } = {}) {
    if (invalidateTypes) getExtraDisplay.invalidate?.(invalidateTypes);
    events.notify(change);
  }
  const service = createSceneService({ store: createSceneStore(songDb), getOwner,
    getSharedAppearances: items => readSceneSharedAppearances({
      settings: displayPorts.settings,
      system: displayPorts.system,
      readDanmakuDisplay: () => ({ config: appearance.getSettings() }),
    }, items),
    onOutputChanged: notify,
    secretCodec: runtimeOptions.sceneSecretCodec || createElectronSecretCodec(runtimeOptions.safeStorage),
    ...createSceneComponentPorts({ getState, cloud: sceneCloud, getDanmakuConfig: () => {
      const config = appearance.getSettings();
      if (!config) demand.touch();
      return config;
    },
      getExtraDisplay: (type, readState, request) => ['gift-frame', 'guard-thanks'].includes(type)
        ? gifts.getSnapshot(type) : getExtraDisplay(type, readState, request) }) });
  const events = createSceneOutputEvents({ getAccess: (input) => service.getOutputAccess(input) });
  const danmakuEvents = createDisplayNotifications({ getAccess() {
    const owner = getOwner();
    if (!owner) throw Object.assign(new Error('Display owner unavailable'), { statusCode: 423 });
    return { binding: JSON.stringify([owner.scope, owner.epoch]), version: 0, types: ['danmaku'] };
  } });
  return { service, events, danmakuEvents, appearance, notify, subscribeCloudDemand: demand.subscribe,
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
    readDanmakuDisplay: (request) => ({ config: appearance.getSettings(), data: cloud.getSnapshot(request) }) };
}

module.exports = { createSceneRuntime };
