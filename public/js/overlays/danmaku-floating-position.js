// Horizontal motion is shared, so separation at entry remains valid during travel.
export function findFloatingDanmakuTop(item, height, occupied, dispersion = 50, random = Math.random) {
  const bottom = Math.max(0, height - item.height);
  const obstacles = occupied.map(box => ({
    top: box.top, bottom: box.top + box.height,
    gap: Math.max(0, item.left - box.left - box.width, box.left - item.left - item.width),
  }));
  if (!obstacles.length) return random() * bottom;

  function available(clearance) {
    const blocked = obstacles.filter(box => box.gap <= clearance).map(box => {
      const gap = Math.sqrt(Math.max(0, clearance ** 2 - box.gap ** 2));
      return [box.top - item.height - gap, box.bottom + gap];
    }).sort((a, b) => a[0] - b[0]);
    const intervals = [];
    let cursor = 0;
    for (const [start, end] of blocked) {
      if (end < cursor) continue;
      if (start > bottom) break;
      if (start >= cursor) intervals.push([cursor, Math.min(start, bottom)]);
      cursor = Math.max(cursor, end);
      if (cursor > bottom) break;
    }
    if (cursor <= bottom) intervals.push([cursor, bottom]);
    return intervals;
  }

  if (!available(0).length) return undefined;
  let lower = 0;
  let upper = Math.max(...obstacles.map(box => Math.hypot(box.gap, height)));
  // Search the whole height, including exact edges and gaps between unequal cards.
  for (let index = 0; index < 28; index += 1) {
    const middle = (lower + upper) / 2;
    if (available(middle).length) lower = middle;
    else upper = middle;
  }
  const base = Math.min(8, lower);
  const intervals = available(base + (lower - base) * (dispersion - 1) / 99);
  const total = intervals.reduce((sum, [start, end]) => sum + end - start, 0);
  let offset = random() * total;
  for (const [start, end] of intervals) {
    if (offset <= end - start) return start + offset;
    offset -= end - start;
  }
  return intervals.at(-1)[1];
}
