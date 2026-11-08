import { bindGuardImage, getGuardIcon } from './bilibili-guard-icons.js';
import { GIFT_PLACEHOLDER, setGiftImage } from './gift-image-fallback.js';
import { getStaticGiftImage } from './gift-static-image.js';

export { GIFT_PLACEHOLDER };

const updates = new WeakMap();

export function resolveGiftImageSource(value, guardLevel = 0) {
  const guard = getGuardIcon(guardLevel);
  if (guard) return guard;
  const source = String(value || '');
  if (/^\/overtime-gift-images\/[a-z\d_-][a-z\d._-]*\.(?:png|jpe?g|gif|webp)$/iu.test(source)
    && !source.includes('..')) return source;
  if (/^\/img\/admin\/gifts\/bilibili-guard-(?:captain|prefect|governor)(?:-thousand)?\.webp$/.test(source)) return source;
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))
      && !url.username && !url.password && !url.port && !url.hash ? url.href : '';
  } catch { return ''; }
}

// Renderers with their own load/error decoration can bind the source without replacing that policy.
export function bindGiftImage(image, source) {
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  return bindGuardImage(image, source);
}

export function setGiftArtwork(image, source, { format = 'original', mimeType = 'image/png', guardLevel = 0 } = {}) {
  const update = {};
  updates.set(image, update);
  source = bindGiftImage(image, getGuardIcon(guardLevel) || source);
  if (format !== 'static' || !source || image.hasAttribute('data-guard-icon') || image.hasAttribute('data-guard-avatar-frame')) {
    setGiftImage(image, source);
    return;
  }
  image.hidden = true;
  getStaticGiftImage(image.ownerDocument, source, mimeType).then(result => {
    if (updates.get(image) === update) setGiftImage(image, result);
  });
}

export function setGiftArtworkFallbacks(root) {
  for (const image of root.querySelectorAll('img')) {
    setGiftArtwork(image, image.getAttribute('src'));
  }
}
