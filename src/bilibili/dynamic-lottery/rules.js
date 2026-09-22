'use strict';

function lotteryError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeRules(input, endsAtMs) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw lotteryError('LOTTERY_RULES_INVALID');
  }
  const { winnerCount, requireLike, requireRepost, requireFollow } = input;
  if (
    !Number.isSafeInteger(winnerCount) ||
    winnerCount < 1 ||
    winnerCount > 100 ||
    [requireLike, requireRepost, requireFollow].some((value) => typeof value !== 'boolean')
  )
    throw lotteryError('LOTTERY_RULES_INVALID');
  return {
    version: 2,
    entryAction: 'comment',
    requiredActions: [requireLike && 'like', requireRepost && 'repost'].filter(Boolean),
    requireFollow,
    winnerCount,
    endsAtMs,
    interactionTimePolicy: 'observed-during-collection',
    commentScope: 'top-level',
  };
}

function buildCandidatePool({ task, scan, evidence }) {
  const sources = ['comment', ...task.rules.requiredActions];
  if (scan?.status !== 'completed' || sources.some((source) => scan.sources[source]?.coverage !== 'exhausted'))
    throw lotteryError('LOTTERY_COLLECTION_INCOMPLETE');
  const comments = new Map();
  const required = new Map(task.rules.requiredActions.map((source) => [source, new Set()]));
  for (const record of evidence) {
    if (record.uid === task.ownerUid) continue;
    if (record.source === 'comment') {
      if (!Number.isSafeInteger(record.occurredAtMs)) {
        throw lotteryError('LOTTERY_UPSTREAM_INVALID');
      }
      if (record.occurredAtMs <= task.rules.endsAtMs && !comments.has(record.uid)) {
        comments.set(record.uid, {
          uid: record.uid,
          source: 'comment',
          recordId: record.recordId,
        });
      }
    } else {
      required.get(record.source)?.add(record.uid);
    }
  }
  return [...comments.values()]
    .filter(({ uid }) => [...required.values()].every((members) => members.has(uid)))
    .sort((left, right) => left.uid.length - right.uid.length || left.uid.localeCompare(right.uid, 'en'));
}

function assertSameContext(before, after) {
  if (
    !before ||
    !after ||
    before.streamerId !== after.streamerId ||
    before.authorizationEpoch !== after.authorizationEpoch ||
    before.sessionEpoch !== after.sessionEpoch
  ) {
    throw lotteryError('LOTTERY_SESSION_CHANGED');
  }
}

module.exports = {
  lotteryError,
  normalizeRules,
  buildCandidatePool,
  assertSameContext,
};
