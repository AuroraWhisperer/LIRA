'use strict';

const { fail, readPreferredId } = require('./provider-parsers');

// Only the explicit action values used by the reaction list identify a source.
// A missing/unknown action must never be treated as a like.
const ACTIONS = new Map([
  ['赞了', 'like'],
  ['转发了', 'repost'],
]);

function parseReactionPage(payload, previousCursor = null) {
  const data = payload?.data;
  if (!Array.isArray(data?.items) || typeof data.has_more !== 'boolean') {
    fail(
      'LOTTERY_UPSTREAM_INVALID',
      'Reaction records or pagination are missing.',
    );
  }
  let nextCursor = null;
  if (data.has_more) {
    if (
      typeof data.offset !== 'string' ||
      !data.offset ||
      data.offset.length > 2048 ||
      data.offset === previousCursor ||
      data.items.length === 0
    ) {
      fail('LOTTERY_UPSTREAM_INVALID', 'Reaction pagination did not advance.');
    }
    nextCursor = data.offset;
  }
  const records = data.items.map((item) => {
    const source = ACTIONS.get(item?.action);
    if (!source)
      fail('LOTTERY_REACTION_UNKNOWN', 'Reaction action is not recognized.');
    const uid = readPreferredId(item, ['mid_str', 'mid'], 'reaction UID');
    return {
      source,
      uid,
      recordId: uid,
      // This endpoint supplies an observed membership, not a historical event time.
      occurredAtMs: null,
      text: null,
      parentId: null,
      level: null,
    };
  });
  return { records, nextCursor, ended: !data.has_more };
}

module.exports = { parseReactionPage };
