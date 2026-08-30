'use strict';

const GUARD_GIFT_ALIASES = Object.freeze({
  'guard-1': Object.freeze(['10001', '33909', '34639']),
  'guard-2': Object.freeze(['10002', '33908', '34638']),
  'guard-3': Object.freeze(['10003', '34637', '33972', '33978', '34636']),
});

const CANONICAL_GUARD_GIFT_BY_ID = new Map();
for (const [canonicalId, aliases] of Object.entries(GUARD_GIFT_ALIASES)) {
  CANONICAL_GUARD_GIFT_BY_ID.set(canonicalId, canonicalId);
  for (const alias of aliases)
    CANONICAL_GUARD_GIFT_BY_ID.set(alias, canonicalId);
}

function canonicalizeGuardGiftId(value) {
  const giftId = String(value ?? '').trim();
  return CANONICAL_GUARD_GIFT_BY_ID.get(giftId) || giftId;
}

function isGuardGiftAliasId(value) {
  const giftId = String(value ?? '').trim();
  return CANONICAL_GUARD_GIFT_BY_ID.has(giftId) && !giftId.startsWith('guard-');
}

module.exports = {
  GUARD_GIFT_ALIASES,
  canonicalizeGuardGiftId,
  isGuardGiftAliasId,
};
