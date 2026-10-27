import { BANNER_WIDTH, BANNER_HEIGHT, BANNER_GAP, createGiftBanner, createGiftArtworkResolver, readyGiftImages } from '../shared/gift-banner.js';

window.renderGiftExport = async ({ items, config, catalog, background }) => {
  const stage = document.getElementById('stage');
  const artwork = createGiftArtworkResolver(catalog);
  document.body.style.background = background === 'white' ? '#fff' : 'transparent';
  stage.replaceChildren(...items.map((item) => createGiftBanner(item, config, artwork)));
  await readyGiftImages(stage);
  return {
    width: Math.max(BANNER_WIDTH * 2, Math.ceil(stage.getBoundingClientRect().width)),
    height: (items.length * BANNER_HEIGHT + (items.length - 1) * BANNER_GAP) * 2,
  };
};
