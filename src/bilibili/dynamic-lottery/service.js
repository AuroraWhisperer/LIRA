'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { normalizeDynamicLink } = require('./link');
const { createLotteryProvider } = require('./provider');
const { createCollectionService } = require('./collection-service');
const { createDrawService } = require('./draw-service');
const {
  lotteryError,
  normalizeRules,
  buildCandidatePool,
  assertSameContext,
} = require('./rules');

function publicCode(error) {
  const code = error?.code;
  return typeof code === 'string' && /^LOTTERY_[A-Z_]{1,64}$/u.test(code)
    ? code
    : 'LOTTERY_OPERATION_FAILED';
}

function createDynamicLotteryService({
  store,
  drawStore,
  request,
  getContext: readAuthContext,
  getIdentity,
  clock,
  resumeRequests,
  pauseRequests,
}) {
  let active = null;
  let lastError = null;
  let disposed = false;

  function identity() {
    if (disposed) throw lotteryError('LOTTERY_SESSION_DISPOSED');
    const value = getIdentity();
    if (!value?.streamerId || !Number.isSafeInteger(value.authorizationEpoch))
      throw lotteryError('LOTTERY_IDENTITY_UNAVAILABLE');
    return value;
  }

  function sameIdentity(left, right) {
    return (
      left?.streamerId === right?.streamerId &&
      left?.authorizationEpoch === right?.authorizationEpoch
    );
  }

  async function getContext() {
    const job = active;
    const context = await readAuthContext();
    if (
      !job ||
      job !== active ||
      !sameIdentity(job.identity, identity()) ||
      !sameIdentity(job.identity, context)
    ) {
      throw lotteryError('LOTTERY_SESSION_CHANGED');
    }
    job.controller.signal.throwIfAborted();
    if (job.context) assertSameContext(job.context, context);
    else job.context = context;
    return context;
  }

  const provider = createLotteryProvider({
    request,
    getContext,
    nowMs: clock.nowMs,
  });
  const collection = createCollectionService({
    store,
    provider,
    getContext,
    clock,
  });
  const draw = createDrawService({
    store,
    drawStore,
    provider,
    getContext,
    clock,
  });

  function ownedTask(taskId, scope) {
    if (typeof taskId !== 'string' || taskId.length > 64)
      throw lotteryError('LOTTERY_TASK_NOT_FOUND');
    const task = store.getTask(taskId);
    if (!task || task.streamerId !== scope.streamerId)
      throw lotteryError('LOTTERY_TASK_NOT_FOUND');
    return task;
  }

  function launch(scope, taskId, kind, operation) {
    if (active) throw lotteryError('LOTTERY_BUSY');
    const job = {
      identity: scope,
      taskId,
      kind,
      controller: new AbortController(),
      context: null,
      promise: null,
    };
    active = job;
    lastError = null;
    job.promise = Promise.resolve()
      .then(() => operation(job))
      .catch((error) => {
        const code = publicCode(error);
        lastError = { identity: scope, code };
        if (
          [
            'LOTTERY_BILIBILI_CHALLENGE',
            'LOTTERY_BILIBILI_RATE_LIMITED',
          ].includes(code)
        )
          pauseRequests(scope.streamerId, code);
        if (job.taskId && drawStore.getRound(job.taskId)) {
          drawStore.setStatus(
            ownedTask(job.taskId, scope),
            'paused',
            code,
            clock.nowMs(),
          );
        }
      })
      .finally(() => {
        if (active === job) active = null;
      });
    // The job is drained by dispose; terminal errors are exposed through getState.
    job.promise = job.promise.catch(() => {
      lastError = { identity: scope, code: 'LOTTERY_STORAGE_FAILED' };
    });
  }

  function summary(task) {
    return {
      id: task.id,
      status: task.status,
      createdAtMs: task.createdAtMs,
      description: task.target.description || task.dynamicId,
      winnerCount: task.rules.winnerCount,
    };
  }

  function getState({ taskId } = {}) {
    const scope = identity();
    const tasks = store.listTasks(scope.streamerId);
    const ownJob =
      active && sameIdentity(active.identity, scope) ? active : null;
    const selectedId = taskId || (ownJob ? ownJob.taskId : tasks[0]?.id);
    const task = selectedId ? ownedTask(selectedId, scope) : null;
    const result = task ? drawStore.getResult(task.id) : null;
    const scan = task ? store.getActiveScan(task.id) : null;
    const candidateCount =
      task?.rules.version === 2 && scan?.status === 'completed'
        ? (result?.candidateCount ??
          buildCandidatePool({
            task,
            scan,
            evidence: store.getEvidence(scan.id),
          }).length)
        : null;
    return {
      tasks: tasks.map(summary),
      task: task
        ? {
            ...summary(task),
            ownerUid: task.ownerUid,
            target: {
              kind: task.target.kind,
              url: task.target.url,
              description: task.target.description,
            },
            rules: task.rules,
            revision: task.revision,
            candidateCount,
            scan: scan
              ? {
                  status: scan.status,
                  readCount: scan.readCount,
                  pauseReason: scan.pauseReason,
                  sources: Object.fromEntries(
                    Object.entries(scan.sources).map(([source, state]) => [
                      source,
                      { coverage: state.coverage, readCount: state.readCount },
                    ]),
                  ),
                }
              : null,
          }
        : null,
      result,
      job: ownJob ? { kind: ownJob.kind, taskId: ownJob.taskId } : null,
      error:
        lastError && sameIdentity(lastError.identity, scope)
          ? lastError.code
          : '',
    };
  }

  function createTask(input) {
    const scope = identity();
    if (
      typeof input?.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{16,64}$/u.test(input.requestId)
    )
      throw lotteryError('LOTTERY_RULES_INVALID');
    const link = normalizeDynamicLink(input.url);
    const rules = normalizeRules(input, clock.nowMs());
    const signature = createHash('sha256')
      .update(
        JSON.stringify({
          url: link.url,
          winnerCount: rules.winnerCount,
          requiredActions: rules.requiredActions,
          requireFollow: rules.requireFollow,
        }),
      )
      .digest('hex');
    const existing = store.findTaskByRequest(scope.streamerId, input.requestId);
    if (existing) {
      if (existing.rules.inputSignature !== signature)
        throw lotteryError('LOTTERY_DRAW_CONFLICT');
      return getState({ taskId: existing.id });
    }
    if (
      active?.requestId === input.requestId &&
      sameIdentity(active.identity, scope)
    ) {
      if (active.signature !== signature)
        throw lotteryError('LOTTERY_DRAW_CONFLICT');
      return getState();
    }
    if (active) throw lotteryError('LOTTERY_BUSY');
    resumeRequests(scope.streamerId);
    launch(scope, null, 'collect', async (job) => {
      const inspected = await provider.inspectDynamic(
        link.url,
        job.controller.signal,
      );
      await getContext();
      if (inspected.target.kind === 'video' && rules.requiredActions.length > 0)
        throw lotteryError('LOTTERY_VIDEO_SOURCE_UNAVAILABLE');
      if (
        rules.requiredActions.some(
          (source) =>
            !Number.isSafeInteger(
              inspected.target.expectedReactions?.[source],
            ) || inspected.target.expectedReactions[source] < 0,
        )
      ) {
        throw lotteryError('LOTTERY_UPSTREAM_INVALID');
      }
      const task = store.createTask({
        id: randomUUID(),
        streamerId: scope.streamerId,
        ownerUid: inspected.target.ownerUid,
        dynamicId: inspected.target.dynamicId,
        target: inspected.target,
        rules: { ...rules, inputSignature: signature },
        requestId: input.requestId,
        nowMs: clock.nowMs(),
      });
      job.taskId = task.id;
      await collection.start({ taskId: task.id });
      handleCollectionPause(task.id, scope);
    });
    active.requestId = input.requestId;
    active.signature = signature;
    return getState();
  }

  function handleCollectionPause(taskId, scope) {
    const reason = store.getActiveScan(taskId)?.pauseReason;
    if (
      ['LOTTERY_BILIBILI_CHALLENGE', 'LOTTERY_BILIBILI_RATE_LIMITED'].includes(
        reason,
      )
    )
      pauseRequests(scope.streamerId, reason);
  }

  function actOnTask({ taskId, action, revision } = {}) {
    const scope = identity();
    if (!['pause', 'resume', 'draw'].includes(action))
      throw lotteryError('LOTTERY_RULES_INVALID');
    if (action === 'pause') {
      if (
        active &&
        sameIdentity(active.identity, scope) &&
        (!taskId || active.taskId === taskId)
      ) {
        active.controller.abort(lotteryError('LOTTERY_OPERATION_PAUSED'));
        if (active.taskId) {
          const task = ownedTask(active.taskId, scope);
          collection.pause(task.id);
          drawStore.setStatus(
            task,
            'paused',
            'LOTTERY_OPERATION_PAUSED',
            clock.nowMs(),
          );
        }
      }
      return getState({ taskId });
    }
    const task = ownedTask(taskId, scope);
    if (task.rules.version !== 2) throw lotteryError('LOTTERY_LEGACY_TASK');
    if (active) {
      if (active.taskId === taskId && sameIdentity(active.identity, scope))
        return getState({ taskId });
      throw lotteryError('LOTTERY_BUSY');
    }
    if (['completed', 'exhausted'].includes(task.status))
      return getState({ taskId });
    if (revision !== task.revision) throw lotteryError('LOTTERY_DRAW_CONFLICT');
    const round = drawStore.getRound(task.id);
    if (
      action === 'draw' &&
      store.getActiveScan(task.id)?.status !== 'completed'
    )
      throw lotteryError('LOTTERY_COLLECTION_INCOMPLETE');
    if (
      action === 'resume' &&
      !round &&
      store.getActiveScan(task.id)?.status === 'completed'
    )
      return getState({ taskId });
    resumeRequests(scope.streamerId);
    launch(
      scope,
      taskId,
      round || action === 'draw' ? 'draw' : 'collect',
      async (job) => {
        await provider.verifyOwner(task.ownerUid, job.controller.signal);
        await getContext();
        if (round || action === 'draw')
          await draw.start(task, job.controller.signal);
        else {
          await collection.resume(taskId);
          handleCollectionPause(taskId, scope);
        }
      },
    );
    return getState({ taskId });
  }

  async function dispose() {
    disposed = true;
    const job = active;
    job?.controller.abort(lotteryError('LOTTERY_INTERRUPTED'));
    await collection.dispose();
    await job?.promise;
  }

  return { getState, createTask, actOnTask, dispose };
}

module.exports = { createDynamicLotteryService, publicCode };
