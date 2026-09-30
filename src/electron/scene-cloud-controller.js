'use strict';

const { randomUUID } = require('node:crypto');
const { readBoundedSse, parseEventBlock } = require('../shared/bounded-sse-reader');
const { isDnsHostname } = require('../shared/remote-url-policy');
const { DANMAKU_STYLE_OPTIONS, normalizeStyleOptions } = require('../shared/danmaku-style-options');
const { normalizeLayout } = require('../shared/danmaku-layout');

function getSceneOwner(licenseManager) {
  try {
    if (licenseManager?.isAuthorized?.() !== true) return null;
    const identity = licenseManager.getCloudSyncIdentity();
    if (!['string', 'number'].includes(typeof identity?.streamerId) || !String(identity.streamerId).trim()) return null;
    if (typeof identity.streamerId === 'number' && (!Number.isSafeInteger(identity.streamerId) || identity.streamerId <= 0)) return null;
    const url = new URL(licenseManager.getRemoteBaseUrl());
    if (url.protocol !== 'https:' || !isDnsHostname(url.hostname) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return null;
    const epoch = licenseManager.getAuthorizationEpoch();
    if (!Number.isSafeInteger(epoch) || epoch < 0) return null;
    return { scope: JSON.stringify([url.origin, String(identity.streamerId)]), epoch };
  } catch {
    return null;
  }
}

function createSceneCloudController({ licenseManager, publish, fetchImpl = fetch, timers = globalThis }) {
  let started = false;
  let disposed = false;
  let unsubscribe = null;
  let current = null;
  let retryTimer = null;
  let retryDelay = 1000;
  const operations = new Set();

  function context() {
    const owner = getSceneOwner(licenseManager);
    return owner ? { ownerScope: owner.scope, authorizationEpoch: owner.epoch } : null;
  }

  function matches(left, right) {
    return left?.ownerScope === right?.ownerScope && left?.authorizationEpoch === right?.authorizationEpoch;
  }

  function active(captured) {
    if (!started || current !== captured || captured.controller.signal.aborted) return false;
    if (matches(captured, context())) return true;
    refresh();
    return false;
  }

  function update(captured, status, event) {
    if (!active(captured)) return;
    publish({
      ownerScope: captured.ownerScope,
      authorizationEpoch: captured.authorizationEpoch,
      connectionEpoch: captured.connectionEpoch,
      status,
      ...(event ? { event } : {}),
    });
  }

  function offline(previous) {
    const owner = context();
    publish({ ownerScope: owner?.ownerScope ?? null, authorizationEpoch: owner?.authorizationEpoch ?? null,
      connectionEpoch: previous?.connectionEpoch ?? randomUUID(), status: 'offline' });
  }

  function cancel() {
    timers.clearTimeout(retryTimer);
    retryTimer = null;
    const previous = current;
    current = null;
    if (previous) {
      timers.clearTimeout(previous.timeout);
      previous.controller.abort();
    }
  }

  function refresh() {
    if (!started) return;
    const next = context();
    if (current && matches(current, next)) return;
    cancel();
    retryDelay = 1000;
    if (next) connect(next);
    else offline();
  }

  function connect(owner) {
    const captured = { ...owner, connectionEpoch: randomUUID(), controller: new AbortController(), timeout: null };
    current = captured;
    update(captured, 'connecting');
    if (active(captured)) {
      const operation = consume(captured);
      operations.add(operation);
      void operation.then(() => operations.delete(operation), () => operations.delete(operation));
    }
  }

  function deadline(captured, delay) {
    timers.clearTimeout(captured.timeout);
    captured.timeout = timers.setTimeout(() => disconnect(captured), delay);
    captured.timeout?.unref?.();
  }

  function disconnect(captured) {
    if (!active(captured)) return;
    update(captured, 'offline');
    timers.clearTimeout(captured.timeout);
    captured.controller.abort();
    if (!started || current !== captured) return;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (!started || current !== captured) return;
      const next = context();
      if (!matches(captured, next)) refresh();
      else connect(next);
    }, retryDelay);
    retryTimer?.unref?.();
    retryDelay = Math.min(retryDelay * 2, 30000);
  }

  async function consume(captured) {
    let initialized = false;
    let liveSessionId = null;
    deadline(captured, 15000);
    try {
      const settings = await licenseManager.getOverlaySettings();
      if (!active(captured)) return;
      const url = streamUrl(settings?.overlayUrl);
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: captured.controller.signal,
      });
      if (!active(captured) || !response.ok || response.redirected ||
          (response.url && response.url !== url) ||
          !/^text\/event-stream(?:\s*;|$)/iu.test(response.headers?.get('content-type') || '') ||
          !response.body?.getReader) {
        await response.body?.cancel?.();
        throw new Error('INVALID_STREAM');
      }
      await readBoundedSse(response, {
        signal: captured.controller.signal,
        createLimitError: () => new Error('EVENT_TOO_LARGE'),
        onOpen: () => update(captured, 'connecting'),
        onBlock: (block) => {
          if (!active(captured)) return;
          const { eventName, data } = parseEventBlock(block);
          if (!eventName && !data) {
            if (initialized) deadline(captured, 45000);
            return;
          }
          requireValid(eventName === 'overlay-event' && data);
          const event = displayEvent(JSON.parse(data));
          if (!initialized) {
            requireValid(event.type === 'overlay-state');
            initialized = true;
            liveSessionId = event.liveSessionId;
            retryDelay = 1000;
          } else {
            requireValid(event.type !== 'overlay-state');
            if (event.type === 'live-started') {
              requireValid(liveSessionId === null);
              liveSessionId = event.liveSessionId;
            } else if (event.type !== 'overlay-settings') {
              requireValid(liveSessionId !== null && liveSessionId === event.liveSessionId);
              if (event.type === 'live-ended') liveSessionId = null;
            }
          }
          deadline(captured, 45000);
          update(captured, 'connected', event);
        },
      });
    } catch {
      disconnect(captured);
      return;
    }
    disconnect(captured);
  }

  function start() {
    if (started || disposed) return;
    started = true;
    unsubscribe = licenseManager.onStateChanged(refresh);
    refresh();
  }

  function stop() {
    if (!started) return;
    started = false;
    unsubscribe?.();
    unsubscribe = null;
    const previous = current;
    cancel();
    offline(previous);
  }

  function dispose() {
    disposed = true;
    stop();
  }

  async function whenIdle() {
    while (operations.size) await Promise.allSettled([...operations]);
  }

  return { start, stop, dispose, whenIdle };
}

