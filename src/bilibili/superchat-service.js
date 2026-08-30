// 编写人：Aurora
// SuperChat 领域规则；持久化由 storage/superchat-store.js 实现。
'use strict';

const {
  cleanText,
  now,
  timestampToIso,
  normalizeSuperChatPrice,
  normalizeGuardLevel,
  normalizePositiveInteger,
} = require('../shared/utils');

const SUPER_CHAT_PIN_THRESHOLD = 2;
const SUPER_CHAT_DISPLAY_THRESHOLD = 2;

function addSuperChatItem(context, input) {
  const price = normalizeSuperChatPrice(input && input.price);
  if (price < SUPER_CHAT_DISPLAY_THRESHOLD) return null;

  const platformId = cleanText(input && input.platformId);
  if (platformId) {
    const existing = context.store.findByPlatformId(platformId);
    if (existing) return existing.status === 'deleted' ? null : existing;
  }

  const createdAt = timestampToIso(input && input.messageTimestamp) || now();
  return context.store.insert({
    platformId,
    uid: cleanText(input && input.uid),
    userName: cleanText(input && input.userName) || '观众',
    price,
    message: cleanText(input && input.message),
    requesterGuardLevel: normalizeGuardLevel(
      input && input.requesterGuardLevel,
    ),
    requesterMedalName: cleanText(input && input.requesterMedalName),
    requesterMedalLevel: normalizePositiveInteger(
      input && input.requesterMedalLevel,
    ),
    createdAt,
  });
}

function handleSuperChatAction(context, action, rawId) {
  const id = Number(rawId);
  if (!Number.isFinite(id)) throw new Error('缺少 SC ID。');

  if (action === 'delete') {
    context.store.setStatus(id, 'deleted', now());
    return getSuperChatSnapshot(context);
  }
  if (action === 'assist' || action === 'unassist') {
    context.store.setStatus(
      id,
      action === 'assist' ? 'assisted' : 'active',
      now(),
    );
    return getSuperChatSnapshot(context);
  }

  throw new Error('未知 SC 操作。');
}

function getSuperChatSnapshot(context) {
  return context.store.listActive();
}

module.exports = {
  SUPER_CHAT_PIN_THRESHOLD,
  SUPER_CHAT_DISPLAY_THRESHOLD,
  addSuperChatItem,
  handleSuperChatAction,
  getSuperChatSnapshot,
};
