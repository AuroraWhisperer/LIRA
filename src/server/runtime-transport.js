'use strict';

const httpUtils = require('./http-utils');
const { buildGiftFrameEvent } = require('../bilibili/gift/frame-config');
const { buildGuardThanksEvent } = require('../bilibili/gift/guard-thanks-config');
const { normalizeGiftEffectEvent } = require('../bilibili/gift/effect-event');

const SNAPSHOT_SCENE_TYPES = ['queue', 'overtime', 'songlist', 'opening', 'lyrics', 'gift-feed', 'gift-wishes', 'gift-sprint', 'blindbox'];
const GIFT_SCENE_TYPES = ['overtime', 'gift-feed', 'gift-wishes', 'gift-sprint', 'blindbox'];

function snapshotSceneTypes(reason) {
  if (reason === 'gift:wishes') return ['gift-wishes'];
  if (/^(?:gift:|bilibili:gift$|database:clear-gifts$)/.test(reason)) return GIFT_SCENE_TYPES;
  if (/^(?:queue:|superchat:|bilibili:(?:danmaku|superchat)$|database:clear-superchats$)/.test(reason)) return ['queue'];
  if (/^(?:songs:|cloud:songs$|database:clear$)/.test(reason)) return ['queue', 'songlist'];
  if (reason === 'database:clear-playback') return ['lyrics'];
  return SNAPSHOT_SCENE_TYPES;
}

function createRuntimeTransport({
  publicDir,
  defaultPort,
  getHost,
  getStartedPort,
  getSessionToken,
  beginPlaybackSnapshotSession,
  getClientTheme,
  getWebSocketHub,
  getState,
  getSettings,
  getDanmakuFeedBuffer,
  resolveGiftEffect,
  publishSceneGift,
  notifySceneOutput,
}) {
  function getWebSocketContext(baseUrl) {
    return {
      getState,
      sessionToken: getSessionToken(),
      allowedOrigins: baseUrl ? [baseUrl] : [],
    };
  }

  function broadcastSnapshot(reason) {
    const baseUrl = `http://${getHost()}:${getStartedPort() || defaultPort}`;
    getWebSocketHub()?.broadcastSnapshot(getWebSocketContext(baseUrl), reason);
    notifySceneOutput?.({ types: snapshotSceneTypes(reason),
      ...(reason === 'gift:wishes' ? { invalidateTypes: ['gift-wishes'] } : {}) });
  }

  function publishGiftFlushed(item) {
    const message = getDanmakuFeedBuffer().pushGift(item);
    broadcastSnapshot('bilibili:gift');
    const frameEvent = buildGiftFrameEvent(item, getSettings());
    if (frameEvent) { getWebSocketHub()?.broadcast(frameEvent); publishSceneGift?.(frameEvent); }
    const guardThanksEvent = buildGuardThanksEvent(item, getSettings());
    if (guardThanksEvent) { getWebSocketHub()?.broadcast(guardThanksEvent); publishSceneGift?.(guardThanksEvent); }
    publishDanmakuItem(message);
  }

  function publishGiftCatalogUpdate(snapshot) {
    getWebSocketHub()?.broadcast({ type: 'gift-catalog:update', snapshot });
    notifySceneOutput?.({ types: ['gift-feed', 'gift-wishes'], invalidateTypes: ['gift-feed', 'gift-wishes'] });
  }

  async function publishGiftEffect(input, isCurrent) {
    const event = normalizeGiftEffectEvent(input);
    if (!event || !isCurrent() || getSettings()?.giftEffectDanmakuEnabled !== 'true') return false;
    let effect;
    try {
      effect = await resolveGiftEffect(Number(event.giftId));
    } catch {
      return false;
    }
    if (!effect || !isCurrent() || getSettings()?.giftEffectDanmakuEnabled !== 'true') return false;
    getWebSocketHub()?.broadcast({ ...event, giftId: Number(event.giftId), effect });
    return true;
  }

  function publishDanmaku(danmaku) {
    const item = getDanmakuFeedBuffer().push(danmaku);
    publishDanmakuItem(item);
  }

  function publishDanmakuItem(item) {
    if (item) {
      getWebSocketHub()?.broadcast({ type: 'danmaku:message', item }, { topic: 'danmaku' });
    }
  }

  function publishOvertimeUpdate(update) {
    getWebSocketHub()?.broadcast({
      type: 'overtime:update',
      reason: update.reason,
      state: update.state,
      ...(update.adjustment ? { adjustment: update.adjustment } : {}),
    });
    notifySceneOutput?.({ types: ['overtime'] });
  }

  function servePageOrAsset(req, res, requestUrl) {
    httpUtils.servePageOrAsset(publicDir, req, res, requestUrl, getSessionToken(), beginPlaybackSnapshotSession, getClientTheme);
  }

  return {
    getWebSocketContext,
    broadcastSnapshot,
    publishGiftFlushed,
    publishGiftCatalogUpdate,
    publishGiftEffect,
    publishDanmaku,
    publishOvertimeUpdate,
    servePageOrAsset,
  };
}

module.exports = { createRuntimeTransport };
