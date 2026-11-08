import { GIFT_PLACEHOLDER } from './gift-image-fallback.js';

const staticImages = new Map();
const pending = new Map();
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
let cacheBytes = 0;

export function getStaticGiftImage(document, source, mimeType = 'image/png') {
  const key = `${mimeType}:${source}`;
  const cached = staticImages.get(key);
  if (cached) {
    staticImages.delete(key);
    cacheBytes -= cached.source.length * 2;
    if (cached.expiresAt > Date.now()) {
      remember(key, cached);
      return Promise.resolve(cached.source);
    }
  }
  if (!pending.has(key)) {
    const result = new Promise((resolve, reject) => {
      const original = document.createElement('img');
      original.crossOrigin = 'anonymous';
      original.referrerPolicy = 'no-referrer';
      original.addEventListener('error', reject, { once: true });
      original.addEventListener('load', () => {
        const canvas = document.createElement('canvas');
        try {
          canvas.width = original.naturalWidth;
          canvas.height = original.naturalHeight;
          // Canvas draws the default/first animation frame, never the playing frame.
          canvas.getContext('2d').drawImage(original, 0, 0);
          resolve(canvas.toDataURL(mimeType, 1));
        } catch (error) {
          reject(error);
        } finally {
          original.removeAttribute('src');
          canvas.width = canvas.height = 0;
        }
      }, { once: true });
      original.src = source;
    }).then(source => ({ source, expiresAt: Infinity }), () => ({ source: GIFT_PLACEHOLDER, expiresAt: Date.now() + 30000 }))
      .then(entry => { remember(key, entry); return entry.source; }).finally(() => pending.delete(key));
    pending.set(key, result);
  }
  return pending.get(key);
}

function remember(key, entry) {
  const bytes = entry.source.length * 2;
  if (bytes > MAX_CACHE_BYTES) return;
  staticImages.set(key, entry);
  cacheBytes += bytes;
  while (staticImages.size > 64 || cacheBytes > MAX_CACHE_BYTES) {
    const oldest = staticImages.keys().next().value;
    cacheBytes -= staticImages.get(oldest).source.length * 2;
    staticImages.delete(oldest);
  }
}
