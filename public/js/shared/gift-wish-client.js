import { readApiResponse } from './json-response.js';

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
    const result = await readApiResponse(response, '许愿暂未更新，请重试。');
    return result.data;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

const feeds = new Map();

function createFeed(path) {
  const listeners = new Set();
  let generation = 0;
  let controller;
  let timer;
  let latest;
  let pending;
  async function refresh() {
    if (!listeners.size) return;
    clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    try {
      const value = await requestGiftWish(path, undefined, controller.signal);
      if (current === generation) {
        latest = value;
        for (const listener of listeners) listener.onData(value);
      }
    } catch (error) {
      if (current === generation) {
        latest = undefined;
        for (const listener of listeners) listener.onError(error);
      }
    } finally {
      if (listeners.size && current === generation) timer = setTimeout(refresh, 3000);
    }
  }
  return {
    add(listener) {
      listeners.add(listener);
      if (listeners.size === 1) pending = refresh();
      else if (latest !== undefined) listener.onData(latest);
      return pending;
    },
    refresh,
    remove(listener) {
      listeners.delete(listener);
      if (listeners.size) return;
      generation++;
      clearTimeout(timer);
      controller?.abort();
      feeds.delete(path);
    },
  };
}

// The desktop editor and canvas share one request stream for each endpoint.
export function createGiftWishFeed({ onData, onError, path = '/api/gifts/wishes' }) {
  const listener = { onData, onError };
  let feed;
  return {
    start() {
      if (feed) return feed.refresh();
      if (!feeds.has(path)) feeds.set(path, createFeed(path));
      feed = feeds.get(path);
      return feed.add(listener);
    },
    refresh() { return feed?.refresh(); },
    stop() {
      feed?.remove(listener);
      feed = null;
    },
  };
}
