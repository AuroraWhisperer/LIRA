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
  let nextSequence = 1;
  let nextDelivery = 1;
  let active = 0;
  let stopped = false;
  let delivering = false;
  const waiting = [];
  const completed = new Map();

  function enqueue(item) {
    if (stopped) return false;
    waiting.push({ sequence: nextSequence, item });
    nextSequence += 1;
    pumpGeneration();
    return true;
  }

  function pumpGeneration() {
    const concurrency = Math.max(1, Number(getConcurrency()) || 1);
    while (!stopped && active < concurrency && waiting.length) {
      const job = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(() => generate(job.item))
        .then((result) => completed.set(job.sequence, { item: job.item, result }))
        .catch((error) => completed.set(job.sequence, { item: job.item, error }))
        .finally(() => {
          active -= 1;
          pumpGeneration();
          void pumpDelivery();
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
          await deliver(job.item, job.result);
        } catch (error) {
          try {
            await onError(error, job.item);
          } catch (onErrorError) {
            // onError 自身抛错不能阻断投递循环，否则剩余回复永远无法送达。
            console.warn('[async-coordinator] onError threw:', onErrorError && onErrorError.message);
          }
        }
      }
    } finally {
      delivering = false;
    }
  }

  function getStatus() {
    return {
      queued: waiting.length + completed.size + active,
      waiting: waiting.length,
      generating: active,
      ready: completed.size,
      delivering
    };
  }

  function stop() {
    stopped = true;
    waiting.length = 0;
    completed.clear();
  }

  return { enqueue, getStatus, stop };
}

module.exports = { createOrderedAsyncCoordinator };
