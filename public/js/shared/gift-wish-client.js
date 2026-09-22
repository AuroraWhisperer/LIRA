export async function requestGiftWish(path, body, signal) {
  // Browser sources may use a Chromium version without AbortSignal.any/timeout.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetch(path, {
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw Object.assign(new Error(result.error || '许愿暂未更新，请重试。'), {
        code: result.code,
      });
    return result.data;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function createGiftWishFeed({ onData, onError }) {
  let active = false;
  let generation = 0;
  let controller;
  let timer;
  async function refresh() {
    if (!active) return;
    clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    try {
      const value = await requestGiftWish('/api/gifts/wishes', undefined, controller.signal);
      if (active && current === generation) onData(value);
    } catch (error) {
      if (active && current === generation) onError(error);
    } finally {
      if (active && current === generation) timer = setTimeout(refresh, 3000);
    }
  }
  return {
    start() {
      active = true;
      return refresh();
    },
    refresh,
    stop() {
      active = false;
      generation++;
      clearTimeout(timer);
      controller?.abort();
    },
  };
}
