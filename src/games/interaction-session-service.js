'use strict';

const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createPoll } = require('./poll');
const { createRating } = require('./rating');
const {
  validateInteractionConfig,
  inspectInteractionText,
  POLL_RULE,
  RATING_RULE,
} = require('../../public/js/shared/interaction-rules.js');

function createInteractionSessionService(options = {}) {
  const monotonicNow = options.now || (() => performance.now());
  const wallNow = options.wallNow || Date.now;
  const schedule = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  const broadcast = options.broadcast || (() => {});
  const runtimeId = randomUUID();
  let revision = 0;
  let session = null;
  let counter = null;
  let binding = null;
  let startedAtMs = 0;
  let deadlineMs = Infinity;
  let expiryTimer = null;
  let broadcastTimer = null;
  let unsubscribe = null;
  let disposed = false;
  let collecting = false;
  const eventIds = new Set();
  const timestamps = new Map();

  function fail(message, statusCode = 409) {
    throw Object.assign(new Error(message), { statusCode });
  }
  function state() {
    expire();
    return snapshot();
  }
  function snapshot() {
    if (!session) return { runtimeId, revision, session: null };
    const result = { ...session };
    if (session.kind === 'poll') {
      result.options = counter.result();
      result.participants = counter.count();
    } else {
      result.average = session.phase === 'finished' ? counter.average() : null;
      if (session.phase === 'finished') result.participants = counter.count();
    }
    return { runtimeId, revision, session: result };
  }
  function publish(immediate = true) {
    revision += 1;
    const nextCollecting = session?.phase === 'collecting';
    if (collecting !== nextCollecting) {
      collecting = nextCollecting;
      options.onCollectingChanged?.();
    }
    if (immediate) {
      cancel(broadcastTimer);
      broadcastTimer = null;
      broadcast({ type: 'interaction:update', state: snapshot() });
    } else if (broadcastTimer === null) {
      broadcastTimer = schedule(() => {
        broadcastTimer = null;
        broadcast({ type: 'interaction:update', state: snapshot() });
      }, 200);
    }
  }
  function detach() {
    unsubscribe?.();
    unsubscribe = null;
  }
  function release() {
    detach();
    cancel(expiryTimer);
    cancel(broadcastTimer);
    expiryTimer = broadcastTimer = null;
    eventIds.clear();
    timestamps.clear();
  }
  function expire() {
    if (session && session.phase !== 'finished' && monotonicNow() >= deadlineMs) finish(session.sessionId, 'timeout');
  }
  function requireSession(id) {
    if (!session || session.sessionId !== id) fail('本场已变化，请刷新后重试');
  }
  function start(input) {
    if (disposed) fail('服务已关闭');
    expire();
    if (session) fail('请先关闭当前互动结果');
    if (options.isGameActive?.()) fail('请先结束类别 1 的游戏');
    let config;
    try {
      config = validateInteractionConfig(input);
    } catch (error) {
      fail(error.message, 400);
    }
    const source = options.getSourceState();
    if (!source.ready) fail(source.reason || '实时弹幕尚未就绪');
    binding = { accountUid: source.accountUid, roomId: source.roomId, ownerUid: source.ownerUid };
    startedAtMs = monotonicNow();
    deadlineMs = config.kind === 'poll' ? startedAtMs + config.durationSeconds * 1000 : Infinity;
    counter = config.kind === 'poll' ? createPoll(config.options) : createRating();
    session = {
      sessionId: randomUUID(),
      kind: config.kind,
      title: config.title,
      phase: 'collecting',
      rule: config.kind === 'poll' ? POLL_RULE : RATING_RULE,
      startedAt: wallNow(),
      endsAt: config.kind === 'poll' ? wallNow() + config.durationSeconds * 1000 : null,
      receptionInterrupted: false,
      connected: true,
    };
    const id = session.sessionId;
    unsubscribe = options.subscribe((event) => {
      if (session?.sessionId === id) accept(event);
    });
    if (Number.isFinite(deadlineMs)) {
      const tick = () => {
        if (session?.sessionId !== id || session.phase === 'finished') return;
        expire();
        if (session.phase !== 'finished') expiryTimer = schedule(tick, Math.max(1, deadlineMs - monotonicNow()));
      };
      expiryTimer = schedule(tick, deadlineMs - startedAtMs);
    }
    publish();
    return state();
  }
  function sourceChanged() {
    expire();
    if (!session || session.phase !== 'collecting') return;
    const source = options.getSourceState();
    if (
      source.accountUid !== binding.accountUid ||
      source.configuredRoomChanged ||
      (source.roomId && source.roomId !== binding.roomId)
    ) {
      session.phase = 'interrupted';
      session.receptionInterrupted = true;
      session.connected = false;
      detach();
      publish();
    } else if (session.connected !== source.ready) {
      session.connected = source.ready;
      if (!source.ready) session.receptionInterrupted = true;
      publish();
    }
  }
  function accept(event) {
    sourceChanged();
    if (!session || session.phase !== 'collecting' || !session.connected) return false;
    const source = options.getSourceState();
    if (
      event.source !== 'danmaku' ||
      event.accountUid !== binding.accountUid ||
      event.roomId !== binding.roomId ||
      event.connectionKey !== source.connectionKey ||
      !Number.isFinite(event.receivedAt) ||
      event.receivedAt < startedAtMs ||
      monotonicNow() >= deadlineMs
    )
      return false;
    const uid = typeof event.uid === 'number' && !Number.isSafeInteger(event.uid) ? '' : String(event.uid || '');
    if (!/^[1-9]\d*$/.test(uid) || uid === binding.ownerUid || event.isStreamer) return false;
    const text = inspectInteractionText(event.message);
    if (text.error) return false;
    if (event.eventId && eventIds.has(event.eventId)) return false;
    const previous = timestamps.get(uid);
    if (Number.isFinite(event.platformTime) && Number.isFinite(previous) && event.platformTime < previous) return false;
    if (!counter.accept(uid, text.text)) return false;
    if (event.eventId) eventIds.add(event.eventId);
    if (Number.isFinite(event.platformTime)) timestamps.set(uid, event.platformTime);
    if (session.kind === 'poll') publish(false);
    return true;
  }
  function finish(id, reason = 'host') {
    requireSession(id);
    if (session.phase === 'finished') return snapshot();
    release();
    session.phase = 'finished';
    session.finishedAt = wallNow();
    session.finishReason = reason;
    publish();
    return snapshot();
  }
  function clear(id) {
    requireSession(id);
    release();
    session = counter = binding = null;
    publish();
    return snapshot();
  }
  function isCollecting() {
    sourceChanged();
    return session?.phase === 'collecting';
  }
  function getHostState() {
    sourceChanged();
    const source = options.getSourceState();
    return {
      ...state(),
      participants: counter?.count() || 0,
      ready: source.ready,
      blockedReason: session
        ? '请先关闭当前互动结果'
        : options.isGameActive?.()
          ? '请先结束类别 1 的游戏'
          : source.reason || '',
    };
  }
  function dispose() {
    disposed = true;
    release();
    session = counter = binding = null;
  }
  return { start, finish, clear, getState: state, getHostState, sourceChanged, isCollecting, dispose };
}

module.exports = { createInteractionSessionService };
