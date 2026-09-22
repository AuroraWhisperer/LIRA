'use strict';

const crypto = require('node:crypto');

function giftVariantId(gift) {
  const id = Number(gift?.giftId ?? gift?.id);
  const name = String(gift?.name ?? gift?.giftName ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !name ||
    [...name].length > 100 ||
    !Number.isSafeInteger(gift?.priceRaw) ||
    gift.priceRaw < 0 ||
    !['gold', 'silver'].includes(gift.coinType) ||
    typeof gift.bagGift !== 'boolean'
  )
    return null;
  return `gv_${crypto
    .createHash('sha256')
    .update(JSON.stringify([String(id), name, gift.priceRaw, gift.coinType, gift.bagGift]))
    .digest('hex')}`;
}

function validateRuleGiftIdentity(rule) {
  if (rule.giftIdentity == null) return null;
  const identity = rule.giftIdentity;
  if (
    typeof identity !== 'object' ||
    Array.isArray(identity) ||
    !/^[1-9]\d*$/u.test(String(rule.giftId)) ||
    !/^gv_[a-f0-9]{64}$/u.test(identity.variantId) ||
    giftVariantId({ ...identity, giftId: rule.giftId, name: rule.giftName }) !== identity.variantId
  ) {
    throw new Error('礼物身份不完整，请从礼物目录重新选择。');
  }
  return {
    variantId: identity.variantId,
    priceRaw: identity.priceRaw,
    coinType: identity.coinType,
    bagGift: identity.bagGift,
  };
}

module.exports = { giftVariantId, validateRuleGiftIdentity };
