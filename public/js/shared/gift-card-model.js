import { shanghaiToday } from './gift-feed-state.js';

export function buildGiftCards(items, { day = shanghaiToday(), profiles = [] } = {}) {
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
    const key = gift.giftId && gift.giftName ? JSON.stringify([day, senderId, gift.giftId, gift.giftName]) : null;
    const amount = BigInt(Math.round(gift.unitPrice * 100)) * BigInt(gift.num);
    let card = key && groups.get(key);
    if (!card) {
      card = {
        ...item,
        eventId: key ? `card:${key}` : item.eventId,
        gift: { ...gift, ...senders.get(senderId) },
        cardTotalCents: amount.toString(),
      };
      cards.push(card);
      if (key) groups.set(key, card);
    } else {
      const quantity = BigInt(card.gift.num) + BigInt(gift.num);
      card.gift.num = quantity <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(quantity) : quantity.toString();
      card.cardTotalCents = (BigInt(card.cardTotalCents) + amount).toString();
    }
  }
  return cards;
}