function requireValid(condition) {
  if (!condition) throw new Error('INVALID_OVERLAY_EVENT');
}

function streamUrl(value) {
  requireValid(typeof value === 'string' && value.length <= 2048);
  const url = new URL(value);
  requireValid(url.protocol === 'https:' && isDnsHostname(url.hostname) && !url.username && !url.password &&
    !url.search && !url.hash && /^\/overlay\/[A-Za-z0-9_-]{16}$/.test(url.pathname));
  return `${url.origin}/api/public/overlay/events?token=${url.pathname.slice('/overlay/'.length)}`;
}

function text(value, maximum, minimum = 1) {
  requireValid(typeof value === 'string' && value.length >= minimum && value.length <= maximum);
  return value;
}

function integer(value, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  requireValid(Number.isSafeInteger(value) && value >= minimum && value <= maximum);
  return value;
}

function amount(value, positive = false) {
  requireValid(Number.isFinite(value) && (positive ? value > 0 : value >= 0));
  return value;
}

function timestamp(value) {
  text(value, 64);
  requireValid(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value)));
  return value;
}

function imageUrl(value) {
  if (value === '') return '';
  text(value, 2048);
  const url = new URL(value);
  requireValid(url.protocol === 'https:' && isDnsHostname(url.hostname) && url.hostname.endsWith('.hdslb.com') &&
    !url.username && !url.password && !url.port);
  return `${url.origin}${url.pathname}`;
}

