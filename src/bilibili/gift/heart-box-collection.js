'use strict';

const { queryError } = require('./history-filters');

const DAY_MS = 86400000;
const SHANGHAI_OFFSET_MS = 8 * 3600000;
const STAGES = [
  { target: 20, multiplier: 4, castles: 1 },
  { target: 40, multiplier: 4, castles: 2 },
  { target: 80, multiplier: 5, castles: 1 },
  { target: 120, multiplier: 5, castles: 2 },
];

function createHeartBoxCollectionService({ store, adjustments, gifts, catalog, now = Date.now }) {
  function readProgress() {
    const source = gifts.getActiveSource();
    if (!Number.isSafeInteger(source?.sourceId) || source.sourceId < 1 || source.syncState === 'SOURCE_SWITCHING') {
      throw queryError('GIFT_SOURCE_UNAVAILABLE', '礼物来源尚未就绪，请连接主播账号后重试。');
    }
    const timestamp = now();
    const local = new Date(timestamp + SHANGHAI_OFFSET_MS);
    const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - SHANGHAI_OFFSET_MS;
    const startsAt = dayStart - ((local.getUTCDay() + 1) % 7) * DAY_MS;
    const endsAt = startsAt + 6 * DAY_MS;
    const [recordedCount] = store.countMany(source.sourceId, [{
      wish: { gift_id: '32251', gift_category: 'blindBox', legacy_box_name: '心动盲盒' },
      start: new Date(startsAt).toISOString(),
      // The store's upper bound is inclusive; Friday belongs to no collection window.
      end: new Date(Math.min(timestamp, endsAt - 1)).toISOString(),
    }]);
    const adjustment = adjustments.getAdjustment(source.sourceId, new Date(startsAt).toISOString());
    return { source, timestamp, startsAt, endsAt, recordedCount, count: Math.max(0, recordedCount + adjustment) };
  }

  function snapshot({ source, timestamp, startsAt, endsAt, count }) {
    const stages = STAGES.map((stage) => ({ ...stage, unlocked: count >= stage.target }));
    const next = stages.find((stage) => !stage.unlocked);
    const target = next?.target || 120;
    const artwork = catalog.getArtworkResolver();
    return {
      viewRevision: gifts.getViewRevision(),
      asOf: new Date(timestamp).toISOString(),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      nextStartsAt: new Date(startsAt + 7 * DAY_MS).toISOString(),
      status: timestamp < endsAt ? 'collecting' : 'ended',
      partial: source.partial !== false,
      count,
      target,
      remaining: Math.max(0, target - count),
      completed: !next,
      stages,
      imagePath: artwork('32251') || '',
      castleImagePath: artwork('32132') || '',
    };
  }

  function adjust(input) {
    if (!Number.isSafeInteger(input?.count) || input.count < 0 || input.count > 999999999) {
      throw queryError('INVALID_HEART_BOX_PROGRESS', '请输入 0–999999999 之间的整数。');
    }
    const progress = readProgress();
    const current = snapshot(progress);
    if (input.viewRevision !== current.viewRevision || input.startsAt !== current.startsAt
      || input.expectedCount !== current.count) {
      throw queryError('GIFT_VIEW_STALE', '来源、本期或进度已变化，请刷新后核对数量再保存。');
    }
    adjustments.saveAdjustment(progress.source.sourceId, current.startsAt, input.count - progress.recordedCount);
    return snapshot({ ...progress, count: input.count });
  }

  return { getSnapshot: () => snapshot(readProgress()), adjust };
}

module.exports = { createHeartBoxCollectionService };
