import { createGiftBanner, readyGiftImages } from '../shared/gift-banner.js';

window.renderGiftExport = async ({ items, config, catalog, background }) => {
  const stage = document.getElementById('stage');
  document.body.style.background = background === 'white' ? '#fff' : 'transparent';
  stage.replaceChildren(...items.map((item) => createGiftBanner(item, config, catalog)));
  await readyGiftImages(stage);
  return { width: 800, height: items.length * 192 + (items.length - 1) * 16 };
};
