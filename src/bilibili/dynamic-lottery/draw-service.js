'use strict';

const { createHash, randomInt } = require('node:crypto');
const {
  lotteryError,
  buildCandidatePool,
  assertSameContext,
} = require('./rules');

function createUniformOrder(members, randomIntFn = randomInt) {
  const order = members.map((member) => member.uid);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = randomIntFn(index + 1);
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

function createDrawService({
  store,
  drawStore,
  provider,
  getContext,
  clock,
  randomIntFn = randomInt,
}) {
  async function start(task, signal) {
    const context = await getContext();
    if (context.streamerId !== task.streamerId)
      throw lotteryError('LOTTERY_SESSION_CHANGED');
    await provider.verifyOwner(task.ownerUid, signal);
    assertSameContext(context, await getContext());
    signal.throwIfAborted();
    let round = drawStore.getRound(task.id);
    if (!round) {
      const members = buildCandidatePool({
        task,
        scan: store.getActiveScan(task.id),
        evidence: store.getEvidence(task.activeScanId),
      });
      const order = createUniformOrder(members, randomIntFn);
      const digest = createHash('sha256')
        .update(JSON.stringify(members.map((member) => member.uid)))
        .digest('hex');
      round = drawStore.freeze({
        task,
        members,
        order,
        digest,
        nowMs: clock.nowMs(),
      });
    }
    if (['completed', 'exhausted'].includes(round.status)) return;
    drawStore.setStatus(task, 'drawing', '', clock.nowMs());
    try {
      for (
        let index = round.nextIndex;
        index < round.order.length;
        index += 1
      ) {
        signal.throwIfAborted();
        assertSameContext(context, await getContext());
        const uid = round.order[index];
        const verification = task.rules.requireFollow
          ? await provider.readRelation(uid, signal)
          : {
              state: 'eligible',
              reason: 'FOLLOW_NOT_REQUIRED',
              subjectUid: uid,
              ownerUid: task.ownerUid,
              checkedAtMs: clock.nowMs(),
            };
        assertSameContext(context, await getContext());
        signal.throwIfAborted();
        if (
          verification.ownerUid !== task.ownerUid ||
          verification.subjectUid !== uid
        )
          throw lotteryError('LOTTERY_SESSION_CHANGED');
        if (!['eligible', 'ineligible'].includes(verification.state))
          throw lotteryError('LOTTERY_RELATION_UNKNOWN');
        round = drawStore.recordCheck({
          task,
          roundId: round.id,
          index,
          uid,
          verification,
          nowMs: clock.nowMs(),
        });
        if (round.status === 'completed') return;
      }
      drawStore.setStatus(task, 'exhausted', '', clock.nowMs());
    } catch (error) {
      drawStore.setStatus(
        task,
        'paused',
        error.code || 'LOTTERY_DRAW_FAILED',
        clock.nowMs(),
      );
      throw error;
    }
  }

  return { start };
}

module.exports = { createDrawService, createUniformOrder };
