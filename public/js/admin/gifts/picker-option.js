import { setGiftArtwork } from '../../shared/gift-image.js';

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
  setGiftArtwork(image, gift.imagePath);
  button.append(image);
  button.addEventListener('click', () => onSelect(gift));
  return button;
}
