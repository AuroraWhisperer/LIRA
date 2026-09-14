'use strict';

const { randomUUID } = require('node:crypto');

function collectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readNow(clock) {
  const value = Number(clock.nowMs());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Collection clock returned an invalid time.');
  }
  return value;
}

function requiredSources(rules) {
  const sources = [rules?.entryAction, ...(rules?.requiredActions || [])];
  const unique = [...new Set(sources.filter(Boolean))];
  if (
    unique.length === 0 ||
    unique.some((source) => !['comment', 'repost', 'like'].includes(source))
  ) {
    throw collectionError(
      'LOTTERY_SOURCE_UNAVAILABLE',
      'Task rules contain an unsupported collection source.',
    );
  }
  return unique;
}

function assertSameSession(before, after) {
  if (
    before.streamerId !== after.streamerId ||
    before.authorizationEpoch !== after.authorizationEpoch ||
    before.sessionEpoch !== after.sessionEpoch
  ) {
    throw collectionError(
      'LOTTERY_SESSION_CHANGED',
      'The trusted session changed while collecting a page.',
    );
  }
}

function createCollectionService({ store, provider, getContext, clock }) {
  if (
    typeof store?.getTask !== 'function' ||
    typeof provider?.readPage !== 'function' ||
    typeof getContext !== 'function' ||
    typeof clock?.nowMs !== 'function'
  ) {
    throw new TypeError('Collection service dependencies are required.');
  }

  const active = new Map();
  let disposed = false;

  function assertTaskReady(task) {
    if (!task) throw collectionError('LOTTERY_TASK_NOT_FOUND', 'Task not found.');
    const endsAtMs = Number(task.rules?.endsAtMs);
    if (!Number.isSafeInteger(endsAtMs) || endsAtMs < 0) {
      throw collectionError('LOTTERY_RULES_INVALID', 'Task cutoff is invalid.');
    }
    if (readNow(clock) < endsAtMs) {
      throw collectionError(
        'LOTTERY_COLLECTION_NOT_READY',
        'Final collection cannot start before the registration cutoff.',
      );
    }
  }

  function assertTaskScope(task, context) {
    if (String(context?.streamerId || '') !== task.streamerId) {
      throw collectionError(
        'LOTTERY_SESSION_CHANGED',
        'The trusted streamer identity changed.',
      );
    }
  }

  async function collect(taskId, controller, resumeExisting) {
    let task = store.getTask(taskId);
    assertTaskReady(task);
    const context = await getContext();
    assertTaskScope(task, context);
    const sources = requiredSources(task.rules);
    let scan = store.getActiveScan(taskId);

    if (scan?.status === 'completed') return store.getTask(taskId);
    if (scan?.status === 'paused' && !resumeExisting) return task;
    if (scan?.status === 'paused') {
      store.resumeScan({
        taskId,
        sessionEpoch: context.sessionEpoch,
        nowMs: readNow(clock),
      });
      scan = store.getActiveScan(taskId);
    } else if (!scan || scan.status === 'failed') {
      scan = store.beginScan({
        id: randomUUID(),
        taskId,
        sessionEpoch: context.sessionEpoch,
        sources,
        startedAtMs: readNow(clock),
      });
    }

    try {
      for (const source of sources) {
        for (;;) {
          controller.signal.throwIfAborted();
          scan = store.getActiveScan(taskId);
          const state = scan?.sources?.[source];
          if (!state) {
            throw collectionError(
              'LOTTERY_SOURCE_MISMATCH',
              'Persisted scan source does not match task rules.',
            );
          }
          if (state.coverage === 'exhausted') break;

          const page = await provider.readPage({
            target: task.target,
            source,
            cursor: state.cursor,
            signal: controller.signal,
          });
          const currentContext = await getContext();
          assertSameSession(context, currentContext);
          assertTaskScope(task, currentContext);
          scan = store.commitPage({
            taskId,
            scanId: scan.id,
            source,
            expectedCursor: state.cursor,
            page,
            sessionEpoch: context.sessionEpoch,
            committedAtMs: readNow(clock),
          });
          if (page.ended) break;
        }
      }
      return store.getTask(taskId);
    } catch (error) {
      const reason = controller.signal.aborted
        ? controller.signal.reason?.code || 'LOTTERY_COLLECTION_PAUSED'
        : error?.code || 'LOTTERY_COLLECTION_FAILED';
      task = store.pauseScan({ taskId, reason, nowMs: readNow(clock) });
      return task;
    }
  }

  function run(taskId, resumeExisting) {
    if (disposed) {
      return Promise.reject(
        collectionError(
          'LOTTERY_COLLECTION_DISPOSED',
          'Collection service has been disposed.',
        ),
      );
    }
    const id = String(taskId || '').trim();
    if (!id) return Promise.reject(new TypeError('taskId is required.'));
    const current = active.get(id);
    if (current) return current.promise;

    const controller = new AbortController();
    const operation = collect(id, controller, resumeExisting).finally(() => {
      if (active.get(id)?.controller === controller) active.delete(id);
    });
    active.set(id, { controller, promise: operation });
    return operation;
  }

  function start({ taskId } = {}) {
    return run(taskId, false);
  }

  function resume(taskId) {
    return run(taskId, true);
  }

  function pause(taskId) {
    const id = String(taskId || '').trim();
    const current = active.get(id);
    if (current) {
      current.controller.abort(
        collectionError(
          'LOTTERY_COLLECTION_PAUSED',
          'Collection was paused by the user.',
        ),
      );
    }
    const scan = store.getActiveScan(id);
    if (!scan || scan.status === 'completed') return store.getTask(id);
    return store.pauseScan({
      taskId: id,
      reason: 'LOTTERY_COLLECTION_PAUSED',
      nowMs: readNow(clock),
    });
  }

  async function dispose() {
    if (!disposed) {
      disposed = true;
      for (const { controller } of active.values()) {
        controller.abort(
          collectionError(
            'LOTTERY_COLLECTION_DISPOSED',
            'Collection service has been disposed.',
          ),
        );
      }
    }
    await Promise.allSettled([...active.values()].map((entry) => entry.promise));
  }

  return { start, pause, resume, dispose };
}

module.exports = { createCollectionService };
