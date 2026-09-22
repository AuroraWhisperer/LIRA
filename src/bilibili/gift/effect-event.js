'use strict';

function normalizeGiftEffectEvent(input) {
  if (
    input?.type !== 'gift:effect' ||
    input.source !== 'danmaku' ||
    typeof input.eventId !== 'string' ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(input.eventId) ||
    typeof input.giftId !== 'string' ||
    !/^[1-9]\d{0,11}$/u.test(input.giftId)
  )
    return null;
  return {
    type: 'gift:effect',
    source: 'danmaku',
    eventId: input.eventId,
    giftId: input.giftId,
  };
}

module.exports = { normalizeGiftEffectEvent };
