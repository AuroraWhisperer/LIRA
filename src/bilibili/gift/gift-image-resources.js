'use strict';

const { parseAllowedBilibiliImageUrl } = require('./remote-gift-image-cache');

const MAX_RESOURCES = 512;
const RETRY_DELAY_MS = 30_000;

// Source URLs already identify the settled artwork; never guess by gift name or ID.
function createGiftImageResources({ imageCache, getCatalog, getRevision, now = Date.now }) {
  const resources = new Map();
  let catalogIndex;
  let stopped = false;

  function resolveSource(source) {
    if (stopped) return '';
    const parsed = parseAllowedBilibiliImageUrl(source);
    if (!parsed) return '';
    const revision = getRevision?.();
    if (!catalogIndex || revision === undefined || catalogIndex.revision !== revision) {
      const gifts = new Map();
      for (const gift of getCatalog()?.gifts || []) {
        const url = parseAllowedBilibiliImageUrl(gift.sourceUrl)?.href;
        if (!url) continue;
        if (gifts.has(url)) gifts.get(url).unique = false;
        else gifts.set(url, { gift, unique: true });
      }
      catalogIndex = { revision, gifts };
    }
    const match = catalogIndex.gifts.get(parsed.href);
    const gift = match?.gift;
    const imagePath = imageCache.getSourceImagePath(parsed.href, gift);
    if (!imagePath) return '';
    const entry = resources.get(imagePath) || { source: parsed.href, gift, retryAt: 0, fallback: '' };
    entry.unique = match?.unique === true;
    if (!entry.unique && entry.fallback !== imagePath) entry.fallback = '';
    resources.delete(imagePath);
    resources.set(imagePath, entry);
    if (resources.size > MAX_RESOURCES) resources.delete(resources.keys().next().value);
    return imagePath;
  }

  async function ensureImage(imagePath) {
    const entry = resources.get(imagePath);
    if (stopped || !entry) return '';
    if (entry.pending) return entry.pending;
    if (entry.retryAt > now()) return entry.fallback;
    const download = entry.unique ? imageCache.cacheGiftImage(entry.gift) : imageCache.cacheSourceImage(entry.source, entry.gift);
    entry.pending = download.catch(() => '').then(result => {
      // Several variants may share today's source but have different last-good images.
      if (!entry.unique && result !== imagePath) result = '';
      entry.retryAt = result === imagePath ? 0 : now() + RETRY_DELAY_MS;
      entry.fallback = result;
      return result;
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  return { resolveSource, ensureImage, dispose() { stopped = true; resources.clear(); catalogIndex = null; } };
}

module.exports = { createGiftImageResources };
