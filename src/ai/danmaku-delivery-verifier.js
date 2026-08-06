'use strict';

const { cleanText } = require('../shared/utils');

const DEFAULT_TIMEOUT_MS = 10000;
const EVENT_TTL_MS = 60000;

function createDanmakuDeliveryVerifier(options = {}) {
  const now = options.now || Date.now;
  const events = [];
  const pending = new Set();

  function observe(danmaku = {}) {
    const uid = cleanText(danmaku.uid);
    const message = cleanText(danmaku.message);
    if (!uid || !message) return;
    events.push({ uid, message, observedAt: now(), consumed: false });
    pruneEvents();
    for (const waiter of pending) checkWaiter(waiter);
  }

  function waitForDelivery(delivery = {}) {
    const waiter = {
      accountUid: cleanText(delivery.accountUid),
      mentionName: cleanText(delivery.mentionName),
      messages: Array.isArray(delivery.messages) ? delivery.messages.map(cleanText).filter(Boolean) : [],
      sentAfter: Number(delivery.sentAfter) || now(),
      matched: new Set(),
      resolve: null,
      timer: null
    };
    if (!waiter.accountUid || !waiter.messages.length) return Promise.resolve(false);

    return new Promise((resolve) => {
      waiter.resolve = resolve;
      pending.add(waiter);
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
    waiter.resolve(delivered);
  }

  function pruneEvents() {
    const cutoff = now() - EVENT_TTL_MS;
    while (events.length && events[0].observedAt < cutoff) events.shift();
  }

  return { observe, waitForDelivery };
}

module.exports = {
  createDanmakuDeliveryVerifier,
  DEFAULT_TIMEOUT_MS
};
