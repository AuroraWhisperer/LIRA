export const GUARD_GIFT_ALIASES = Object.freeze({
  'guard-1': Object.freeze(['10001', '33909', '34639']),
  'guard-2': Object.freeze(['10002', '33908', '34638']),
  'guard-3': Object.freeze(['10003', '34637', '33972', '33978', '34636']),
});

const canonicalById = new Map();
for (const [canonicalId, aliases] of Object.entries(GUARD_GIFT_ALIASES)) {
  canonicalById.set(canonicalId, canonicalId);
  for (const alias of aliases) canonicalById.set(alias, canonicalId);
}

export function canonicalizeGuardGiftId(value) {
  const id = String(value ?? '').trim();
  return canonicalById.get(id) || id;
}

export function isGuardGiftAliasId(value) {
  const id = String(value ?? '').trim();
  return canonicalById.has(id) && !id.startsWith('guard-');
}

export function guardGiftLevel(id, name) {
  const match = /^guard-([123])$/.exec(canonicalizeGuardGiftId(id));
  if (match) return Number(match[1]);
  return ['总督', '提督', '舰长'].indexOf(String(name ?? '').replace(/\s+/gu, '')) + 1;
}
