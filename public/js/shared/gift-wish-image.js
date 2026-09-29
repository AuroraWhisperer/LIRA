import { GIFT_PLACEHOLDER, setGiftImage } from './gift-image-fallback.js';

const staticImages = new Map();

export function setGiftWishTextImage(image, source, format) {
  if (format !== 'static') {
    setGiftImage(image, source);
    return;
  }
  const path = source || GIFT_PLACEHOLDER;
  if (!staticImages.has(path)) {
    const result = new Promise((resolve, reject) => {
      const original = image.ownerDocument.createElement('img');
      original.crossOrigin = 'anonymous';
      original.addEventListener('error', reject, { once: true });
      original.addEventListener(
        'load',
        () => {
          try {
            const canvas = image.ownerDocument.createElement('canvas');
            canvas.width = original.naturalWidth;
            canvas.height = original.naturalHeight;
            // Canvas uses the default/first animation frame, never the current playing frame.
            canvas.getContext('2d').drawImage(original, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } catch (error) {
            reject(error);
          }
        },
        { once: true },
      );
      original.src = path;
    }).catch(() => {
      staticImages.delete(path);
      return GIFT_PLACEHOLDER;
    });
    // Bound retained PNGs while browsing a large gift catalog in the editor.
    if (staticImages.size >= 64) staticImages.delete(staticImages.keys().next().value);
    staticImages.set(path, result);
  }
  image.hidden = true;
  staticImages.get(path).then((png) => setGiftImage(image, png));
}
