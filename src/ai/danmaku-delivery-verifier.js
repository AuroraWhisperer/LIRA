'use strict';

const { cleanText } = require('../shared/utils');

const DEFAULT_TIMEOUT_MS = 10000;
const EVENT_TTL_MS = 60000;

function createDanmakuDeliveryVerifier(options = {}) {
  const now = options.now || Date.now;
  const sentChunks = new Set();
  const pending = new Set();
  let disposed = false;

  function trackSend({ accountUid, message, mentionName }) {
    if (disposed) return;
    const sentAt = now();
    pruneChunks(sentAt);
    const target = cleanText(mentionName);
    const text = cleanText(message);
    sentChunks.add({ uid: cleanText(accountUid), message: text, mentionName: target,
      mentioned: target ? `@${target} ${text}` : null, sentAt, echoAt: null });
  }

  function observe(danmaku = {}) {
    if (disposed || (!sentChunks.size && !pending.size)) return;
    const uid = cleanText(danmaku.uid);
    const observedAt = now();
    pruneChunks(observedAt);
    let message;
    let expected;
    for (const chunk of sentChunks) {
      if (chunk.uid !== uid || chunk.echoAt !== null) continue;
      message ??= cleanText(danmaku.message);
      // A failed send can leave an older expectation for the same chunk.
      if (message === chunk.message || message === chunk.mentioned) expected = chunk;
    }
    for (const waiter of pending) {
      if (waiter.accountUid !== uid || waiter.sentAfter > observedAt) continue;
      message ??= cleanText(danmaku.message);
      if (match(waiter, message, expected)) return;
    }
    if (expected) expected.echoAt = observedAt;
  }

  function waitForDelivery(delivery = {}) {
    if (disposed) return Promise.resolve(false);
    const waiter = {
      accountUid: cleanText(delivery.accountUid),
      mentionName: cleanText(delivery.mentionName),
      messages: Array.isArray(delivery.messages) ? delivery.messages.map(cleanText).filter(Boolean) : [],
      sentAfter: Number(delivery.sentAfter) || now(),
      matched: new Set(),
      resolve: null,
      timer: null,
      signal: delivery.signal,
      onAbort: null,
    };
    if (!waiter.accountUid || !waiter.messages.length) return Promise.resolve(false);

    return new Promise((resolve) => {
      waiter.resolve = resolve;
      pending.add(waiter);
      if (waiter.signal) {
        waiter.onAbort = () => finish(waiter, false);
        waiter.signal.addEventListener('abort', waiter.onAbort, { once: true });
        if (waiter.signal.aborted) return waiter.onAbort();
      }
      pruneChunks(now());
      for (const chunk of sentChunks) {
        if (chunk.uid !== waiter.accountUid || chunk.echoAt === null || chunk.echoAt < waiter.sentAfter) continue;
        match(waiter, chunk.message, chunk);
        if (!pending.has(waiter)) break;
      }
      if (!pending.has(waiter)) return;
      const timeoutMs = Math.max(1, Number(delivery.timeoutMs) || DEFAULT_TIMEOUT_MS);
      waiter.timer = setTimeout(() => finish(waiter, false), timeoutMs);
    });
  }

  function match(waiter, message, chunk) {
    if (chunk && (chunk.sentAt < waiter.sentAfter || (chunk.mentionName && chunk.mentionName !== waiter.mentionName))) return false;
    const index = chunk
      ? waiter.messages.findIndex((text, i) => !waiter.matched.has(i) && text === chunk.message)
      : findExpectedMessage(waiter, message);
    if (index < 0) return false;
    if (chunk) sentChunks.delete(chunk);
    waiter.matched.add(index);
    if (waiter.matched.size === waiter.messages.length) finish(waiter, true);
    return true;
  }

  function findExpectedMessage(waiter, observedMessage) {
    const candidates = [observedMessage];
    if (waiter.mentionName) {
      const prefix = `@${waiter.mentionName} `;
      if (observedMessage.startsWith(prefix)) candidates.push(cleanText(observedMessage.slice(prefix.length)));
    }
    return waiter.messages.findIndex((message, index) => !waiter.matched.has(index) && candidates.includes(message));
  }

  function finish(waiter, delivered) {
    if (!pending.delete(waiter)) return;
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    waiter.resolve(delivered);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    sentChunks.clear();
    for (const waiter of Array.from(pending)) finish(waiter, false);
  }

  function pruneChunks(time) {
    for (const chunk of sentChunks) {
      if (chunk.sentAt >= time - EVENT_TTL_MS) break;
      if (chunk.echoAt === null || chunk.echoAt < time - EVENT_TTL_MS) sentChunks.delete(chunk);
    }
  }

  return { trackSend, observe, waitForDelivery, dispose };
}

module.exports = {
  createDanmakuDeliveryVerifier,
  DEFAULT_TIMEOUT_MS,
};
