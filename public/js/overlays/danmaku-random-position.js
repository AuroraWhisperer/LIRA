export const FULLSCREEN_SAFE_INSET_PX = 16;
const ITEM_GAP_PX = 10;
const CANDIDATE_COUNT = 48;

// A message seed keeps the same candidate set across relayouts and both renderers.
function messageRandom(item = {}) {
  const seed = [item.id, item.uid, item.timestamp, item.name, item.message].join('|');
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.codePointAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}

export function findRandomDanmakuPosition(item, width, height, occupied, options = {}) {
  const inset = FULLSCREEN_SAFE_INSET_PX;
  const travelX = width - item.width - inset * 2;
  const travelY = height - item.height - inset * 2;
  const valid = (point) => point && point.left >= inset && point.top >= inset
    && point.left <= inset + travelX && point.top <= inset + travelY
    && occupied.every((box) => point.left >= box.left + box.width + ITEM_GAP_PX
      || point.left + item.width + ITEM_GAP_PX <= box.left
      || point.top >= box.top + box.height + ITEM_GAP_PX
      || point.top + item.height + ITEM_GAP_PX <= box.top);
  if (valid(item.entry.position)) return item.entry.position;
  const random = messageRandom(item.entry.item);
  const centerBias = ((options.centerBias ?? 1) - 1) / 49;
  const dispersion = ((options.dispersion ?? 1) - 1) / 49;
  const previous = item.entry.previousPosition;
  let best;
  let bestScore = -Infinity;
  function consider(point) {
    // Gumbel-max samples proportional to exp(logWeight), without exponent overflow.
    const noise = -Math.log(-Math.log(random()));
    if (!valid(point)) return;
    const x = point.left + item.width / 2;
    const y = point.top + item.height / 2;
    const centerDistance = (travelX > 0 ? ((x - width / 2) / (travelX / 2)) ** 2 : 0)
      + (travelY > 0 ? ((y - height / 2) / (travelY / 2)) ** 2 : 0);
    // Use actual Euclidean distance; a wide region must not stretch its vertical axis.
    const previousDistance = previous
      ? ((x - previous.x) ** 2 + (y - previous.y) ** 2) / (width ** 2 + height ** 2) : 0;
    const score = noise - 12 * centerBias * centerDistance + 12 * dispersion * previousDistance;
    if (score > bestScore) { best = point; bestScore = score; }
  }
  for (let index = 0; index < CANDIDATE_COUNT; index += 1) {
    consider({ left: inset + travelX * random(), top: inset + travelY * random() });
  }
  if (best) return best;
  // Exact edge/adjacent fits are a crowded-region fallback, never a corner-first preference.
  for (const left of [inset, inset + travelX]) {
    for (const top of [inset, inset + travelY]) consider({ left, top });
  }
  for (const box of occupied) {
    consider({ left: box.left + box.width + ITEM_GAP_PX, top: box.top });
    consider({ left: box.left, top: box.top + box.height + ITEM_GAP_PX });
    consider({ left: box.left - item.width - ITEM_GAP_PX, top: box.top });
    consider({ left: box.left, top: box.top - item.height - ITEM_GAP_PX });
  }
  return best;
}
