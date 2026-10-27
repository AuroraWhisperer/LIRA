export function shanghaiToday(time = Date.now()) {
  return new Date(time + 28800000).toISOString().slice(0, 10);
}

export function giftFeedRowDurationMs(speed) {
  return 5000 - ((speed - 1) * 4900) / 49;
}

export function createGiftFeedState() {
  let items = [];
  let index = 0;
  return {
    replace(next) {
      const anchor = items[index]?.eventId;
      items = [...new Map(next.map((item) => [item.eventId, item])).values()];
      const found = items.findIndex((item) => item.eventId === anchor);
      index = found < 0 ? 0 : found;
    },
    advance(step = 1) {
      if (items.length) index = (index + step) % items.length;
    },
    visible(rows, buffer = false) {
      const count = Math.min(items.length, rows + (buffer && items.length > rows ? 1 : 0));
      return Array.from({ length: count }, (_, offset) => items[(index + offset) % items.length]);
    },
    get count() {
      return items.length;
    },
  };
}

export async function scanTodayGifts({ request, signal, day, onRevision, previous }) {
  const items = new Map();
  let cursor = null;
  let viewRevision = null;
  let partial = true;
  let contentRevision;
  let consistent = true;
  do {
    const params = new URLSearchParams({
      range: 'today',
      startDate: day,
      endDate: day,
      limit: '100',
      sortField: 'created_at',
      sortDirection: 'asc',
      conditional: '1',
    });
    if (cursor) params.set('cursor', cursor);
    if (viewRevision) params.set('viewRevision', viewRevision);
    if (!cursor && previous?.day === day && previous.contentRevision) params.set('contentRevision', previous.contentRevision);
    const data = await request(`/api/gifts/history?${params}`, signal);
    if (!viewRevision) {
      viewRevision = data.viewRevision;
      onRevision(viewRevision);
    }
    if (viewRevision !== data.viewRevision)
      throw Object.assign(new Error('礼物来源已变更'), { code: 'GIFT_VIEW_STALE' });
    if (data.unchanged && !cursor && previous?.day === day && previous.viewRevision === viewRevision &&
        previous.contentRevision === data.contentRevision) return { ...previous, partial: data.partial };
    if (data.unchanged) throw Object.assign(new Error('礼物来源已变更'), { code: 'GIFT_VIEW_STALE' });
    if (!cursor) contentRevision = data.contentRevision;
    else if (contentRevision !== data.contentRevision) consistent = false;
    for (const item of data.items) items.set(item.eventId, item);
    partial = data.partial;
    cursor = data.nextCursor;
  } while (cursor);
  return { items: [...items.values()], viewRevision, partial, day, contentRevision: consistent ? contentRevision : undefined };
}