function appearance(value) {
  requireValid(Object.hasOwn(DANMAKU_STYLE_OPTIONS, value.style));
  return {
    style: value.style,
    ...(value.fullscreenDurationSeconds === undefined ? {} : {
      fullscreenDurationSeconds: integer(value.fullscreenDurationSeconds, 2, 30),
    }),
    ...(value.styleOptions === undefined ? {} : { styleOptions: normalizeStyleOptions(value.styleOptions) }),
    ...(value.layout === undefined ? {} : { layout: normalizeLayout(value.layout) }),
  };
}

function displayEvent(value) {
  requireValid(value && typeof value === 'object' && !Array.isArray(value));
  const { type } = value;
  if (type === 'overlay-state') {
    requireValid(['stopped', 'starting', 'waiting-live', 'connecting', 'running', 'reconnecting', 'error'].includes(value.state));
    requireValid([null, 0, 1].includes(value.liveStatus));
    const liveSessionId = value.liveSessionId === null ? null : text(value.liveSessionId, 128);
    const confirmationMessage = value.confirmationMessage === null ? null : text(value.confirmationMessage, 200);
    requireValid((liveSessionId === null) === (confirmationMessage === null));
    requireValid(liveSessionId === null || value.liveStatus === 1);
    return { type, ...appearance(value), state: value.state, liveStatus: value.liveStatus, liveSessionId, confirmationMessage };
  }
  if (type === 'overlay-settings') return { type, ...appearance(value), timestamp: timestamp(value.timestamp) };
  requireValid(['live-started', 'live-ended', 'danmaku', 'gift', 'superchat'].includes(type));
  const result = { type, liveSessionId: text(value.liveSessionId, 128), timestamp: timestamp(value.timestamp) };
  if (type === 'live-ended') return result;
  if (type === 'live-started') return { ...result, message: text(value.message, 200) };
  result.name = text(value.name, 80);
  if (type === 'gift') {
    return {
      ...result,
      giftName: text(value.giftName, 100),
      giftCount: integer(value.giftCount, 1),
      ...(value.giftTotalPrice === undefined ? {} : { giftTotalPrice: amount(value.giftTotalPrice) }),
      ...(value.giftImageUrl === undefined ? {} : { giftImageUrl: imageUrl(value.giftImageUrl) }),
    };
  }
  result.message = text(value.message, type === 'danmaku' ? 500 : 64 * 1024);
  result.avatarUrl = imageUrl(value.avatarUrl);
  if (type === 'superchat') {
    requireValid(/\S/u.test(result.message));
    result.price = amount(value.price, true);
    if (value.colors !== undefined) {
      requireValid(value.colors && typeof value.colors === 'object' && !Array.isArray(value.colors));
      result.colors = {};
      for (const key of ['backgroundColor', 'accentColor', 'priceColor']) {
        if (value.colors[key] === undefined) continue;
        requireValid(typeof value.colors[key] === 'string' && /^#[0-9a-f]{6}$/iu.test(value.colors[key]));
        result.colors[key] = value.colors[key];
      }
    }
    return result;
  }
  result.guardLevel = integer(value.guardLevel, 0, 3);
  result.medalName = text(value.medalName, 32, 0);
  result.medalLevel = integer(value.medalLevel, 0);
  if (value.isStreamer !== undefined) {
    requireValid(typeof value.isStreamer === 'boolean');
    result.isStreamer = value.isStreamer;
  }
  requireValid(Array.isArray(value.emotes) && value.emotes.length <= 32);
  result.emotes = value.emotes.map((emote) => {
    requireValid(emote && typeof emote === 'object' && !Array.isArray(emote));
    requireValid(emote.kind === undefined || ['inline', 'sticker'].includes(emote.kind));
    requireValid(emote.url !== '');
    return {
      text: text(emote.text, 80), url: imageUrl(emote.url),
      width: integer(emote.width, 0, 512), height: integer(emote.height, 0, 512),
      ...(emote.kind === undefined ? {} : { kind: emote.kind }),
    };
  });
  return result;
}

module.exports = { createSceneCloudController, getSceneOwner };
