'use strict';

const CACHE_NAME = 'lira-song-background-v1';
const TARGET_IMAGE_BYTES = 500 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

export async function prepareSongBackground(file) {
  const bitmap = await window.createImageBitmap(file);
  const canvas = document.createElement('canvas');
  try {
    for (const maxEdge of [2560, 1920]) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.76]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob || blob.type !== 'image/webp') throw new Error('BACKGROUND_PROCESSING_FAILED');
        if (blob.size <= TARGET_IMAGE_BYTES || (quality === 0.76 && blob.size <= MAX_IMAGE_BYTES)) return blob;
      }
      if (Math.max(bitmap.width, bitmap.height) <= 1920) break;
    }
    throw new Error('BACKGROUND_IMAGE_TOO_DETAILED');
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

export function createSongBackgroundImages() {
  // This cache contains public images only, keyed by the full server version URL.
  const draftUrl = new URL('/__song-background-draft', window.location.href).href;
  async function openCache() {
    try {
      return await window.caches.open(CACHE_NAME);
    } catch (_) {
      return null;
    }
  }

  async function save(url, blob, removePrevious) {
    try {
      const cache = await openCache();
      if (!cache) return false;
      await cache.put(url, new window.Response(blob));
      if (removePrevious) {
        for (const key of await cache.keys()) {
          if (key.url !== url) await cache.delete(key);
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function discardDraft() {
    try {
      return await (await openCache())?.delete(draftUrl);
    } catch (_) {
      // Cache failure must not change the outcome of a server write.
      return false;
    }
  }

  return {
    stage: (blob) => save(draftUrl, blob, false),
    publish: (url, blob) => save(url, blob, true),
    discardDraft,
    async read(url, signal) {
      let cached;
      try {
        cached = await (await openCache())?.match(url);
      } catch (_) {
        // A cleared or unavailable local cache can be rebuilt from the public image.
        cached = null;
      }
      if (cached) return cached.blob();
      const response = await fetch(url, {
        credentials: 'omit',
        redirect: 'error',
        priority: 'low',
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      });
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
        throw new Error('BACKGROUND_PREVIEW_FAILED');
      }
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || !blob.size || blob.size > MAX_DOWNLOAD_BYTES) {
        throw new Error('BACKGROUND_PREVIEW_FAILED');
      }
      await save(url, blob, true);
      return blob;
    },
    async clear() {
      try {
        return await window.caches.delete(CACHE_NAME);
      } catch (_) {
        // The server remains authoritative even when local cache removal fails.
        return false;
      }
    },
  };
}
