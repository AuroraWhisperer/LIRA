'use strict';

class LotteryProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LotteryProviderError';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new LotteryProviderError(code, message, details);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeDecimalId(value, field) {
  if (typeof value === 'string') {
    if (/^[1-9]\d{0,63}$/u.test(value)) return value;
    fail(
      'LOTTERY_UPSTREAM_INVALID',
      `${field} must be a positive decimal string.`,
    );
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  fail(
    'LOTTERY_UPSTREAM_INVALID',
    `${field} must be a safe integer or a positive decimal string.`,
  );
}

function readPreferredId(value, fields, label) {
  if (!value || typeof value !== 'object') {
    fail('LOTTERY_UPSTREAM_INVALID', `${label} container is missing.`);
  }
  for (const field of fields) {
    if (hasOwn(value, field)) return normalizeDecimalId(value[field], label);
  }
  fail('LOTTERY_UPSTREAM_INVALID', `${label} is missing.`);
}

function normalizeSafeInteger(value, field, { minimum = 0 } = {}) {
  const parsed =
    typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    fail('LOTTERY_UPSTREAM_INVALID', `${field} must be a safe integer.`);
  }
  return parsed;
}

function secondsToMilliseconds(value, field) {
  const seconds = normalizeSafeInteger(value, field, { minimum: 1 });
  const milliseconds = seconds * 1000;
  if (!Number.isSafeInteger(milliseconds)) {
    fail('LOTTERY_UPSTREAM_INVALID', `${field} exceeds millisecond precision.`);
  }
  return milliseconds;
}

function normalizeCursorOffset(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 1024) {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  fail('LOTTERY_UPSTREAM_INVALID', 'Comment pagination offset is invalid.');
}

function parseCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === '') return null;
  if (typeof cursor !== 'string' || cursor.length > 2048) {
    throw new TypeError('Comment cursor must be an opaque string or null.');
  }
  let value;
  try {
    value = JSON.parse(cursor);
  } catch (_) {
    throw new TypeError('Comment cursor is invalid.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !hasOwn(value, 'offset')
  ) {
    throw new TypeError('Comment cursor is invalid.');
  }
  return JSON.stringify({ offset: normalizeCursorOffset(value.offset) });
}

function sourceCapabilities() {
  const unavailable = () => ({
    available: false,
    canEnumerate: false,
    hasEventTime: false,
    reason: 'UNVERIFIED_SOURCE',
  });
  return {
    comment: {
      available: true,
      canEnumerate: true,
      hasEventTime: true,
      reason: 'UNTESTED_ADAPTER',
    },
    repost: {
      available: true,
      canEnumerate: true,
      hasEventTime: false,
      reason: 'OBSERVED_MEMBERSHIP',
    },
    like: {
      available: true,
      canEnumerate: true,
      hasEventTime: false,
      reason: 'OBSERVED_MEMBERSHIP',
    },
    relation: {
      available: true,
      canEnumerate: false,
      hasEventTime: false,
      reason: 'UNTESTED_ADAPTER',
    },
    threadReplies: unavailable(),
    level: unavailable(),
  };
}

function parseDynamicTarget(payload, expectedDynamicId) {
  const item = payload?.data?.item;
  if (!item || typeof item !== 'object') {
    fail('LOTTERY_UPSTREAM_INVALID', 'Dynamic detail item is missing.');
  }
  const dynamicId = readPreferredId(item, ['id_str', 'id'], 'dynamic ID');
  if (dynamicId !== expectedDynamicId) {
    fail(
      'LOTTERY_UPSTREAM_INVALID',
      'Dynamic detail ID does not match the link.',
    );
  }
  if (!['DYNAMIC_TYPE_WORD', 'DYNAMIC_TYPE_DRAW'].includes(item.type)) {
    fail(
      'LOTTERY_DYNAMIC_TYPE_UNSUPPORTED',
      'Only original text and image dynamics are supported.',
    );
  }

  const author = item.modules?.module_author;
  const basic = item.basic;
  return {
    kind: 'dynamic',
    dynamicId,
    ownerUid: readPreferredId(author, ['mid_str', 'mid'], 'dynamic owner UID'),
    commentOid: readPreferredId(
      basic,
      ['comment_id_str', 'comment_id'],
      'comment object ID',
    ),
    commentType: normalizeSafeInteger(basic?.comment_type, 'comment type', {
      minimum: 1,
    }),
    publishedAtMs: secondsToMilliseconds(
      author?.pub_ts,
      'dynamic publication time',
    ),
    description:
      typeof item.modules?.module_dynamic?.desc?.text === 'string'
        ? item.modules.module_dynamic.desc.text.slice(0, 300)
        : '图文动态',
    expectedReactions: {
      like: item.modules?.module_stat?.like?.count ?? null,
      repost: item.modules?.module_stat?.forward?.count ?? null,
    },
    capabilities: sourceCapabilities(),
  };
}

