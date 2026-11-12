'use strict';

const pageAssets = require('./page-assets');
const { serveFontAsset } = require('./font-assets');
const { serveResourceAsset } = require('./resource-assets');
const { buildGiftFrameEvent, buildGiftFrameStyleEvent } = require('../bilibili/gift/frame-config');
const { buildGiftMotionEvents } = require('../bilibili/gift/motion-config');
const { createGiftArtworkResolver } = require('../../public/js/shared/gift-banner.js');
const { buildGuardThanksEvents, buildNauticalGuardThanksEvent } = require('../bilibili/gift/guard-thanks-config');
const { normalizeGiftEffectEvent } = require('../bilibili/gift/effect-event');

const SNAPSHOT_SCENE_TYPES = ['queue', 'overtime', 'songlist', 'opening', 'lyrics', 'now-playing', 'gift-feed', 'gift-wishes', 'heart-box-collection', 'gift-sprint', 'blindbox'];
const GIFT_SCENE_TYPES = ['overtime', 'gift-feed', 'gift-wishes', 'heart-box-collection', 'gift-sprint', 'blindbox'];

function snapshotSceneTypes(reason) {
  if (reason === 'settings' || reason === 'component:styles' || reason === 'bilibili:room-guard') return undefined;
  if (reason === 'gift:wishes') return ['gift-wishes'];
  if (reason === 'gift:heart-box-collection') return ['heart-box-collection'];
  if (/^(?:gift:|bilibili:gift$|database:clear-gifts$)/.test(reason)) return GIFT_SCENE_TYPES;
  if (/^(?:queue:|superchat:|bilibili:(?:danmaku|superchat)$|database:clear-superchats$)/.test(reason)) return ['queue'];
  if (/^(?:songs:|cloud:songs$|database:clear$)/.test(reason)) return ['queue', 'songlist'];
  if (reason === 'database:clear-playback') return ['lyrics', 'now-playing'];
  return SNAPSHOT_SCENE_TYPES;
}

function createRuntimeTransport({
  publicDir,
  getFontLibrary,
  getResourceLibrary,
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
  resolveGiftMotionArtwork,
  getGiftFrameStyleIds,
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
      ...(reason === 'gift:wishes' ? { invalidateTypes: ['gift-wishes'] }
        : reason === 'gift:heart-box-collection' ? { invalidateTypes: ['heart-box-collection'] }
        : reason === 'settings' ? { invalidateTypes: ['blindbox'] } : {}) });
  }

  function readGiftFrameStyleIds() {
    try { return getGiftFrameStyleIds?.() || []; } catch { return []; }
  }

  function publishGiftFlushed(item) {
    const startedAt = Date.now();
    const message = getDanmakuFeedBuffer().pushGift(item);
    broadcastSnapshot('bilibili:gift');
    const settings = getSettings();
    const frameEvent = buildGiftFrameEvent(item, settings);
    if (frameEvent) { getWebSocketHub()?.broadcast(frameEvent); publishSceneGift?.(frameEvent); }
    // Imported styles exist only as scene layers; the legacy overlay page would replay them as woodland.
    const styleEvent = buildGiftFrameStyleEvent(item, settings, readGiftFrameStyleIds());
    if (styleEvent) publishSceneGift?.(styleEvent);
    const motionEvents = buildGiftMotionEvents(item, settings, { startedAt });
    if (motionEvents.length) {
      const artworkPath = resolveGiftMotionArtwork?.(item) || createGiftArtworkResolver([])({
        giftId: String(item.gift_id || ''), giftName: item.gift_name, coinType: item.coin_type });
      for (const event of motionEvents) {
        event.artworkPath = artworkPath;
        getWebSocketHub()?.broadcast(event); publishSceneGift?.(event);
      }
    }
    for (const event of buildGuardThanksEvents(item, settings)) {
      getWebSocketHub()?.broadcast(event); publishSceneGift?.(event);
    }
    const nauticalEvent = buildNauticalGuardThanksEvent(item, settings);
    if (nauticalEvent) publishSceneGift?.(nauticalEvent);
    publishDanmakuItem(message);
  }

  function publishGiftCatalogUpdate(snapshot) {
    getWebSocketHub()?.broadcast({ type: 'gift-catalog:update', snapshot });
    notifySceneOutput?.({ types: ['gift-feed', 'gift-wishes', 'heart-box-collection'], invalidateTypes: ['gift-feed', 'gift-wishes', 'heart-box-collection'] });
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

  function publishSuperChatDelete(messageIds) {
    const removed = getDanmakuFeedBuffer().removeSuperChats(messageIds);
    if (removed.length) {
      getWebSocketHub()?.broadcast({ type: 'danmaku:superchat-delete', messageIds: removed }, { topic: 'danmaku' });
    }
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

  async function servePageOrAsset(req, res, requestUrl) {
    if (await serveResourceAsset(getResourceLibrary?.(), req, res, requestUrl)) return;
    if (await serveFontAsset(getFontLibrary?.(), req, res, requestUrl)) return;
    pageAssets.servePageOrAsset(publicDir, req, res, requestUrl, getSessionToken(), beginPlaybackSnapshotSession, getClientTheme, Boolean(getFontLibrary?.()));
  }

  return {
    getWebSocketContext,
    broadcastSnapshot,
    publishGiftFlushed,
    publishGiftCatalogUpdate,
    publishGiftEffect,
    publishDanmaku,
    publishSuperChatDelete,
    publishOvertimeUpdate,
    servePageOrAsset,
  };
}

module.exports = { createRuntimeTransport };
