'use strict';

const { randomUUID } = require('node:crypto');
const { DANMAKU_STYLE_OPTIONS, normalizeStyleOptions } = require('../shared/danmaku-style-options');
const { normalizeStyleParameters } = require('../shared/component-style-parameters');
const { normalizeLayout } = require('../shared/danmaku-layout');
const clone = (value) => JSON.parse(JSON.stringify(value));

function pick(value, fields) {
  return Object.fromEntries(fields.split(' ').filter((key) => Object.hasOwn(value, key) &&
    (value[key] === null || ['string', 'boolean'].includes(typeof value[key]) || Number.isFinite(value[key])))
    .map((key) => [key, value[key]]));
}

function appearance(event) {
  const duration = event.fullscreenDurationSeconds ?? 6;
  if (!Object.hasOwn(DANMAKU_STYLE_OPTIONS, event.style) || !Number.isInteger(duration) || duration < 2 || duration > 30) return null;
  try {
    return { style: event.style, fullscreenDurationSeconds: duration,
      ...(event.styleParameters === undefined ? {} : { styleParameters: normalizeStyleParameters('danmaku', event.styleParameters) }),
      styleOptions: normalizeStyleOptions(event.styleOptions ?? {}), layout: normalizeLayout(event.layout ?? null) };
  } catch { return null; }
}

function displayEvent(event) {
  const result = pick(event, 'type liveSessionId timestamp name');
  if (event.type === 'entry') return { ...result, ...pick(event, 'guardLevel') };
  if (event.type === 'gift') return { ...result, ...pick(event, 'giftName giftCount giftTotalPrice giftImageUrl') };
  Object.assign(result, pick(event, 'message avatarUrl'));
  if (event.type === 'superchat') {
    Object.assign(result, pick(event, 'price'));
    if (event.colors && typeof event.colors === 'object') result.colors = pick(event.colors, 'backgroundColor accentColor priceColor');
  } else {
    Object.assign(result, pick(event, 'guardLevel medalName medalLevel isStreamer'));
    result.emotes = Array.isArray(event.emotes) ? event.emotes.slice(0, 32)
      .filter((emote) => emote && typeof emote === 'object')
      .map((emote) => pick(emote, 'text url kind width height')) : [];
  }
  return result;
}

function createCloudDisplayBuffer({ getOwner }) {
  let owner = null;
  let epoch = randomUUID();
  let connectionEpoch = null;
  let status = 'offline';
  let state = null;
  let settings = null;
  let cursor = 0;
  let events = [];
  function reset() {
    epoch = randomUUID();
    cursor = 0;
    events = [];
    state = null;
  }
  function syncOwner() {
    const current = getOwner();
    if (current?.scope !== owner?.scope || current?.epoch !== owner?.epoch) {
      owner = current ? { ...current } : null;
      connectionEpoch = null;
      status = 'offline';
      settings = null;
      reset();
    }
    return current;
  }
  function receive(update) {
    const current = syncOwner();
    if (!current || !update || update.ownerScope !== current.scope || update.authorizationEpoch !== current.epoch
      || typeof update.connectionEpoch !== 'string' || !update.connectionEpoch || update.connectionEpoch.length > 128
      || !['connecting', 'connected', 'offline'].includes(update.status)) return false;
    if (update.status === 'connecting') {
      if (connectionEpoch === update.connectionEpoch) return status === 'connecting';
      connectionEpoch = update.connectionEpoch;
      status = 'connecting';
      reset();
      return true;
    }
    if (connectionEpoch !== update.connectionEpoch) return false;
    if (update.status === 'offline') {
      if (status !== 'offline') reset();
      status = 'offline';
      return true;
    }
    if (status === 'offline') return false;
    const event = update.event;
    if (!event || typeof event !== 'object') return false;
    if (!state && event.type !== 'overlay-state') return false;
    if (state && event.type === 'overlay-state') return false;
    if (event.type === 'overlay-state' || event.type === 'overlay-settings') {
      const nextSettings = appearance(event);
      if (!nextSettings) return false;
      if (event.type === 'overlay-state' && (!['stopped', 'starting', 'waiting-live', 'connecting', 'running', 'reconnecting', 'error'].includes(event.state)
        || ![null, 0, 1].includes(event.liveStatus)
        || !(event.liveSessionId === null && event.confirmationMessage === null
          || typeof event.liveSessionId === 'string' && event.liveSessionId && event.liveStatus === 1
          && typeof event.confirmationMessage === 'string' && event.confirmationMessage))) return false;
      settings = nextSettings;
    }
    if (event.type === 'overlay-state') {
      reset();
      state = pick(event, 'type state liveStatus liveSessionId confirmationMessage');
    } else if (event.type === 'live-started') {
      if (state.liveSessionId || typeof event.liveSessionId !== 'string' || !event.liveSessionId
        || typeof event.message !== 'string' || !event.message) return false;
      reset();
      state = { type: 'overlay-state', liveStatus: 1, liveSessionId: event.liveSessionId,
        confirmationMessage: event.message, state: 'running' };
    } else if (event.type === 'live-ended') {
      if (!state.liveSessionId || state.liveSessionId !== event.liveSessionId) return false;
      reset();
      state = { type: 'overlay-state', liveStatus: 0, liveSessionId: null, confirmationMessage: null, state: 'running' };
    } else if (['danmaku', 'gift', 'superchat', 'entry'].includes(event.type)) {
      if (!state?.liveSessionId || event.liveSessionId !== state.liveSessionId) return false;
      events.push({ cursor: ++cursor, event: displayEvent(event) });
      if (events.length > 200) events.shift();
    } else if (event.type !== 'overlay-settings') return false;
    status = 'connected';
    return true;
  }
  function getSnapshot(request = {}) {
    syncOwner();
    const requestedCursor = Number(request.cursor);
    const validCursor = (typeof request.cursor === 'number' || typeof request.cursor === 'string' && /^(0|[1-9]\d*)$/.test(request.cursor))
      && Number.isSafeInteger(requestedCursor) && requestedCursor >= 0 && requestedCursor <= cursor;
    const gap = request.epoch === epoch && validCursor && events.length > 0 && requestedCursor < events[0].cursor - 1;
    const resetRequired = request.epoch !== epoch || !validCursor || gap;
    return { epoch, status, state: clone(state), nextCursor: cursor, reset: resetRequired, gap,
      events: resetRequired ? [] : events.filter((entry) => entry.cursor > requestedCursor).map((entry) => clone(entry.event)) };
  }
  return { receive, getSnapshot, getSettings() { syncOwner(); return clone(settings); } };
}

module.exports = { createCloudDisplayBuffer };
