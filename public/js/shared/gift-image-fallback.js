'use strict';

export const GIFT_PLACEHOLDER = '/img/gift-placeholder.png';
const boundImages = new WeakSet();

export function setGiftImage(image, source) {
  if (!boundImages.has(image)) {
    image.addEventListener('error', () => {
      if (image.getAttribute('src') === GIFT_PLACEHOLDER) {
        image.hidden = true;
        return;
      }
      image.src = GIFT_PLACEHOLDER;
    });
    image.addEventListener('load', () => {
      image.hidden = false;
    });
    boundImages.add(image);
  }
  image.hidden = false;
  image.src =
    !source || source === '/img/overtime-machine/gift-placeholder.svg'
      ? GIFT_PLACEHOLDER
      : source;
}

export function setGiftImageFallbacks(root) {
  for (const image of root.querySelectorAll('img')) {
    setGiftImage(image, image.getAttribute('src'));
  }
}