function parseVideoTarget(payload, bvid) {
  const data = payload?.data;
  if (data?.bvid !== bvid)
    fail('LOTTERY_UPSTREAM_INVALID', 'Video ID does not match.');
  const aid = readPreferredId(data, ['aid'], 'video ID');
  const capabilities = sourceCapabilities();
  for (const source of ['like', 'repost']) {
    capabilities[source] = {
      available: false,
      canEnumerate: false,
      hasEventTime: false,
      reason: 'VIDEO_SOURCE_UNAVAILABLE',
    };
  }
  return {
    kind: 'video',
    bvid,
    dynamicId: aid,
    commentOid: aid,
    commentType: 1,
    ownerUid: readPreferredId(
      data.owner,
      ['mid_str', 'mid'],
      'video owner UID',
    ),
    publishedAtMs: secondsToMilliseconds(
      data.pubdate,
      'video publication time',
    ),
    description:
      typeof data.title === 'string' ? data.title.slice(0, 300) : '视频',
    capabilities,
  };
}

function parseCommentRecord(record) {
  if (!record || typeof record !== 'object') {
    fail('LOTTERY_UPSTREAM_INVALID', 'Comment record is invalid.');
  }
  const recordId = readPreferredId(record, ['rpid_str', 'rpid'], 'comment ID');
  const uid = readPreferredId(record.member, ['mid_str', 'mid'], 'comment UID');
  if (typeof record.content?.message !== 'string') {
    fail('LOTTERY_UPSTREAM_INVALID', 'Comment text is missing.');
  }
  const rawLevel = record.member?.level_info?.current_level;
  const level =
    rawLevel === null || rawLevel === undefined
      ? null
      : normalizeSafeInteger(rawLevel, 'comment user level');
  return {
    source: 'comment',
    recordId,
    uid,
    displayName:
      typeof record.member.uname === 'string'
        ? record.member.uname.trim().slice(0, 256) || null
        : null,
    occurredAtMs: secondsToMilliseconds(record.ctime, 'comment time'),
    text: record.content.message,
    parentId: null,
    level,
  };
}

function parseCommentPage(payload, previousCursor) {
  const data = payload?.data;
  if (
    !data ||
    typeof data !== 'object' ||
    (!Array.isArray(data.replies) &&
      !(data.replies === null && data.cursor?.is_end === true))
  ) {
    fail('LOTTERY_UPSTREAM_INVALID', 'Comment page records are missing.');
  }
  if (!data.cursor || typeof data.cursor.is_end !== 'boolean') {
    fail('LOTTERY_UPSTREAM_INVALID', 'Comment pagination state is missing.');
  }

  const ended = data.cursor.is_end;
  let nextCursor = null;
  if (!ended) {
    if (data.replies.length === 0) {
      fail(
        'LOTTERY_UPSTREAM_INVALID',
        'Comment page is empty before pagination ended.',
      );
    }
    const pagination = data.cursor.pagination_reply;
    if (!pagination || !hasOwn(pagination, 'next_offset')) {
      fail('LOTTERY_UPSTREAM_INVALID', 'Comment pagination offset is missing.');
    }
    nextCursor = JSON.stringify({
      offset: normalizeCursorOffset(pagination.next_offset),
    });
    if (nextCursor === previousCursor) {
      fail(
        'LOTTERY_UPSTREAM_INVALID',
        'Comment pagination cursor did not advance.',
      );
    }
  }
  return {
    records: (data.replies || []).map(parseCommentRecord),
    nextCursor,
    ended,
  };
}

function relationResult({ attribute, ownerUid, subjectUid, checkedAtMs }) {
  const common = { checkedAtMs, attribute, subjectUid, ownerUid };
  if (attribute === 2) {
    return { state: 'eligible', reason: 'FOLLOWING', ...common };
  }
  if (attribute === 6) {
    return { state: 'eligible', reason: 'MUTUAL_FOLLOW', ...common };
  }
  if (attribute === 0) {
    return { state: 'ineligible', reason: 'NOT_FOLLOWING', ...common };
  }
  if (attribute === 128) {
    return { state: 'ineligible', reason: 'BLOCKED', ...common };
  }
  if (attribute === null) {
    return { state: 'unknown', reason: 'MISSING_ATTRIBUTE', ...common };
  }
  return { state: 'unknown', reason: 'UNKNOWN_ATTRIBUTE', ...common };
}

module.exports = {
  LotteryProviderError,
  fail,
  hasOwn,
  normalizeDecimalId,
  normalizeSafeInteger,
  parseCommentPage,
  parseCursor,
  parseDynamicTarget,
  parseVideoTarget,
  readPreferredId,
  relationResult,
};
