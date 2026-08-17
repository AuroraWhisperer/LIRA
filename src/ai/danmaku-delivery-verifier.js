'use strict';

const { cleanText } = require('../shared/utils');

const DEFAULT_TIMEOUT_MS = 10000;
const EVENT_TTL_MS = 60000;

function createDanmakuDeliveryVerifier(options = {}) {
  const now = options.now || Date.now;
  const events = [];
  const pending = new Set();
  let disposed = false;

  function observe(danmaku = {}) {
    if (disposed) return;
    const uid = cleanText(danmaku.uid);
    const message = cleanText(danmaku.message);
    if (!uid || !message) return;
    events.push({ uid, message, observedAt: now(), consumed: false });
    pruneEvents();
    for (const waiter of pending) checkWaiter(waiter);
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
      onAbort: null
    };
    if (!waiter.accountUid || !waiter.messages.length) return Promise.resolve(false);

    return new Promise((resolve) => {
      waiter.resolve = resolve;
      pending.add(waiter);
      if (waiter.signal) {
        waiter.onAbort = () => finish(waiter, false);
        waiter.signal.addEventListener('abort', waiter.onAbort, { once: true });
        if (waiter.signal.aborted) waiter.onAbort();
      }
      checkWaiter(waiter);
      if (!pending.has(waiter)) return;
      const timeoutMs = Math.max(1, Number(delivery.timeoutMs) || DEFAULT_TIMEOUT_MS);
      waiter.timer = setTimeout(() => finish(waiter, false), timeoutMs);
    });
  }

  function checkWaiter(waiter) {
    for (const event of events) {
      if (event.consumed || event.uid !== waiter.accountUid || event.observedAt < waiter.sentAfter) continue;
      const index = findExpectedMessage(waiter, event.message);
      if (index < 0) continue;
      event.consumed = true;
      waiter.matched.add(index);
      if (waiter.matched.size === waiter.messages.length) {
        finish(waiter, true);
        return;
      }
    }
  }

  function findExpectedMessage(waiter, observedMessage) {
    const candidates = [observedMessage];
    if (waiter.mentionName) {
      const prefix = `@${waiter.mentionName} `;
      if (observedMessage.startsWith(prefix)) candidates.push(cleanText(observedMessage.slice(prefix.length)));
    }
    return waiter.messages.findIndex((message, index) => (
      !waiter.matched.has(index) && candidates.includes(message)
    ));
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
    events.length = 0;
    for (const waiter of Array.from(pending)) finish(waiter, false);
  }

  function pruneEvents() {
    const cutoff = now() - EVENT_TTL_MS;
    while (events.length && events[0].observedAt < cutoff) events.shift();
  }

  return { observe, waitForDelivery, dispose };
}

module.exports = {
  createDanmakuDeliveryVerifier,
  DEFAULT_TIMEOUT_MS
};
