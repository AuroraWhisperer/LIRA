import { shanghaiToday } from './gift-feed-state.js';

function valueInCents(item) {
  return item.cardTotalCents !== undefined ? BigInt(item.cardTotalCents)
    : BigInt(Math.round(item.gift.unitPrice * 100)) * BigInt(item.gift.num);
}

export function addGiftCardTotals(card, item) {
  card.cardTotalCents = (valueInCents(card) + valueInCents(item)).toString();
  const quantity = BigInt(card.gift.num) + BigInt(item.gift.num);
  card.gift.num = quantity <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(quantity) : quantity.toString();
}

export function buildGiftCards(items, { day = shanghaiToday(), profiles = [], mergeToday = true, keepSourceEventId = false } = {}) {
  const senders = new Map();
  const identities = new Map();
  for (const evidence of [...profiles].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!evidence.senderId || shanghaiToday(Date.parse(evidence.createdAt)) !== day) continue;
    identities.set(evidence.eventId, evidence.senderId);
    const profile = senders.get(evidence.senderId) || {};
    if (evidence.userName) profile.userName = evidence.userName;
    if (evidence.avatarUrl) profile.avatarUrl = evidence.avatarUrl;
    if (evidence.guardLevel !== null) profile.guardLevel = evidence.guardLevel;
    senders.set(evidence.senderId, profile);
  }

  const cards = [];
  const groups = new Map();
  for (const item of items) {
    const senderId = identities.get(item.eventId);
    const gift = item.gift;
    if (!senderId || !gift.createdAt || shanghaiToday(Date.parse(gift.createdAt)) !== day) {
      cards.push(item);
      continue;
    }
    const key = mergeToday && gift.giftId && gift.giftName ? JSON.stringify([day, senderId, gift.giftId, gift.giftName]) : null;
    let card = key && groups.get(key);
    if (!card) {
      card = {
        ...item,
        eventId: key ? `card:${key}` : item.eventId,
        gift: { ...gift, ...senders.get(senderId) },
        cardTotalCents: valueInCents(item).toString(),
        ...(keepSourceEventId && key ? { sourceEventId: item.eventId } : {}),
      };
      cards.push(card);
      if (key) groups.set(key, card);
    } else {
      addGiftCardTotals(card, item);
    }
  }
  return cards;
}
