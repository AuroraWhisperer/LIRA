'use strict';

/**
 * Starts generation with bounded concurrency while holding completed results
 * until every earlier sequence has been delivered. Delivery itself is serial,
 * so one viewer's multi-danmaku reply finishes before the next viewer starts.
 */
function createOrderedAsyncCoordinator(options = {}) {
  const generate = options.generate;
  const deliver = options.deliver;
  const onError = options.onError || (() => {});
  const getConcurrency = options.getConcurrency || (() => 1);
  const getKey = options.getKey || (() => undefined);
  const busyKeys = new Set();
  let nextSequence = 1;
  let nextDelivery = 1;
  let active = 0;
  let stopped = false;
  let delivering = false;
  let drainPromise = null;
  let resolveDrain = null;
  const waiting = [];
  const completed = new Map();

  function enqueue(item) {
    if (stopped) return false;
    waiting.push({ sequence: nextSequence, item, key: getKey(item) });
    nextSequence += 1;
    pumpGeneration();
    return true;
  }

  // Delivery holds the viewer's key. Its retry needs a generation slot, not another FIFO position.
  function regenerate(item, options) {
    if (stopped) return Promise.reject(new Error('Coordinator stopped'));
    const retry = Promise.withResolvers();
    waiting.unshift({ item, options, retry });
    pumpGeneration();
    return retry.promise;
  }

  function pumpGeneration() {
    const concurrency = Math.max(1, Number(getConcurrency()) || 1);
    while (!stopped && active < concurrency && waiting.length) {
      const index = waiting.findIndex(job => job.key === undefined || !busyKeys.has(job.key));
      if (index < 0) break;
      const [job] = waiting.splice(index, 1);
      if (job.key !== undefined) busyKeys.add(job.key);
      active += 1;
      Promise.resolve()
        .then(() => generate(job.item, job.options))
        .then((result) => {
          if (job.retry) job.retry.resolve(result);
          else if (!stopped) completed.set(job.sequence, { ...job, result });
        })
        .catch((error) => {
          if (job.retry) job.retry.reject(error);
          else if (!stopped) completed.set(job.sequence, { ...job, error });
        })
        .finally(() => {
          active -= 1;
          pumpGeneration();
          void pumpDelivery();
          resolveDrainIfIdle();
        });
    }
  }

  async function pumpDelivery() {
    if (stopped || delivering) return;
    delivering = true;
    try {
      while (!stopped && completed.has(nextDelivery)) {
        const job = completed.get(nextDelivery);
        completed.delete(nextDelivery);
        // 先推进游标：即使 deliver/onError 抛错，后续条目也不会被这个失败条目卡死。
        nextDelivery += 1;
        try {
          if (job.error) throw job.error;
          await deliver(job.item, job.result, (options) => regenerate(job.item, options));
        } catch (error) {
          try {
            await onError(error, job.item);
          } catch (onErrorError) {
            // onError 自身抛错不能阻断投递循环，否则剩余回复永远无法送达。
            console.warn('[async-coordinator] onError threw:', onErrorError && onErrorError.message);
          }
        } finally {
          busyKeys.delete(job.key);
          pumpGeneration();
        }
      }
    } finally {
      delivering = false;
      resolveDrainIfIdle();
    }
  }

  function getStatus() {
    return {
      queued: waiting.length + completed.size + active,
      waiting: waiting.length,
      generating: active,
      ready: completed.size,
      delivering,
    };
  }

  function stop() {
    if (drainPromise) return drainPromise;
    stopped = true;
    for (const job of waiting) job.retry?.reject(new Error('Coordinator stopped'));
    waiting.length = 0;
    completed.clear();
    busyKeys.clear();
    drainPromise = new Promise((resolve) => {
      resolveDrain = resolve;
      resolveDrainIfIdle();
    });
    return drainPromise;
  }

  function resolveDrainIfIdle() {
    if (!stopped || active > 0 || delivering || !resolveDrain) return;
    const resolve = resolveDrain;
    resolveDrain = null;
    resolve();
  }

  return { enqueue, getStatus, stop };
}

module.exports = { createOrderedAsyncCoordinator };
