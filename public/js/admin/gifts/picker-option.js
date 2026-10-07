import { setGiftImage } from '../../shared/gift-image-fallback.js';

// Selection rules and descriptive text stay with each picker.
export function createGiftPickerButton(gift, { className, disabled, onSelect }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.disabled = disabled;
  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  setGiftImage(image, gift.imagePath);
  button.append(image);
  button.addEventListener('click', () => onSelect(gift));
  return button;
}
