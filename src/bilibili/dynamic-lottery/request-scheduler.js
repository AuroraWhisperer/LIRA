'use strict';

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
const REQUEST_TIMEOUT_MS = 20_000;

function schedulerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireClock(clock) {
  if (
    typeof clock?.nowMs !== 'function' ||
    typeof clock?.sleep !== 'function'
  ) {
    throw new TypeError('Request scheduler requires an injectable clock.');
  }
  return clock;
}

function now(clock) {
  const value = Number(clock.nowMs());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Request scheduler clock returned an invalid time.');
  }
  return value;
}

function retryAfterMs(response, nowMs) {
  const value = String(response.headers?.get?.('retry-after') || '').trim();
  if (!value) return 0;
  if (/^\d+$/u.test(value)) return Number(value) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : 0;
}

function shouldRetryResponse(response) {
  return [500, 502, 503, 504].includes(Number(response?.status));
}

function createRequestScheduler({ fetchImpl, budgetStore, clock }) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Request scheduler requires fetchImpl.');
  }
  if (
    typeof budgetStore?.reserve !== 'function' ||
    typeof budgetStore?.finish !== 'function'
  ) {
    throw new TypeError(
      'Request scheduler requires a persistent budget store.',
    );
  }
  const schedulerClock = requireClock(clock);
  const lifecycle = new AbortController();
  let disposed = false;
  let queue = Promise.resolve();

  async function waitForBudget(scope, kind, signal, beforeRequest) {
    for (;;) {
      signal.throwIfAborted();
      await beforeRequest?.();
      const current = now(schedulerClock);
      const decision = budgetStore.reserve({ scope, kind, nowMs: current });
      if (decision.allowed) return;
      if (decision.holdReason || decision.waitUntilMs === null) {
        throw schedulerError(
          'LOTTERY_REQUEST_PAUSED',
          decision.holdReason || 'Dynamic lottery requests are paused.',
        );
      }
      const delay = Math.max(0, Number(decision.waitUntilMs) - current);
      if (delay === 0) continue;
      // Recheck the dedicated account while waiting; a switched account must
      // not occupy the old job for an entire hourly budget window.
      await schedulerClock.sleep(
        beforeRequest ? Math.min(delay, 4000) : delay,
        signal,
      );
    }
  }

  async function discardResponse(response) {
    try {
      await response?.body?.cancel?.();
    } catch (_) {
      return false;
    }
    return true;
  }

  async function runRequest(input) {
    if (disposed) {
      throw schedulerError(
        'LOTTERY_SCHEDULER_DISPOSED',
        'Dynamic lottery request scheduler has been disposed.',
      );
    }
    const scope = String(input?.scope || '').trim();
    const kind = String(input?.kind || '').trim();
    const url = String(input?.url || '');
    if (!scope || !kind || !url) {
      throw new TypeError(
        'Scheduled request scope, kind, and URL are required.',
      );
    }
    const signal = input.signal
      ? AbortSignal.any([input.signal, lifecycle.signal])
      : lifecycle.signal;
    signal.throwIfAborted();

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      await waitForBudget(scope, kind, signal, input.beforeRequest);
      await input.beforeRequest?.();
      signal.throwIfAborted();
      let response;
      const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const requestSignal = AbortSignal.any([signal, timeoutSignal]);
      try {
        response = await fetchImpl(url, {
          ...(input.init || {}),
          signal: requestSignal,
        });
        const finishedAtMs = now(schedulerClock);
        budgetStore.finish({
          scope,
          finishedAtMs,
          status: response?.status,
          retryAfterMs: retryAfterMs(response, finishedAtMs),
        });
      } catch (error) {
        budgetStore.finish({
          scope,
          finishedAtMs: now(schedulerClock),
          status: 0,
        });
        const timedOut = timeoutSignal.aborted && !signal.aborted;
        if (signal.aborted || (error?.name === 'AbortError' && !timedOut)) {
          throw error;
        }
        if (attempt === RETRY_DELAYS_MS.length) {
          if (timedOut) {
            throw schedulerError(
              'LOTTERY_REQUEST_TIMEOUT',
              'Bilibili request timed out.',
            );
          }
          throw error;
        }
        await schedulerClock.sleep(RETRY_DELAYS_MS[attempt], signal);
        continue;
      }

      if (
        !shouldRetryResponse(response) ||
        attempt === RETRY_DELAYS_MS.length
      ) {
        return response;
      }
      await discardResponse(response);
      await schedulerClock.sleep(RETRY_DELAYS_MS[attempt], signal);
    }
    throw schedulerError(
      'LOTTERY_REQUEST_FAILED',
      'Dynamic lottery request exhausted its retry policy.',
    );
  }

  function request(input) {
    if (disposed) {
      return Promise.reject(
        schedulerError(
          'LOTTERY_SCHEDULER_DISPOSED',
          'Dynamic lottery request scheduler has been disposed.',
        ),
      );
    }
    const operation = queue.then(() => runRequest(input));
    queue = operation.catch(() => undefined);
    return operation;
  }

  function pause(scope, reason = 'MANUALLY_PAUSED') {
    budgetStore.setHold({
      scope,
      reason,
      nowMs: now(schedulerClock),
    });
  }

  function resume(scope) {
    const nowMs = now(schedulerClock);
    budgetStore.clearHold({ scope: '*', nowMs, respectCooldown: true });
    budgetStore.clearHold({ scope, nowMs, respectCooldown: true });
  }

  async function dispose() {
    if (!disposed) {
      disposed = true;
      lifecycle.abort(
        schedulerError(
          'LOTTERY_SCHEDULER_DISPOSED',
          'Dynamic lottery request scheduler has been disposed.',
        ),
      );
    }
    await queue;
  }

  return { request, pause, resume, dispose };
}

module.exports = { createRequestScheduler };
