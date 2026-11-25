import { requestApiData } from './json-request.js';

export function requestGiftWish(path, body, signal) {
  return requestApiData(path, { body, signal, errorMessage: '许愿暂未更新，请重试。' });
}

const feeds = new Map();
const WISH_PATH = '/api/gifts/wishes';

function createFeed(path) {
  const listeners = new Set();
  let generation = 0;
  let controller;
  let timer;
  let latest;
  let pending;
  let requestPath;
  function cancel() {
    generation++;
    clearTimeout(timer);
    controller?.abort();
    latest = undefined;
  }
  async function read(current, signal) {
    try {
      const value = await requestGiftWish(requestPath, undefined, signal);
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
  function refresh() {
    if (!listeners.size || document.hidden) return;
    cancel();
    controller = new AbortController();
    return pending = read(generation, controller.signal);
  }
  function syncRequestPath() {
    const cardsOnly = path === WISH_PATH && !Array.from(listeners).some(listener => listener.includeSession);
    const next = cardsOnly ? `${path}?includeSession=0` : path;
    if (next === requestPath) return;
    requestPath = next;
    refresh();
  }
  function onVisibilityChange() {
    if (document.hidden) cancel();
    else refresh();
  }
  return {
    add(listener) {
      listeners.add(listener);
      if (listeners.size === 1) document.addEventListener('visibilitychange', onVisibilityChange);
      syncRequestPath();
      if (latest !== undefined) listener.onData(latest);
      return pending;
    },
    refresh,
    syncRequestPath,
    remove(listener) {
      listeners.delete(listener);
      if (listeners.size) return syncRequestPath();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancel();
      feeds.delete(path);
    },
  };
}

// The desktop editor and canvas share one request stream for each endpoint.
export function createGiftWishFeed({ onData, onError, path = WISH_PATH, includeSession = true }) {
  const listener = { onData, onError, includeSession };
  let feed;
  return {
    start() {
      if (feed) return feed.refresh();
      if (!feeds.has(path)) feeds.set(path, createFeed(path));
      feed = feeds.get(path);
      return feed.add(listener);
    },
    refresh() { return feed?.refresh(); },
    setIncludeSession(value) {
      listener.includeSession = value;
      feed?.syncRequestPath();
    },
    stop() {
      feed?.remove(listener);
      feed = null;
    },
  };
}
