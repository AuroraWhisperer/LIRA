'use strict';

const { randomUUID } = require('node:crypto');
const clone = (value) => JSON.parse(JSON.stringify(value));

function pick(value, fields) {
  return Object.fromEntries(fields.split(' ').filter((key) => Object.hasOwn(value, key) &&
    (value[key] === null || ['string', 'boolean'].includes(typeof value[key]) || Number.isFinite(value[key])))
    .map((key) => [key, value[key]]));
}

function displayEvent(event) {
  if (event.type === 'superchat-delete') return { ...pick(event, 'type liveSessionId timestamp'), messageIds: [...event.messageIds] };
  const result = pick(event, 'type liveSessionId timestamp name');
  if (event.type === 'entry') return { ...result, ...pick(event, 'guardLevel') };
  if (event.type === 'gift') return { ...result, ...pick(event, 'giftName giftCount giftTotalPrice giftImageUrl avatarUrl giftGuardLevel honorLevel') };
  Object.assign(result, pick(event, 'message avatarUrl'));
  if (event.type === 'superchat') {
    Object.assign(result, pick(event, 'price messageId'));
    if (event.colors && typeof event.colors === 'object') result.colors = pick(event.colors, 'backgroundColor accentColor priceColor');
  } else {
    Object.assign(result, pick(event, 'guardLevel medalName medalLevel isStreamer honorLevel roomGuardLevel'));
    if (event.roomMedal && typeof event.roomMedal === 'object' && !Array.isArray(event.roomMedal)) {
      result.roomMedal = pick(event.roomMedal, 'name level guardLevel isLight colorStart colorEnd colorBorder colorText');
    }
    result.emotes = Array.isArray(event.emotes) ? event.emotes.slice(0, 32)
      .filter((emote) => emote && typeof emote === 'object')
      .map((emote) => pick(emote, 'text url kind width height')) : [];
  }
  return result;
}

function createCloudDisplayBuffer({ getOwner, onRead = () => {} }) {
  let owner = null;
  let epoch = randomUUID();
  let connectionEpoch = null;
  let status = 'offline';
  let state = null;
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
    if (event.type === 'overlay-state') {
      if (!['stopped', 'starting', 'waiting-live', 'connecting', 'running', 'reconnecting', 'error'].includes(event.state)
        || ![null, 0, 1].includes(event.liveStatus)
        || !(event.liveSessionId === null && event.confirmationMessage === null
          || typeof event.liveSessionId === 'string' && event.liveSessionId && event.liveStatus === 1
          && typeof event.confirmationMessage === 'string' && event.confirmationMessage)) return false;
    }
    if (event.type === 'overlay-state') {
      reset();
      state = pick(event, 'type state liveStatus liveSessionId confirmationMessage');
      if (event.roomGuard) state.roomGuard = pick(event.roomGuard, 'roomId count');
    } else if (event.type === 'room-guard') {
      state.roomGuard = pick(event, 'roomId count');
    } else if (event.type === 'live-started') {
      if (state.liveSessionId || typeof event.liveSessionId !== 'string' || !event.liveSessionId
        || typeof event.message !== 'string' || !event.message) return false;
      const roomGuard = state.roomGuard;
      reset();
      state = { type: 'overlay-state', liveStatus: 1, liveSessionId: event.liveSessionId,
        confirmationMessage: event.message, state: 'running', roomGuard };
    } else if (event.type === 'live-ended') {
      if (!state.liveSessionId || state.liveSessionId !== event.liveSessionId) return false;
      const roomGuard = state.roomGuard;
      reset();
      state = { type: 'overlay-state', liveStatus: 0, liveSessionId: null, confirmationMessage: null, state: 'running', roomGuard };
    } else if (['danmaku', 'gift', 'superchat', 'superchat-delete', 'entry'].includes(event.type)) {
      if (!state?.liveSessionId || event.liveSessionId !== state.liveSessionId) return false;
      if (event.type === 'superchat-delete' && (!Array.isArray(event.messageIds) || !event.messageIds.length
        || event.messageIds.length > 128 || new Set(event.messageIds).size !== event.messageIds.length
        || !event.messageIds.every(isSuperChatMessageId))) return false;
      if (event.type === 'superchat' && event.messageId !== undefined && !isSuperChatMessageId(event.messageId)) return false;
      events.push({ cursor: ++cursor, event: displayEvent(event) });
      if (events.length > 200) events.shift();
    } else if (event.type !== 'overlay-settings') return false;
    status = 'connected';
    return true;
  }
  function getSnapshot(request = {}) {
    syncOwner();
    onRead();
    const requestedCursor = Number(request.cursor);
    const validCursor = (typeof request.cursor === 'number' || typeof request.cursor === 'string' && /^(0|[1-9]\d*)$/.test(request.cursor))
      && Number.isSafeInteger(requestedCursor) && requestedCursor >= 0 && requestedCursor <= cursor;
    const gap = request.epoch === epoch && validCursor && events.length > 0 && requestedCursor < events[0].cursor - 1;
    const resetRequired = request.epoch !== epoch || !validCursor || gap;
    return { epoch, status, state: clone(state), nextCursor: cursor, reset: resetRequired, gap,
      events: resetRequired ? [] : events.filter((entry) => entry.cursor > requestedCursor).map((entry) => clone(entry.event)) };
  }
  return { receive, getSnapshot };
}

function isSuperChatMessageId(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

module.exports = { createCloudDisplayBuffer };
