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

function createHeartBoxCollectionService({ store, gifts, catalog, now = Date.now }) {
  function getSnapshot() {
    const source = gifts.getActiveSource();
    if (!Number.isSafeInteger(source?.sourceId) || source.sourceId < 1 || source.syncState === 'SOURCE_SWITCHING') {
      throw queryError('GIFT_SOURCE_UNAVAILABLE', '礼物来源尚未就绪，请连接主播账号后重试。');
    }
    const timestamp = now();
    const local = new Date(timestamp + SHANGHAI_OFFSET_MS);
    const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - SHANGHAI_OFFSET_MS;
    const startsAt = dayStart - ((local.getUTCDay() + 1) % 7) * DAY_MS;
    const endsAt = startsAt + 6 * DAY_MS;
    const [count] = store.countMany(source.sourceId, [{
      wish: { gift_id: '32251', gift_category: 'blindBox', legacy_box_name: '心动盲盒' },
      start: new Date(startsAt).toISOString(),
      // The store's upper bound is inclusive; Friday belongs to no collection window.
      end: new Date(Math.min(timestamp, endsAt - 1)).toISOString(),
    }]);
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
  return { getSnapshot };
}

module.exports = { createHeartBoxCollectionService };
