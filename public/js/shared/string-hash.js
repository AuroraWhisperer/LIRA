// Hash code points (not UTF-16 units) to preserve existing overlay visual seeds.
export function hashCodePoints(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  return hash;
}
